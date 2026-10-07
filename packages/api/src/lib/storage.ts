/**
 * Object storage for the API: plain files (see @trace/db object-store) plus
 * the stored_objects ledger that the upload limits are checked against.
 */
import { TraceError } from '@trace/core';
import { createFileObjectStore, db, storedObjects, type FileObjectStore } from '@trace/db';
import { and, eq, sql } from 'drizzle-orm';
import { env } from '../env.js';

/** Photos and QR codes live here; the bucket is part of every stored URL. */
export const PASSPORT_BUCKET = 'passports';

export type StoredKind = 'photo' | 'qr' | 'catalogue';

let store: FileObjectStore | undefined;

export function objectStore(): FileObjectStore {
  store ??= createFileObjectStore({
    root: env.STORAGE_DIR,
    publicBaseUrl: env.STORAGE_PUBLIC_URL ?? env.MINIO_PUBLIC_URL ?? `${env.WEB_URL}/minio`,
  });
  return store;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Write a file and record it in the ledger. Returns the public URL. A retried
 * write of the same bytes is accepted and recorded once.
 */
export async function storeObject(
  input: {
    key: string;
    buffer: Buffer;
    contentType: string;
    kind: StoredKind;
    organisationId: string | null;
    passportId: string | null;
  },
  tx: Tx | typeof db = db,
): Promise<string> {
  const stored = await objectStore().put(
    PASSPORT_BUCKET,
    input.key,
    input.buffer,
    input.contentType,
  );
  await tx
    .insert(storedObjects)
    .values({
      bucket: stored.bucket,
      key: stored.key,
      kind: input.kind,
      organisationId: input.organisationId,
      passportId: input.passportId,
      bytes: stored.bytes,
      sha256: stored.sha256,
      contentType: stored.contentType,
    })
    .onConflictDoNothing();
  return stored.url;
}

/** 507 when the disk that holds the store is nearly full. */
export async function assertDiskHasRoom(): Promise<void> {
  if ((await objectStore().freeBytes()) < env.STORAGE_MIN_FREE_BYTES) {
    throw new TraceError(
      'Photo uploads are paused because the server is low on storage. Please try again later.',
      'STORAGE_FULL',
      507,
    );
  }
}

/**
 * 413 when this upload would take the organisation past its quota. Call it
 * inside the transaction that records the upload: it takes a per-organisation
 * lock, so two uploads at once can't both fit under the limit.
 */
export async function assertWithinQuota(tx: Tx, organisationId: string, bytes: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`storage:${organisationId}`}))`);
  const [row] = await tx
    .select({ used: sql<string>`coalesce(sum(${storedObjects.bytes}), 0)` })
    .from(storedObjects)
    .where(and(eq(storedObjects.organisationId, organisationId), eq(storedObjects.kind, 'photo')));
  const used = Number(row?.used ?? 0);
  if (used + bytes > env.ORG_STORAGE_QUOTA_BYTES) {
    throw new TraceError(
      `Your organisation has used its photo storage (${formatMb(env.ORG_STORAGE_QUOTA_BYTES)}). ` +
        'Contact the platform team if you need more.',
      'STORAGE_QUOTA_EXCEEDED',
      413,
    );
  }
}

export function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * For readiness: the store can be written. A full disk pauses uploads (see
 * assertDiskHasRoom) but must not take the site down, so it is reported apart.
 */
export async function checkStorage(): Promise<{ writable: boolean; hasRoom: boolean }> {
  try {
    await objectStore().checkWritable();
  } catch {
    return { writable: false, hasRoom: false };
  }
  try {
    return {
      writable: true,
      hasRoom: (await objectStore().freeBytes()) >= env.STORAGE_MIN_FREE_BYTES,
    };
  } catch {
    return { writable: true, hasRoom: false };
  }
}
