/** Cancel only surplus active, generated demo lots while preserving all history. */
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray, sql as dsql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../drizzle/schema.js';
import { CATALOGUE_LOCK_NAME } from './lib/catalogue.js';
import { eligibleDemoLot, planDemoLotTrim } from './lib/demo-trim-policy.js';
import { resolveTarget } from './lib/guard.js';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

function parseTargetActive(argv: string[]): number {
  const index = argv.indexOf('--target-active');
  const target = Number(index >= 0 ? argv[index + 1] : '1');
  if (!Number.isInteger(target) || target < 1 || target > 10) {
    throw new Error('--target-active must be an integer from 1 to 10');
  }
  return target;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const targetActive = parseTargetActive(argv);
  const target = resolveTarget(argv);
  if (!dryRun && !argv.includes('--yes')) {
    throw new Error('Refusing to cancel surplus lots without --yes. Use --dry-run to preview.');
  }

  const client = postgres(target.databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    let cancelled = 0;
    let protectedCount = 0;
    await db.transaction(async (tx) => {
      await tx.execute(dsql`select pg_advisory_xact_lock(hashtext(${CATALOGUE_LOCK_NAME}))`);
      const rows = await tx
        .select({
          listingId: schema.listings.id,
          passportId: schema.listings.passportId,
          customAttributes: schema.materialPassports.customAttributes,
        })
        .from(schema.listings)
        .innerJoin(
          schema.materialPassports,
          eq(schema.listings.passportId, schema.materialPassports.id),
        )
        .where(eq(schema.listings.status, 'active'));
      const listingIds = rows.map((row) => row.listingId);
      const transactionRows = listingIds.length
        ? await tx
            .select({ listingId: schema.transactions.listingId })
            .from(schema.transactions)
            .where(inArray(schema.transactions.listingId, listingIds))
        : [];
      const transactionListingIds = new Set(transactionRows.map((row) => row.listingId));
      const eligible = rows
        .map((row) =>
          eligibleDemoLot({
            ...row,
            hasTransaction: transactionListingIds.has(row.listingId),
          }),
        )
        .filter((row): row is NonNullable<typeof row> => row !== undefined);
      const plan = planDemoLotTrim(eligible, targetActive);

      for (const product of plan) {
        cancelled += product.cancelIds.length;
        protectedCount += product.protectedIds.length;
        console.log(
          `${product.catalogueKey}: ${product.active} active / ${targetActive} target, ` +
            `${dryRun ? 'would cancel' : 'cancel'} ${product.cancelIds.length}, ` +
            `protected ${product.protectedIds.length}`,
        );
      }

      if (dryRun || cancelled === 0) return;
      const cancelIds = plan.flatMap((product) => product.cancelIds);
      const cancelRows = rows.filter((row) => cancelIds.includes(row.listingId));
      await tx
        .update(schema.listings)
        .set({ status: 'cancelled' })
        .where(inArray(schema.listings.id, cancelIds));
      await tx
        .update(schema.materialPassports)
        .set({ status: 'active', updatedAt: new Date() })
        .where(
          inArray(
            schema.materialPassports.id,
            cancelRows.map((row) => row.passportId),
          ),
        );
    });

    console.log(
      `${dryRun ? 'Would cancel' : 'Cancelled'} ${cancelled} surplus demo lot(s) for ${target.description}; ` +
        `preserved ${protectedCount} transaction-linked excess lot(s).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Demo active-lot trim failed:', error);
  process.exit(1);
});
