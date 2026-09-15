/**
 * Curated product catalogue seeder for the TRACE Workshop showcase.
 *
 * Seeds a fixed set of material passports + active marketplace listings (with
 * real product photos uploaded to MinIO) so the marketplace, passport pages and
 * impact counter demo against authentic data. Each seeded passport is tagged
 * `customAttributes.seedSource = SEED_TAG` so the whole set can be removed again
 * with `--unseed` (the catalogue data lives here — not in the app — so it can be
 * re-seeded or torn down at will).
 *
 * Every passport gets a real keccak256 fingerprint recorded in the honest
 * "simulated / trust layer prepared" state (anchoredAt set, txHash null), so the
 * passport credential shows its verified seal and "Verify integrity" passes.
 *
 * Seller: the org of SELLER_EMAIL (default admin@stirlingreuse.com).
 *
 * Usage (env: DATABASE_URL + MINIO_* must point at the target stack):
 *   pnpm --filter @trace/db seed:products -- [--dry-run]
 *   pnpm --filter @trace/db seed:products -- --unseed --yes
 *
 * Images are read from packages/db/data/products/<image>.
 */
import { config as loadEnv } from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql as dsql } from 'drizzle-orm';
import * as Minio from 'minio';
import * as schema from '../drizzle/schema.js';
import { computePassportHash } from '../src/passport-hash.js';
import { resolveTarget } from './lib/guard.js';
import { CATALOG, SEED_TAG } from './lib/catalogue.js';

const PACKAGE_ROOT = process.cwd();
loadEnv({ path: path.resolve(PACKAGE_ROOT, '../../.env') });

const SELLER_EMAIL = (process.env['SEED_SELLER_EMAIL'] ?? 'admin@stirlingreuse.com').toLowerCase();
const PRODUCTS_DIR = path.resolve(PACKAGE_ROOT, 'data/products');
const DAY = 24 * 60 * 60 * 1000;

// Curated listings are demo furniture: they should still be there months later.
// null (the default) means "never expires"; set SEED_LISTING_TTL_DAYS to a
// positive integer to opt into an expiry.
const listingTtlDays: number | null = (() => {
  const raw = process.env['SEED_LISTING_TTL_DAYS'];
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`SEED_LISTING_TTL_DAYS must be a positive number, got: ${raw}`);
  }
  return parsed;
})();

// ── Canonical fingerprint ─────────────────────────────────────────────────────
// Single source of truth lives in @trace/db (packages/db/src/passport-hash.ts).
// This script used to keep its own byte-identical copy; any drift between the
// two silently turned the demo's "Untampered" result into "Mismatch".
const computeHash = computePassportHash;

// ── MinIO ─────────────────────────────────────────────────────────────────────
function makeMinio() {
  const bucket = process.env['MINIO_BUCKET_PASSPORTS'] ?? 'passports';
  const publicUrl =
    process.env['MINIO_PUBLIC_URL'] ??
    `http://${process.env['MINIO_ENDPOINT'] ?? 'localhost'}:${process.env['MINIO_PORT'] ?? '9000'}`;
  const client = new Minio.Client({
    endPoint: process.env['MINIO_ENDPOINT'] ?? 'localhost',
    port: Number(process.env['MINIO_PORT'] ?? 9000),
    useSSL: (process.env['MINIO_USE_SSL'] ?? 'false') === 'true',
    accessKey: process.env['MINIO_ACCESS_KEY'] ?? 'minioadmin',
    secretKey: process.env['MINIO_SECRET_KEY'] ?? 'minioadmin',
  });
  return { client, bucket, publicUrl };
}

/**
 * Create the passports bucket if it is missing, mirroring the API's
 * ensureBucket (packages/api/src/lib/storage.ts:15).
 *
 * Without this the seeder only worked because the API happened to have started
 * first and created the bucket as a side effect. In CI the seed runs BEFORE the
 * API, so the first putObject failed with NoSuchBucket — which is what blocked
 * the demo-integrity gate. It also makes the documented recovery path
 * (unseed + re-seed after a MinIO volume reset) self-sufficient.
 */
async function ensureBucket(minio: ReturnType<typeof makeMinio>): Promise<void> {
  const exists = await minio.client.bucketExists(minio.bucket);
  if (!exists) await minio.client.makeBucket(minio.bucket);
  if ((process.env['MINIO_PUBLIC_READ'] ?? 'false') === 'true')
    await minio.client.setBucketPolicy(
      minio.bucket,
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${minio.bucket}/*`],
          },
        ],
      }),
    );
  if (!exists) console.log(`  created MinIO bucket "${minio.bucket}"`);
}

async function uploadImage(
  minio: ReturnType<typeof makeMinio>,
  passportId: string,
  imageFile: string,
): Promise<string> {
  const buffer = readFileSync(path.join(PRODUCTS_DIR, imageFile));
  const key = `passports/${passportId}/photos/${Date.now()}.jpg`;
  await minio.client.putObject(minio.bucket, key, buffer, buffer.length, {
    'Content-Type': 'image/jpeg',
  });
  return `${minio.publicUrl}/${minio.bucket}/${key}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const unseed = argv.includes('--unseed');
  const confirmed = argv.includes('--yes');

  // --unseed deletes curated passports (and cascades their listings), so it
  // must name its target. Seeding is additive and idempotent, so it does not.
  const url = unseed
    ? resolveTarget(argv).databaseUrl
    : (process.env['DATABASE_URL'] ??
      (() => {
        throw new Error('DATABASE_URL environment variable is required');
      })());

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });
  const seedTagFilter = dsql`${schema.materialPassports.customAttributes}->>'seedSource' = ${SEED_TAG}`;

  try {
    // ── Unseed ────────────────────────────────────────────────────────────
    if (unseed) {
      const existing = await db
        .select({ id: schema.materialPassports.id, name: schema.materialPassports.productName })
        .from(schema.materialPassports)
        .where(seedTagFilter);
      console.log(`\nUnseed — ${existing.length} curated passport(s) tagged "${SEED_TAG}"`);
      for (const p of existing) console.log(`  - ${p.name}`);
      if (!existing.length) return;
      if (!confirmed) {
        console.error('\nRefusing to delete without --yes.');
        process.exit(1);
      }
      // listings cascade from passports (onDelete: cascade)
      await db.delete(schema.materialPassports).where(seedTagFilter);
      console.log(`\nRemoved ${existing.length} curated passport(s) and their listings.`);
      return;
    }

    // ── Seed ──────────────────────────────────────────────────────────────
    const seller = await db.query.users.findFirst({ where: eq(schema.users.email, SELLER_EMAIL) });
    if (!seller || !seller.organisationId) {
      throw new Error(
        `Seller ${SELLER_EMAIL} not found or has no organisation. Set SEED_SELLER_EMAIL.`,
      );
    }
    const org = await db.query.organisations.findFirst({
      where: eq(schema.organisations.id, seller.organisationId),
    });
    console.log(`\nSeed products — ${dryRun ? 'DRY-RUN (no writes)' : 'LIVE'}`);
    console.log(`  seller: ${seller.email} · org: ${org?.name ?? seller.organisationId}\n`);

    const already = await db
      .select({ c: dsql<number>`count(*)::int` })
      .from(schema.materialPassports)
      .where(seedTagFilter);
    if ((already[0]?.c ?? 0) > 0) {
      console.log(
        `  ${already[0]!.c} curated passport(s) already present — run with --unseed --yes first to reset.`,
      );
      if (!dryRun) return;
    }

    const minio = dryRun ? null : makeMinio();
    if (minio) await ensureBucket(minio);

    for (const product of CATALOG) {
      if (dryRun) {
        console.log(
          `  ✓ would seed: ${product.passport.productName}  £${(product.listing.pricePence / 100).toFixed(2)} ×${product.listing.quantity}`,
        );
        continue;
      }

      const [inserted] = await db
        .insert(schema.materialPassports)
        .values({
          ...product.passport,
          organisationId: seller.organisationId,
          registeredBy: seller.id,
          conditionPhotos: [],
          customAttributes: { seedSource: SEED_TAG },
        })
        .returning();

      // Upload photo (excluded from the fingerprint, so order vs hashing is irrelevant).
      const photoUrl = await uploadImage(minio!, inserted!.id, product.image);
      await db
        .update(schema.materialPassports)
        .set({ conditionPhotos: [photoUrl] })
        .where(eq(schema.materialPassports.id, inserted!.id));

      // Compute the fingerprint from a fresh read (jsonb-normalised, exactly what
      // verify-integrity will recompute) and record the simulated trust state.
      const fresh = await db.query.materialPassports.findFirst({
        where: eq(schema.materialPassports.id, inserted!.id),
      });
      await db
        .update(schema.materialPassports)
        .set({
          blockchainPassportHash: computeHash(fresh!),
          blockchainAnchoredAt: new Date(),
          blockchainTxHash: null,
        })
        .where(eq(schema.materialPassports.id, inserted!.id));

      await db.insert(schema.listings).values({
        passportId: inserted!.id,
        organisationId: seller.organisationId,
        sellerId: seller.id,
        pricePence: product.listing.pricePence,
        currency: 'GBP',
        quantity: product.listing.quantity,
        status: 'active',
        shippingOptions: [
          { method: 'both', notes: product.listing.note ?? 'Delivery from FK7 or collection' },
        ],
        // Curated demo listings never expire by default. A 90-day TTL used to be
        // hardcoded here; it silently detonated on 2026-09-02 (90 days after the
        // June seed), leaving the marketplace rendering listings that threw
        // "Listing has expired" the moment anyone tried the make-an-offer step.
        // Set SEED_LISTING_TTL_DAYS to opt back into an expiry for non-demo use.
        expiresAt: listingTtlDays === null ? null : new Date(Date.now() + listingTtlDays * DAY),
      });

      console.log(`  ✓ seeded: ${product.passport.productName}`);
    }

    if (dryRun) console.log('\nDry run complete — re-run without --dry-run to apply.');
    else
      console.log(
        `\nSeeded ${CATALOG.length} products with photos + listings under ${org?.name ?? seller.email}.`,
      );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Product seed failed:', err);
  process.exit(1);
});
