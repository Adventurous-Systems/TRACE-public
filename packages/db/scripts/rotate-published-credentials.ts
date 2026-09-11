/**
 * Rotate platform-owned demo accounts and disable explicitly listed legacy
 * workshop accounts. Passwords are supplied at runtime and never printed.
 *
 * Usage:
 *   ROTATE_ACCOUNT_EMAILS='one@example.com,two@example.com' \
 *   pnpm --filter @trace/db rotate:credentials -- --env staging --dry-run
 *   pnpm --filter @trace/db rotate:credentials -- --env staging --yes
 */
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import {
  DEMO_PERSONA_LIST,
  demoPersonaPassword,
  type DemoPersona,
} from '@trace/core/constants/demo-personas';
import * as schema from '../drizzle/schema.js';
import { resolveTarget } from './lib/guard.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(SCRIPT_DIR, '../../../.env') });

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const confirmed = argv.includes('--yes');
  const target = resolveTarget(argv);

  if (!dryRun && !confirmed) {
    throw new Error('Refusing to rotate credentials without --yes; use --dry-run to preview');
  }

  const demoByEmail = new Map<string, DemoPersona>(
    DEMO_PERSONA_LIST.map((persona) => [persona.email.toLowerCase(), persona]),
  );
  const legacyEmails = (process.env['ROTATE_ACCOUNT_EMAILS'] ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const emails = new Set([...demoByEmail.keys(), ...legacyEmails]);

  const client = postgres(target.databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });
  let rotated = 0;
  let absent = 0;

  try {
    console.log(
      `Credential rotation — ${dryRun ? 'DRY-RUN' : 'LIVE'}\n  target: ${target.description}`,
    );
    for (const email of emails) {
      const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
      if (!user) {
        absent++;
        console.log(`  absent   ${email}`);
        continue;
      }

      const persona = demoByEmail.get(email);
      const password = persona
        ? demoPersonaPassword(persona, process.env)
        : randomBytes(32).toString('base64url');

      if (!dryRun) {
        await db
          .update(schema.users)
          .set({ passwordHash: await bcrypt.hash(password, 12) })
          .where(eq(schema.users.id, user.id));
      }
      rotated++;
      console.log(`  ${dryRun ? 'would rotate' : 'rotated'} ${email}`);
    }
  } finally {
    await client.end();
  }

  console.log(`Done: ${rotated} rotated, ${absent} absent; no passwords were printed.`);
}

main().catch((error) => {
  console.error('Credential rotation failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
