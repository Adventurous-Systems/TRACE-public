/**
 * Check the marketplace's data invariants. Read-only: it never writes.
 *
 * Reports listings whose stock does not add up with their orders, statuses
 * that disagree with each other, stranded orders and stale fingerprints (the
 * rules are in lib/invariants.ts). Exits 1 when there is an error; warnings
 * (rows from before a model change) are listed but do not fail, unless
 * --strict is passed.
 *
 * Usage:
 *   pnpm --filter @trace/db check:invariants -- --env local
 *   pnpm --filter @trace/db check:invariants -- --env demo --strict
 */
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../drizzle/schema.js';
import { computePassportHash } from '../src/passport-hash.js';
import { resolveTarget } from './lib/guard.js';
import { checkInvariants } from './lib/invariants.js';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

async function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const target = resolveTarget(argv);
  const client = postgres(target.databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    const [listings, orders, passports] = await db.transaction(
      async (tx) =>
        Promise.all([
          tx.select().from(schema.listings),
          tx.select().from(schema.transactions),
          tx.select().from(schema.materialPassports),
        ]),
      { accessMode: 'read only', isolationLevel: 'repeatable read' },
    );

    const violations = checkInvariants({
      listings,
      orders,
      passports: passports.map((passport) => ({
        id: passport.id,
        productName: passport.productName,
        status: passport.status,
        storedHash: passport.blockchainPassportHash,
        computedHash: computePassportHash(passport),
      })),
    });

    const errors = violations.filter((v) => v.severity === 'error');
    const warnings = violations.filter((v) => v.severity === 'warning');
    for (const v of violations) {
      console.log(
        `${v.severity === 'error' ? 'ERROR  ' : 'warning'} [${v.rule}] ${v.subject}: ${v.detail}`,
      );
    }
    const pending = passports.filter((p) => !p.blockchainPassportHash && p.status !== 'draft');
    console.log(
      `\nChecked ${listings.length} listing(s), ${orders.length} order(s), ${passports.length} passport(s) ` +
        `on ${target.description}: ${errors.length} error(s), ${warnings.length} warning(s); ` +
        `${pending.length} passport(s) waiting for an anchor.`,
    );
    if (errors.length > 0 || (strict && warnings.length > 0)) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
