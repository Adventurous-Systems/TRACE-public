import { access } from 'node:fs/promises';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import sharp from 'sharp';
import { db, materialPassports, storedObjects, users } from '@trace/db';
import { env } from '../../env.js';
import { objectStore } from '../../lib/storage.js';
import { createTestApp, getAuthHeader, getTestPersona, type TestApp } from '../../test-utils.js';

// The supplier, not the hub: quality.test.ts compares two counts of the
// hub's passports, and uploads here run in parallel with it (rehearsal R-F2).
const SUPPLIER = getTestPersona('supplier');

async function multipart(buffer: Buffer, filename = 'photo.png', type = 'image/png') {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), filename);
  const request = new Request('http://local/upload', { method: 'POST', body: form });
  return {
    payload: Buffer.from(await request.arrayBuffer()),
    contentType: request.headers.get('content-type')!,
  };
}

const smallPng = () =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: '#a33' } })
    .png()
    .toBuffer();

describe('POST /api/v1/passports/:id/photos (storage limits)', () => {
  let app: TestApp;
  let authHeader: { authorization: string };
  let organisationId: string;
  let passportId: string;

  async function upload(buffer: Buffer) {
    const { payload, contentType } = await multipart(buffer);
    return app.inject({
      method: 'POST',
      url: `/api/v1/passports/${passportId}/photos`,
      headers: { ...authHeader, 'content-type': contentType },
      payload,
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    authHeader = await getAuthHeader(app, SUPPLIER.email, SUPPLIER.password);
    const user = await db.query.users.findFirst({ where: eq(users.email, SUPPLIER.email) });
    organisationId = user!.organisationId!;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/passports',
      headers: authHeader,
      payload: {
        productName: 'Storage limits test lot',
        categoryL1: 'structural-steel',
        conditionGrade: 'B',
        materialComposition: [{ material: 'Steel', percentage: 100, recycled: true }],
      },
    });
    passportId = res.json<{ data: { id: string } }>().data.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(storedObjects).where(like(storedObjects.key, 'test-quota/%'));
  });

  afterAll(async () => {
    await app.close();
  });

  it('stores the photo as a file and records it against the organisation', async () => {
    const res = await upload(await smallPng());
    expect(res.statusCode).toBe(200);
    const photos = res.json<{ data: { conditionPhotos: string[] } }>().data.conditionPhotos;
    const url = photos.at(-1)!;
    const location = objectStore().locate(url);
    expect(location?.key).toMatch(
      new RegExp(`^passports/${passportId}/photos/\\d+-[0-9a-f]{8}\\.jpg$`),
    );
    await access(path.join(env.STORAGE_DIR, location!.bucket, location!.key));

    const row = await db.query.storedObjects.findFirst({
      where: eq(storedObjects.key, location!.key),
    });
    expect(row).toMatchObject({ kind: 'photo', organisationId, passportId });
    expect(row!.bytes).toBeGreaterThan(0);

    // Served at its stored URL's path (STORAGE_SERVE, as on the local stack).
    const served = await app.inject({ method: 'GET', url: new URL(url).pathname });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.rawPayload.length).toBe(row!.bytes);
    const hidden = await app.inject({ method: 'GET', url: '/minio/passports/.incoming/x' });
    expect(hidden.statusCode).toBe(404);
  });

  it('refuses a file over the upload limit with 413 PHOTO_TOO_LARGE', async () => {
    const res = await upload(Buffer.alloc(env.UPLOAD_MAX_BYTES + 1));
    expect(res.statusCode).toBe(413);
    expect(res.json<{ error: { code: string; message: string } }>().error).toMatchObject({
      code: 'PHOTO_TOO_LARGE',
      message: 'Photos can be at most 10 MB',
    });
  });

  it('refuses an upload past the organisation quota with 413', async () => {
    await db.insert(storedObjects).values({
      bucket: 'passports',
      key: 'test-quota/filler.jpg',
      kind: 'photo',
      organisationId,
      passportId: null,
      bytes: env.ORG_STORAGE_QUOTA_BYTES,
      sha256: 'x',
      contentType: 'image/jpeg',
    });
    const res = await upload(await smallPng());
    expect(res.statusCode).toBe(413);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('STORAGE_QUOTA_EXCEEDED');
  });

  it('does not count QR codes or catalogue images towards the quota', async () => {
    await db.insert(storedObjects).values({
      bucket: 'passports',
      key: 'test-quota/catalogue.jpg',
      kind: 'catalogue',
      organisationId,
      passportId: null,
      bytes: env.ORG_STORAGE_QUOTA_BYTES,
      sha256: 'x',
      contentType: 'image/jpeg',
    });
    const res = await upload(await smallPng());
    expect(res.statusCode).toBe(200);
  });

  it('refuses uploads with 507 when the disk is below the free-space floor', async () => {
    vi.spyOn(objectStore(), 'freeBytes').mockResolvedValue(0);
    const res = await upload(await smallPng());
    expect(res.statusCode).toBe(507);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('STORAGE_FULL');
  });

  it('refuses a photo past the per-passport limit with 409', async () => {
    const full = Array.from({ length: env.PASSPORT_PHOTOS_MAX }, (_, i) => `http://x/${i}.jpg`);
    await db
      .update(materialPassports)
      .set({ conditionPhotos: full })
      .where(and(eq(materialPassports.id, passportId)));
    const res = await upload(await smallPng());
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toBe(
      `A passport can have at most ${env.PASSPORT_PHOTOS_MAX} photos`,
    );
  });
});
