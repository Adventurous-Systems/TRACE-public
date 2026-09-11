/**
 * Recompute stored passport fingerprints after a canonical-document change.
 *
 * WHY THIS EXISTS
 * The fingerprint in `material_passports.blockchain_passport_hash` is a
 * keccak256 of the canonical JSON-LD document built in ../src/passport-hash.ts.
 * If that document's shape changes, every previously stored hash stops matching
 * a fresh recomputation, and the public /verify-integrity endpoint reports
 * "Mismatch" on passports nobody has tampered with. This script realigns them.
 *
 * It was written for the 2026-09-01 change that removed `status` from the
 * document (marketplace lifecycle state was making a legitimate purchase look
 * like tampering), but it is deliberately generic: run it after ANY deliberate
 * change to the canonical document, immediately after deploying that change.
 *
 * SAFETY
 *   - Refuses to touch a passport that has an on-chain transaction hash
 *     (blockchain_tx_hash IS NOT NULL) unless --include-anchored is passed.
 *     Rehashing an anchored passport silently de-synchronises it from what is
 *     recorded on chain; that needs a re-anchor, not a database update.
 *   - --dry-run previews every row and writes nothing.
 *   - A live run requires --yes.
 *   - Requires --env to match TRACE_ENV (see ./lib/guard.ts).
 *
 * Usage:
 *   pnpm --filter @trace/db rehash:passports -- --env local --dry-run
 *   pnpm --filter @trace/db rehash:passports -- --env demo-production --yes
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, isNotNull } from 'drizzle-orm';
import * as schema from '../drizzle/schema.js';
import { computePassportHash } from '../src/passport-hash.js';
import { resolveTarget } from './lib/guard.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(SCRIPT_DIR, '../../../.env') });

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const confirmed = argv.includes('--yes');
  const includeAnchored = argv.includes('--include-anchored');

  const target = resolveTarget(argv);

  if (!dryRun && !confirmed) {
    console.error('\nRefusing to write without --yes. Re-run with --dry-run to preview.');
    process.exit(1);
  }

  console.log(
    `\nPassport rehash — ${dryRun ? 'DRY-RUN (no writes)' : 'LIVE (writes enabled)'}` +
      `\n  target: ${target.description}\n`,
  );

  const client = postgres(target.databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    const passports = await db
      .select()
      .from(schema.materialPassports)
      .where(isNotNull(schema.materialPassports.blockchainPassportHash));

    let unchanged = 0;
    let updated = 0;
    let skippedAnchored = 0;

    for (const passport of passports) {
      const recomputed = computePassportHash(passport);
      const stored = passport.blockchainPassportHash;

      if (recomputed === stored) {
        unchanged += 1;
        continue;
      }

      if (passport.blockchainTxHash && !includeAnchored) {
        skippedAnchored += 1;
        console.log(
          `  SKIP (anchored on chain): ${passport.productName}` +
            `\n       tx ${passport.blockchainTxHash}` +
            '\n       rehashing would de-sync it from the chain — re-anchor instead,' +
            '\n       or pass --include-anchored if you know what you are doing.',
        );
        continue;
      }

      if (dryRun) {
        console.log(`  would update: ${passport.productName}`);
        console.log(`       ${stored} -> ${recomputed}`);
      } else {
        await db
          .update(schema.materialPassports)
          .set({ blockchainPassportHash: recomputed, updatedAt: new Date() })
          .where(eq(schema.materialPassports.id, passport.id));
        console.log(`  updated: ${passport.productName}`);
      }
      updated += 1;
    }

    console.log(
      `\n${dryRun ? 'Would rehash' : 'Rehashed'} ${updated}, already correct ${unchanged}` +
        `${skippedAnchored ? `, skipped ${skippedAnchored} anchored` : ''}` +
        ` (of ${passports.length} with a stored fingerprint).\n`,
    );

    if (skippedAnchored > 0) {
      console.log('Anchored passports were skipped — they need a re-anchor, not a rehash.\n');
      process.exitCode = 2;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
