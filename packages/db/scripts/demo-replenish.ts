/**
 * Keep the public demo marketplace stocked without modifying visitor data.
 *
 * This command creates independent, numbered lots only when active inventory
 * for a catalogue product drops below the requested target. It never updates
 * or deletes users, offers, transactions, reserved listings, or sold listings.
 *
 * Usage:
 *   pnpm --filter @trace/db demo:replenish -- --env demo --target-active 1 --dry-run
 *   pnpm --filter @trace/db demo:replenish -- --env demo --target-active 1 --yes
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql as dsql } from 'drizzle-orm';
import * as Minio from 'minio';
import postgres from 'postgres';
import * as schema from '../drizzle/schema.js';
import { computePassportHash } from '../src/passport-hash.js';
import { CATALOG, CATALOGUE_LOCK_NAME, SEED_TAG, type Product } from './lib/catalogue.js';
import { resolveTarget } from './lib/guard.js';

const PACKAGE_ROOT = process.cwd();
loadEnv({ path: path.resolve(PACKAGE_ROOT, '../../.env') });

const PRODUCTS_DIR = path.resolve(PACKAGE_ROOT, 'data/products');
const SELLER_EMAIL = (process.env['SEED_SELLER_EMAIL'] ?? 'admin@stirlingreuse.com').toLowerCase();

interface MinioConfig {
  client: Minio.Client;
  bucket: string;
  publicUrl: string;
}

interface UploadedObject {
  bucket: string;
  key: string;
}

function parseTargetActive(argv: string[]): number {
  const index = argv.indexOf('--target-active');
  const raw = index >= 0 ? argv[index + 1] : '1';
  const target = Number(raw);
  if (!Number.isInteger(target) || target < 1 || target > 10) {
    throw new Error('--target-active must be an integer from 1 to 10');
  }
  return target;
}

function makeMinio(): MinioConfig {
  const bucket = process.env['MINIO_BUCKET_PASSPORTS'] ?? 'passports';
  const publicUrl =
    process.env['MINIO_PUBLIC_URL'] ??
    `http://${process.env['MINIO_ENDPOINT'] ?? 'localhost'}:${process.env['MINIO_PORT'] ?? '9000'}`;
  return {
    client: new Minio.Client({
      endPoint: process.env['MINIO_ENDPOINT'] ?? 'localhost',
      port: Number(process.env['MINIO_PORT'] ?? 9000),
      useSSL: (process.env['MINIO_USE_SSL'] ?? 'false') === 'true',
      accessKey: process.env['MINIO_ACCESS_KEY'] ?? 'minioadmin',
      secretKey: process.env['MINIO_SECRET_KEY'] ?? 'minioadmin',
    }),
    bucket,
    publicUrl,
  };
}

async function ensureBucket(minio: MinioConfig): Promise<void> {
  if (!(await minio.client.bucketExists(minio.bucket))) {
    await minio.client.makeBucket(minio.bucket);
  }
}

async function uploadImage(
  minio: MinioConfig,
  passportId: string,
  imageFile: string,
): Promise<{ url: string; object: UploadedObject }> {
  const key = `passports/${passportId}/photos/${Date.now()}.jpg`;
  const buffer = readFileSync(path.join(PRODUCTS_DIR, imageFile));
  await minio.client.putObject(minio.bucket, key, buffer, buffer.length, {
    'Content-Type': 'image/jpeg',
  });
  return {
    url: `${minio.publicUrl}/${minio.bucket}/${key}`,
    object: { bucket: minio.bucket, key },
  };
}

function lotNumber(
  passport: typeof schema.materialPassports.$inferSelect,
  product: Product,
): number {
  const metadata = passport.customAttributes ?? {};
  const value = metadata['demoLotNumber'];
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  return passport.productName === product.passport.productName ? 1 : 0;
}

function isProductLot(
  passport: typeof schema.materialPassports.$inferSelect,
  product: Product,
): boolean {
  const metadata = passport.customAttributes ?? {};
  return (
    metadata['catalogueKey'] === product.key ||
    (metadata['seedSource'] === SEED_TAG && passport.productName === product.passport.productName)
  );
}

function displayName(product: Product, number: number): string {
  return `${product.passport.productName} — Demo Lot ${String(number).padStart(3, '0')}`;
}

function serialNumber(product: Product, number: number): string {
  return `TRACE-DEMO-${product.key.toUpperCase()}-${String(number).padStart(3, '0')}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const confirmed = argv.includes('--yes');
  const targetActive = parseTargetActive(argv);
  const target = resolveTarget(argv);

  if (!dryRun && !confirmed) {
    throw new Error('Refusing to create lots without --yes. Use --dry-run to preview.');
  }

  const client = postgres(target.databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });
  const uploaded: UploadedObject[] = [];

  try {
    const seller = await db.query.users.findFirst({
      where: eq(schema.users.email, SELLER_EMAIL),
    });
    if (!seller?.organisationId) {
      throw new Error(`Demo seller ${SELLER_EMAIL} is missing or has no organisation`);
    }

    const sellerOrganisationId = seller.organisationId;
    if (!dryRun) await ensureBucket(makeMinio());
    const minio = dryRun ? undefined : makeMinio();
    let created = 0;

    await db.transaction(async (tx) => {
      await tx.execute(dsql`select pg_advisory_xact_lock(hashtext(${CATALOGUE_LOCK_NAME}))`);

      const passports = await tx
        .select()
        .from(schema.materialPassports)
        .where(dsql`${schema.materialPassports.customAttributes}->>'seedSource' = ${SEED_TAG}`);
      const activeListingRows = await tx
        .select({ passportId: schema.listings.passportId })
        .from(schema.listings)
        .where(eq(schema.listings.status, 'active'));
      const activePassportIds = new Set(activeListingRows.map((listing) => listing.passportId));
      const batch = new Date().toISOString().slice(0, 10);

      for (const product of CATALOG) {
        const productPassports = passports.filter((passport) => isProductLot(passport, product));
        const activeLots = productPassports.filter((passport) =>
          activePassportIds.has(passport.id),
        );
        const nextLot =
          Math.max(0, ...productPassports.map((passport) => lotNumber(passport, product))) + 1;
        const missing = Math.max(0, targetActive - activeLots.length);

        console.log(
          `${product.key}: ${activeLots.length} active / ${targetActive} target${missing ? `, add ${missing}` : ''}`,
        );

        for (let offset = 0; offset < missing; offset += 1) {
          const number = nextLot + offset;
          if (dryRun) {
            console.log(`  would create ${displayName(product, number)}`);
            continue;
          }

          const passportId = randomUUID();
          const image = await uploadImage(minio!, passportId, product.image);
          uploaded.push(image.object);

          const [inserted] = await tx
            .insert(schema.materialPassports)
            .values({
              ...product.passport,
              id: passportId,
              productName: displayName(product, number),
              serialNumber: serialNumber(product, number),
              organisationId: sellerOrganisationId,
              registeredBy: seller.id,
              conditionPhotos: [image.url],
              customAttributes: {
                seedSource: SEED_TAG,
                catalogueKey: product.key,
                catalogueName: product.passport.productName,
                demoLotNumber: number,
                demoBatch: batch,
              },
            })
            .returning();

          const persisted = await tx.query.materialPassports.findFirst({
            where: eq(schema.materialPassports.id, inserted!.id),
          });
          if (!persisted) throw new Error(`Created lot ${passportId} could not be reloaded`);

          await tx
            .update(schema.materialPassports)
            .set({
              blockchainPassportHash: computePassportHash(persisted),
              blockchainAnchoredAt: new Date(),
              blockchainTxHash: null,
            })
            .where(eq(schema.materialPassports.id, inserted!.id));

          await tx.insert(schema.listings).values({
            passportId: inserted!.id,
            organisationId: sellerOrganisationId,
            sellerId: seller.id,
            pricePence: product.listing.pricePence,
            currency: 'GBP',
            quantity: product.listing.quantity,
            status: 'active',
            shippingOptions: [
              { method: 'both', notes: product.listing.note ?? 'Delivery from FK7 or collection' },
            ],
            expiresAt: null,
          });
          created += 1;
          console.log(`  created ${displayName(product, number)}`);
        }
      }
    });

    console.log(
      `${dryRun ? 'Previewed' : 'Created'} ${created} demo lot(s) for ${target.description}.`,
    );
  } catch (error) {
    if (uploaded.length > 0) {
      const minio = makeMinio();
      await Promise.allSettled(
        uploaded.map(({ bucket, key }) => minio.client.removeObject(bucket, key)),
      );
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Demo replenishment failed:', error);
  process.exit(1);
});
