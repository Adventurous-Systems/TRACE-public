import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the repo-root .env for local dev. In containers the env is injected by
// docker compose and no .env file is present, so dotenv silently no-ops there.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  console.log('Running migrations...');

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  await migrate(db, {
    migrationsFolder: path.join(__dirname, '../migrations'),
  });

  await client.end();
  console.log('Migrations complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
