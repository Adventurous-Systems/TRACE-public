/**
 * Move a deployment's stored files out of MinIO into the plain-file store
 * (R4), and record each in stored_objects. See scripts/lib/storage-import.ts.
 *
 * Each file the database refers to is fetched from its stored URL: nginx
 * serves /minio/ from disk and falls back to MinIO for anything not copied
 * yet, so no MinIO credentials or network access are needed. `--origin`
 * fetches from MinIO directly instead (http://minio:9000 → /<bucket>/<key>).
 *
 * Usage (env: DATABASE_URL, TRACE_ENV and STORAGE_DIR as for the API):
 *   pnpm --filter @trace/db storage:import -- --env demo --dry-run
 *   pnpm --filter @trace/db storage:import -- --env demo --yes
 *
 * Exits non-zero if any referenced file could not be copied; the rest are
 * still copied and recorded, and a re-run picks up where it stopped.
 */
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as dsql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../drizzle/schema.js';
import { resolveTarget } from './lib/guard.js';
import { scriptObjectStore } from './lib/catalogue-photos.js';
import { importObjects, type Fetched, type StoredReference } from './lib/storage-import.js';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function fetchObject(url: string): Promise<Fetched> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
  const length = response.headers.get('content-length');
  return {
    status: response.status,
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type'),
    contentLength: length === null ? null : Number(length),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const target = resolveTarget(argv);
  if (!dryRun && !argv.includes('--yes')) {
    throw new Error('Refusing to copy files without --yes. Use --dry-run to preview.');
  }
  const origin = option(argv, '--origin')?.replace(/\/+$/, '');
  const store = scriptObjectStore();
  if (!dryRun) await store.checkWritable();

  const client = postgres(target.databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    // Passport QR codes and photos first, then quality reports' copies.
    const rows = await db.execute<{
      url: string;
      passport_id: string;
      organisation_id: string;
      seeded: boolean;
    }>(dsql`
      select u.url, p.id as passport_id, p.organisation_id,
             (p.custom_attributes->>'seedSource') is not null as seeded
        from material_passports p
        cross join lateral (
          select p.qr_code_url as url, 0 as ord where p.qr_code_url is not null
          union all
          select jsonb_array_elements_text(coalesce(p.condition_photos, '[]'::jsonb)), 1
        ) u
      union all
      select jsonb_array_elements_text(coalesce(q.photo_urls, '[]'::jsonb)), p.id,
             p.organisation_id, (p.custom_attributes->>'seedSource') is not null
        from quality_reports q join material_passports p on p.id = q.passport_id
    `);
    const refs: StoredReference[] = rows.map((row) => ({
      url: row.url,
      passportId: row.passport_id,
      organisationId: row.organisation_id,
      seeded: row.seeded,
    }));

    const report = await importObjects({
      refs,
      store,
      sourceUrl: (ref, bucket, key) => (origin ? `${origin}/${bucket}/${key}` : ref.url),
      fetchObject,
      dryRun,
    });

    let recorded = 0;
    if (!dryRun && report.records.length > 0) {
      const inserted = await db
        .insert(schema.storedObjects)
        .values(report.records)
        .onConflictDoNothing()
        .returning({ id: schema.storedObjects.id });
      recorded = inserted.length;
    }

    console.log(`storage-import ${dryRun ? '(dry run) ' : ''}for ${target.description}`);
    console.log(`  store:          ${store.root}`);
    console.log(`  referenced:     ${report.referenced} file(s)`);
    console.log(`  already on disk: ${report.alreadyOnDisk}`);
    console.log(`  ${dryRun ? 'would copy' : 'copied'}:         ${report.fetched}`);
    if (!dryRun) console.log(`  newly recorded: ${recorded}`);
    if (report.foreign.length > 0) {
      console.log(`  not ours (left as they are): ${report.foreign.length}`);
      for (const url of report.foreign) console.log(`    ${url}`);
    }
    if (report.failed.length > 0) {
      console.error(`  FAILED: ${report.failed.length}`);
      for (const failure of report.failed) console.error(`    ${failure.url}: ${failure.reason}`);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Storage import failed:', error);
  process.exit(1);
});
