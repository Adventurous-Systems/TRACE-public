/**
 * Catalogue photos for the seed and top-up scripts. Each catalogue image is
 * stored once, keyed by its content, and every lot of that product points at
 * the same file (HANDOVER C5: each new lot used to store its own copy).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema.js';
import { createFileObjectStore, sha256Hex, type FileObjectStore } from '../../src/object-store.js';

export const PASSPORT_BUCKET = 'passports';

/** The same settings, and defaults, as the API (packages/api/src/env.ts). */
export function scriptObjectStore(): FileObjectStore {
  const publicBaseUrl =
    // `||`, not `??`: an empty value (as in .env.example) means "not set",
    // exactly as the API's env schema treats it.
    process.env['STORAGE_PUBLIC_URL'] ||
    process.env['MINIO_PUBLIC_URL'] ||
    `${process.env['WEB_URL'] || 'http://localhost:3000'}/minio`;
  return createFileObjectStore({
    root: process.env['STORAGE_DIR'] || '/var/lib/trace/objects',
    publicBaseUrl,
  });
}

type Db = Pick<PostgresJsDatabase<typeof schema>, 'insert'>;

/** Store a catalogue image (once) and return its public URL. */
export async function storeCatalogueImage(
  db: Db,
  store: FileObjectStore,
  imagePath: string,
): Promise<string> {
  const buffer = readFileSync(imagePath);
  const key = `catalogue/${sha256Hex(buffer)}${path.extname(imagePath).toLowerCase() || '.jpg'}`;
  const stored = await store.put(PASSPORT_BUCKET, key, buffer, 'image/jpeg');
  await db
    .insert(schema.storedObjects)
    .values({
      bucket: stored.bucket,
      key: stored.key,
      kind: 'catalogue',
      organisationId: null,
      passportId: null,
      bytes: stored.bytes,
      sha256: stored.sha256,
      contentType: stored.contentType,
    })
    .onConflictDoNothing();
  return stored.url;
}
