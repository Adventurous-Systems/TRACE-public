/**
 * Keep the public demo marketplace stocked: one lot per curated product, and
 * never a second passport for it (owner, 2026-10-21).
 *
 * For each catalogue product:
 * - its lot on sale is restocked in place: when fewer units are available
 *   than the catalogue's lot size, quantity and quantityAvailable rise by the
 *   difference, so orders and history stay as they are;
 * - a lot that was delisted (cancelled or expired) is listed again on the
 *   same passport;
 * - a passport is created only when the product has none at all (a fresh
 *   database).
 * A lot that is fully ordered or sold is reported and left alone. Spare
 * passports are reported; demo-retire-spares deletes them. It never deletes
 * anything, and never touches users, orders or visitor data.
 *
 * --target-active is accepted, and must be 1, because the installed timer
 * (ops/deploy/run-replenish.sh) passes it.
 *
 * Usage:
 *   pnpm --filter @trace/db demo:replenish -- --env demo --target-active 1 --dry-run
 *   pnpm --filter @trace/db demo:replenish -- --env demo --target-active 1 --yes
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray, sql as dsql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../drizzle/schema.js';
import { computePassportHash } from '../src/passport-hash.js';
import {
  CATALOG,
  CATALOGUE_LOCK_NAME,
  LIVE_LOT_STATUSES,
  SEED_TAG,
  isCatalogueName,
  lotShippingNote,
  type Product,
} from './lib/catalogue.js';
import { resolveTarget } from './lib/guard.js';
import { scriptObjectStore, storeCatalogueImage } from './lib/catalogue-photos.js';

const PACKAGE_ROOT = process.cwd();
loadEnv({ path: path.resolve(PACKAGE_ROOT, '../../.env') });

const PRODUCTS_DIR = path.resolve(PACKAGE_ROOT, 'data/products');
const SELLER_EMAIL = (process.env['SEED_SELLER_EMAIL'] ?? 'admin@stirlingreuse.com').toLowerCase();

function parseTargetActive(argv: string[]): number {
  const index = argv.indexOf('--target-active');
  const raw = index >= 0 ? argv[index + 1] : '1';
  const target = Number(raw);
  if (target !== 1) {
    throw new Error('--target-active must be 1: the demo keeps one lot per product');
  }
  return target;
}

function lotNumber(
  passport: typeof schema.materialPassports.$inferSelect,
  product: Product,
): number {
  const metadata = passport.customAttributes ?? {};
  const value = metadata['demoLotNumber'];
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  return isCatalogueName(passport.productName, product) ? 1 : 0;
}

function isProductLot(
  passport: typeof schema.materialPassports.$inferSelect,
  product: Product,
): boolean {
  const metadata = passport.customAttributes ?? {};
  return (
    metadata['catalogueKey'] === product.key ||
    (metadata['seedSource'] === SEED_TAG && isCatalogueName(passport.productName, product))
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
  parseTargetActive(argv);
  const target = resolveTarget(argv);

  if (!dryRun && !confirmed) {
    throw new Error('Refusing to create lots without --yes. Use --dry-run to preview.');
  }

  const client = postgres(target.databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    const seller = await db.query.users.findFirst({
      where: eq(schema.users.email, SELLER_EMAIL),
    });
    if (!seller?.organisationId) {
      throw new Error(`Demo seller ${SELLER_EMAIL} is missing or has no organisation`);
    }

    const sellerOrganisationId = seller.organisationId;
    const store = dryRun ? undefined : scriptObjectStore();
    // One stored file per catalogue product, shared by all of its lots.
    const imageUrls = new Map<string, string>();
    let created = 0;
    let restocked = 0;
    let relisted = 0;

    await db.transaction(async (tx) => {
      await tx.execute(dsql`select pg_advisory_xact_lock(hashtext(${CATALOGUE_LOCK_NAME}))`);

      const passports = await tx
        .select()
        .from(schema.materialPassports)
        .where(dsql`${schema.materialPassports.customAttributes}->>'seedSource' = ${SEED_TAG}`);
      const listingRows = passports.length
        ? await tx
            .select()
            .from(schema.listings)
            .where(
              inArray(
                schema.listings.passportId,
                passports.map((passport) => passport.id),
              ),
            )
        : [];
      const listingsOf = (passportId: string) =>
        listingRows.filter((listing) => listing.passportId === passportId);
      // A fully ordered lot (reserved) is still the product's lot: its orders
      // complete, lapse or are cancelled, and it is not replaced meanwhile.
      const liveListingOf = (passportId: string) =>
        listingsOf(passportId).find((listing) =>
          (LIVE_LOT_STATUSES as readonly string[]).includes(listing.status),
        );
      const batch = new Date().toISOString().slice(0, 10);

      for (const product of CATALOG) {
        const productPassports = passports
          .filter((passport) => isProductLot(passport, product))
          .sort((a, b) => lotNumber(a, product) - lotNumber(b, product));
        // The product's one lot, as demo-retire-spares and demo-restore pick it.
        const lot =
          productPassports.find((passport) => liveListingOf(passport.id)) ?? productPassports[0];
        const spares = productPassports.length - 1;
        const spareNote = spares > 0 ? `; ${spares} spare passport(s), run demo-retire-spares` : '';

        if (lot) {
          const live = liveListingOf(lot.id);
          const verb = (doing: string, did: string) => (dryRun ? `would ${doing}` : did);
          if (live?.status === 'active') {
            const short = product.listing.quantity - live.quantityAvailable;
            if (short > 0) {
              if (!dryRun) {
                await tx
                  .update(schema.listings)
                  .set({
                    quantity: live.quantity + short,
                    quantityAvailable: live.quantityAvailable + short,
                  })
                  .where(eq(schema.listings.id, live.id));
              }
              restocked += 1;
            }
            console.log(
              `${product.key}: on sale, ${live.quantityAvailable} of ${product.listing.quantity} available` +
                (short > 0 ? `, ${verb('restock', 'restocked')} ${short}` : '') +
                spareNote,
            );
          } else if (live) {
            console.log(`${product.key}: fully ordered, left alone${spareNote}`);
          } else if (listingsOf(lot.id).some((listing) => listing.status === 'sold')) {
            console.log(`${product.key}: sold out, left alone (needs a human)${spareNote}`);
          } else {
            if (!dryRun) {
              await tx.insert(schema.listings).values({
                passportId: lot.id,
                organisationId: sellerOrganisationId,
                sellerId: seller.id,
                pricePence: product.listing.pricePence,
                currency: 'GBP',
                quantity: product.listing.quantity,
                quantityAvailable: product.listing.quantity,
                minOrderQuantity: product.listing.minOrderQuantity ?? 1,
                status: 'active',
                shippingOptions: [{ method: 'both', notes: lotShippingNote(product) }],
                expiresAt: null,
              });
              await tx
                .update(schema.materialPassports)
                .set({ status: 'listed', updatedAt: new Date() })
                .where(eq(schema.materialPassports.id, lot.id));
            }
            relisted += 1;
            console.log(
              `${product.key}: not on sale, ${verb('list', 'listed')} "${lot.productName}" again${spareNote}`,
            );
          }
          continue;
        }

        // A fresh database: the product's one passport, as lot 1.
        const number = 1;
        created += 1;
        if (dryRun) {
          console.log(`${product.key}: no passport, would create ${displayName(product, number)}`);
          continue;
        }

        const passportId = randomUUID();
        let imageUrl = imageUrls.get(product.image);
        if (!imageUrl) {
          imageUrl = await storeCatalogueImage(tx, store!, path.join(PRODUCTS_DIR, product.image));
          imageUrls.set(product.image, imageUrl);
        }

        const [inserted] = await tx
          .insert(schema.materialPassports)
          .values({
            ...product.passport,
            id: passportId,
            productName: displayName(product, number),
            serialNumber: serialNumber(product, number),
            organisationId: sellerOrganisationId,
            registeredBy: seller.id,
            conditionPhotos: [imageUrl],
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
          quantityAvailable: product.listing.quantity,
          minOrderQuantity: product.listing.minOrderQuantity ?? 1,
          status: 'active',
          shippingOptions: [{ method: 'both', notes: lotShippingNote(product) }],
          expiresAt: null,
        });
        console.log(`${product.key}: no passport, created ${displayName(product, number)}`);
      }
    });

    console.log(
      `${dryRun ? 'Previewed' : 'Done'} for ${target.description}: ${restocked} restocked, ` +
        `${relisted} listed again, ${created} created.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Demo replenishment failed:', error);
  process.exit(1);
});
