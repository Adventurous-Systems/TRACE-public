/**
 * Apply catalogue corrections (e.g. a category or name fix) to the curated
 * passports and lots that already exist, without touching visitor data.
 *
 * demo:restore also converges catalogue fields, but it rewrites names, grades
 * and transactions and is banned on the public demo. This command changes only
 * the allowlisted fields in lib/catalogue-corrections.ts (category,
 * subcategory, reclaimed-by). A corrected passport's fingerprint changes, so:
 *   - an anchored passport is marked pending (anchor columns cleared) and the
 *     anchor worker's sweep re-anchors it on chain (repairing ownership where
 *     needed); nothing is ever left with a stale anchor;
 *   - an unanchored passport gets its fingerprint recomputed, as demo-replenish
 *     does, so verify-integrity matches in simulated deployments too.
 *
 * Usage:
 *   pnpm --filter @trace/db demo:correct-catalogue -- --env demo --dry-run
 *   pnpm --filter @trace/db demo:correct-catalogue -- --env demo --yes
 */
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql as dsql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../drizzle/schema.js';
import { computePassportHash } from '../src/passport-hash.js';
import { CATALOG, CATALOGUE_LOCK_NAME, SEED_TAG } from './lib/catalogue.js';
import { catalogueCorrections, isCatalogueLot } from './lib/catalogue-corrections.js';
import { resolveTarget } from './lib/guard.js';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const target = resolveTarget(argv);
  if (!dryRun && !argv.includes('--yes')) {
    throw new Error('Refusing to correct passports without --yes. Use --dry-run to preview.');
  }

  const client = postgres(target.databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });
  let corrected = 0;
  let reanchor = 0;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(dsql`select pg_advisory_xact_lock(hashtext(${CATALOGUE_LOCK_NAME}))`);
      const curated = await tx
        .select()
        .from(schema.materialPassports)
        .where(dsql`${schema.materialPassports.customAttributes}->>'seedSource' = ${SEED_TAG}`);

      for (const product of CATALOG) {
        for (const passport of curated.filter((p) => isCatalogueLot(p, product))) {
          const corrections = catalogueCorrections(passport, product);
          const fields = Object.keys(corrections);
          if (fields.length === 0) continue;

          const anchored = Boolean(passport.blockchainTxHash);
          console.log(
            `  ${dryRun ? 'would correct' : 'corrected'} ${passport.productName}: ` +
              fields
                .map((f) => `${f} → ${JSON.stringify(corrections[f as keyof typeof corrections])}`)
                .join(', ') +
              (anchored ? '  [anchored: will be re-anchored]' : ''),
          );
          corrected += 1;
          if (anchored) reanchor += 1;
          if (dryRun) continue;

          await tx
            .update(schema.materialPassports)
            .set({ ...corrections, updatedAt: new Date() })
            .where(eq(schema.materialPassports.id, passport.id));

          if (anchored) {
            await tx
              .update(schema.materialPassports)
              .set({
                blockchainPassportHash: null,
                blockchainTxHash: null,
                blockchainAnchoredAt: null,
              })
              .where(eq(schema.materialPassports.id, passport.id));
          } else {
            const persisted = await tx.query.materialPassports.findFirst({
              where: eq(schema.materialPassports.id, passport.id),
            });
            await tx
              .update(schema.materialPassports)
              .set({
                blockchainPassportHash: computePassportHash(persisted!),
                blockchainAnchoredAt: passport.blockchainAnchoredAt ?? new Date(),
              })
              .where(eq(schema.materialPassports.id, passport.id));
          }
        }
      }
    });

    console.log(
      `${dryRun ? 'Would correct' : 'Corrected'} ${corrected} passport(s) for ${target.env}` +
        (reanchor
          ? `; ${reanchor} anchored passport(s) ${dryRun ? 'would be' : 'are'} queued for re-anchoring by the worker's sweep.`
          : '.'),
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
