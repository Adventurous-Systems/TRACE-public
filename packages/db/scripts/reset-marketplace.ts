/**
 * Marketplace data reset.
 *
 * Removes ALL material passports and listings (and everything that hangs off
 * them) so the platform can be re-seeded with a curated catalogue. Audit logs,
 * blockchain-transaction records, users and organisations are left untouched.
 *
 * Deletion order is FK-safe and explicit (even though most children cascade
 * from material_passports) so the effect is obvious when reviewing prod runs.
 *
 *   material_passports  ─cascade→ passport_events, quality_reports,
 *                                 sensor_readings, listings
 *   listings            ─cascade→ transactions
 *
 * Usage:
 *   pnpm --filter @trace/db reset:marketplace -- [--dry-run] [--yes]
 *
 * Safety:
 *   - --dry-run prints the row counts that WOULD be deleted and writes nothing.
 *   - Without --dry-run you must pass --yes to actually delete (guards against
 *     an accidental prod wipe).
 *   - Runs inside a single transaction.
 */
import { config as loadEnv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { resolveTarget } from './lib/guard.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..');
loadEnv({ path: path.resolve(PACKAGE_ROOT, '../../.env') });

const TABLES_IN_DELETE_ORDER = [
  'transactions',
  'sensor_readings',
  'quality_reports',
  'passport_events',
  'listings',
  'material_passports',
] as const;

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const confirmed = argv.includes('--yes');

  // Fails closed unless --env matches the deployment's declared TRACE_ENV.
  // This script truncates the entire marketplace; it previously had no
  // environment check at all, so a stale DATABASE_URL was enough to wipe prod.
  const target = resolveTarget(argv);
  const url = target.databaseUrl;

  if (!dryRun && !confirmed) {
    console.error(
      'Refusing to delete without --yes. Re-run with --dry-run to preview, or --yes to apply.',
    );
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  console.log(
    `\nMarketplace reset — ${dryRun ? 'DRY-RUN (no writes)' : 'LIVE (writes enabled)'}` +
      `\n  target: ${target.description}\n`,
  );

  try {
    // Show current counts. Table names come from a fixed const list (never user
    // input), so `.unsafe` interpolation is safe here.
    for (const table of TABLES_IN_DELETE_ORDER) {
      const rows = await sql.unsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM ${table}`,
      );
      console.log(`  ${table.padEnd(20)} ${rows[0]?.count ?? 0}`);
    }

    if (dryRun) {
      console.log('\nDry run complete — re-run with --yes to delete the above.');
      return;
    }

    await sql.begin(async (tx) => {
      for (const table of TABLES_IN_DELETE_ORDER) {
        const deleted = await tx.unsafe(`DELETE FROM ${table}`);
        console.log(`  deleted ${String(deleted.count).padStart(4)} from ${table}`);
      }
    });

    console.log('\nMarketplace data cleared. Audit logs, users and organisations untouched.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Marketplace reset failed:', err);
  process.exit(1);
});
