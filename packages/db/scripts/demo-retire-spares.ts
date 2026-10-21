/**
 * One passport per curated product (owner, 2026-10-21). Deletes the curated
 * passports a product has beyond its one lot: the spares the top-up created
 * and demo-trim-active later delisted. A spare is deleted only if nothing
 * depends on it (no order, history event, quality report or sensor reading,
 * and no listing other than a cancelled or expired one); anything else is
 * reported and left alone. See scripts/lib/demo-spares-policy.ts.
 *
 * Deleting a passport removes its listings and events (foreign-key cascade).
 * Audit and chain-transaction rows are kept: they are the record of what was
 * done and paid for. A spare's QR code stays in the write-once object store,
 * no longer linked to a passport.
 *
 * Usage:
 *   pnpm --filter @trace/db demo:retire-spares -- --env demo --dry-run
 *   pnpm --filter @trace/db demo:retire-spares -- --env demo --yes
 */
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray, sql as dsql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../drizzle/schema.js';
import { CATALOGUE_LOCK_NAME, SEED_TAG } from './lib/catalogue.js';
import { planSpareRetirement, type CuratedPassportRow } from './lib/demo-spares-policy.js';
import { resolveTarget } from './lib/guard.js';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

async function countBy(
  rows: Promise<{ id: string | null; n: number }[]>,
): Promise<Map<string, number>> {
  return new Map((await rows).filter((r) => r.id).map((r) => [r.id!, Number(r.n)]));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const target = resolveTarget(argv);
  if (!dryRun && !argv.includes('--yes')) {
    throw new Error('Refusing to delete spare passports without --yes. Use --dry-run to preview.');
  }

  const client = postgres(target.databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    let retired = 0;
    let protectedCount = 0;
    await db.transaction(async (tx) => {
      // The top-up and the catalogue correction take the same lock.
      await tx.execute(dsql`select pg_advisory_xact_lock(hashtext(${CATALOGUE_LOCK_NAME}))`);

      const passports = await tx
        .select({
          id: schema.materialPassports.id,
          productName: schema.materialPassports.productName,
          customAttributes: schema.materialPassports.customAttributes,
        })
        .from(schema.materialPassports)
        .where(dsql`${schema.materialPassports.customAttributes}->>'seedSource' = ${SEED_TAG}`)
        // The API doesn't take the catalogue lock. Locking the rows means an
        // order, report or reopened listing can't land on a spare between
        // the counts below and the delete: it waits, then finds it gone.
        .for('update');
      const ids = passports.map((p) => p.id);
      if (ids.length === 0) {
        console.log(`No curated passports on ${target.description}.`);
        return;
      }

      const listings = await tx
        .select({ passportId: schema.listings.passportId, status: schema.listings.status })
        .from(schema.listings)
        .where(inArray(schema.listings.passportId, ids))
        .for('update');
      const transactions = await countBy(
        tx
          .select({ id: schema.listings.passportId, n: dsql<number>`count(*)` })
          .from(schema.transactions)
          .innerJoin(
            schema.listings,
            dsql`${schema.transactions.listingId} = ${schema.listings.id}`,
          )
          .where(inArray(schema.listings.passportId, ids))
          .groupBy(schema.listings.passportId),
      );
      const events = await countBy(
        tx
          .select({ id: schema.passportEvents.passportId, n: dsql<number>`count(*)` })
          .from(schema.passportEvents)
          .where(inArray(schema.passportEvents.passportId, ids))
          .groupBy(schema.passportEvents.passportId),
      );
      const reports = await countBy(
        tx
          .select({ id: schema.qualityReports.passportId, n: dsql<number>`count(*)` })
          .from(schema.qualityReports)
          .where(inArray(schema.qualityReports.passportId, ids))
          .groupBy(schema.qualityReports.passportId),
      );
      const readings = await countBy(
        tx
          .select({ id: schema.sensorReadings.passportId, n: dsql<number>`count(*)` })
          .from(schema.sensorReadings)
          .where(inArray(schema.sensorReadings.passportId, ids))
          .groupBy(schema.sensorReadings.passportId),
      );

      const rows: CuratedPassportRow[] = passports.map((p) => ({
        passportId: p.id,
        productName: p.productName,
        customAttributes: p.customAttributes as Record<string, unknown> | null,
        listingStatuses: listings.filter((l) => l.passportId === p.id).map((l) => l.status),
        transactions: transactions.get(p.id) ?? 0,
        events: events.get(p.id) ?? 0,
        qualityReports: reports.get(p.id) ?? 0,
        sensorReadings: readings.get(p.id) ?? 0,
      }));
      const plan = planSpareRetirement(rows);

      for (const product of plan) {
        retired += product.retire.length;
        protectedCount += product.protected.length;
        console.log(
          `${product.catalogueKey}: keep ${product.keep ? `"${product.keep.productName}"` : '(none)'}, ` +
            `${dryRun ? 'would delete' : 'delete'} ${product.retire.length}, left alone ${product.protected.length}`,
        );
        for (const spare of product.retire) {
          console.log(`  ${dryRun ? 'would delete' : 'delete'} "${spare.productName}"`);
        }
        for (const spare of product.protected) {
          console.log(`  left alone "${spare.productName}": ${spare.reasons.join('; ')}`);
        }
      }

      if (dryRun || retired === 0) return;
      const retireIds = plan.flatMap((product) => product.retire.map((spare) => spare.passportId));
      const deleted = await tx
        .delete(schema.materialPassports)
        .where(inArray(schema.materialPassports.id, retireIds))
        .returning({ id: schema.materialPassports.id });
      if (deleted.length !== retireIds.length) {
        throw new Error(
          `Expected to delete ${retireIds.length} passport(s), deleted ${deleted.length}`,
        );
      }
    });

    console.log(
      `${dryRun ? 'Would delete' : 'Deleted'} ${retired} spare curated passport(s) on ${target.description}; ` +
        `left alone ${protectedCount}.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Retiring spare demo passports failed:', error);
  process.exit(1);
});
