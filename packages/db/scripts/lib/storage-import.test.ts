import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFileObjectStore } from '../../src/object-store.js';
import { importObjects, type Fetched, type StoredReference } from './storage-import.js';

const BASE = 'https://demo.example/minio';
const ref = (url: string, over: Partial<StoredReference> = {}): StoredReference => ({
  url,
  passportId: 'p1',
  organisationId: 'org1',
  seeded: false,
  ...over,
});

async function withStore(run: (store: ReturnType<typeof createFileObjectStore>) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'trace-import-'));
  try {
    await run(createFileObjectStore({ root, publicBaseUrl: BASE }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function origin(objects: Record<string, string>) {
  const calls: string[] = [];
  const fetchObject = async (url: string): Promise<Fetched> => {
    calls.push(url);
    const body = objects[url];
    if (body === undefined) {
      return { status: 404, body: Buffer.alloc(0), contentType: null, contentLength: null };
    }
    return {
      status: 200,
      body: Buffer.from(body),
      contentType: 'image/jpeg',
      contentLength: Buffer.byteLength(body),
    };
  };
  return { calls, fetchObject };
}

const viaMinio = (_ref: StoredReference, bucket: string, key: string) =>
  `http://minio:9000/${bucket}/${key}`;

test('copies each referenced file once and classifies it', () =>
  withStore(async (store) => {
    const { calls, fetchObject } = origin({
      'http://minio:9000/passports/passports/p1/photos/1.jpg': 'photo',
      'http://minio:9000/passports/passports/p1/qr.png': 'qr',
      'http://minio:9000/passports/passports/p2/photos/2.jpg': 'seeded',
    });
    const report = await importObjects({
      refs: [
        ref(`${BASE}/passports/passports/p1/photos/1.jpg`),
        // A quality report's copy of the same photo.
        ref(`${BASE}/passports/passports/p1/photos/1.jpg`),
        ref(`${BASE}/passports/passports/p1/qr.png`),
        ref(`${BASE}/passports/passports/p2/photos/2.jpg`, { passportId: 'p2', seeded: true }),
      ],
      store,
      sourceUrl: viaMinio,
      fetchObject,
      dryRun: false,
    });
    assert.equal(report.referenced, 3);
    assert.equal(report.fetched, 3);
    assert.equal(calls.length, 3);
    assert.deepEqual(
      report.records.map((r) => [r.key, r.kind, r.bytes]),
      [
        ['passports/p1/photos/1.jpg', 'photo', 5],
        ['passports/p1/qr.png', 'qr', 2],
        ['passports/p2/photos/2.jpg', 'catalogue', 6],
      ],
    );
    assert.equal((await store.read('passports', 'passports/p1/qr.png')).toString(), 'qr');
  }));

test('a second run fetches nothing and still returns every ledger record', () =>
  withStore(async (store) => {
    const objects = { 'http://minio:9000/passports/k/a.jpg': 'a' };
    const refs = [ref(`${BASE}/passports/k/a.jpg`)];
    await importObjects({ refs, store, sourceUrl: viaMinio, ...origin(objects), dryRun: false });
    const second = origin(objects);
    const report = await importObjects({
      refs,
      store,
      sourceUrl: viaMinio,
      fetchObject: second.fetchObject,
      dryRun: false,
    });
    assert.equal(second.calls.length, 0);
    assert.equal(report.alreadyOnDisk, 1);
    assert.equal(report.records.length, 1);
  }));

test('reports missing objects and foreign URLs without stopping', () =>
  withStore(async (store) => {
    const report = await importObjects({
      refs: [ref(`${BASE}/passports/k/gone.jpg`), ref('https://elsewhere.example/x.jpg')],
      store,
      sourceUrl: viaMinio,
      ...origin({}),
      dryRun: false,
    });
    assert.deepEqual(report.foreign, ['https://elsewhere.example/x.jpg']);
    assert.equal(report.failed.length, 1);
    assert.match(report.failed[0]!.reason, /HTTP 404/);
    assert.equal(report.records.length, 0);
  }));

test('a dry run writes nothing', () =>
  withStore(async (store) => {
    const report = await importObjects({
      refs: [ref(`${BASE}/passports/k/a.jpg`)],
      store,
      sourceUrl: viaMinio,
      ...origin({ 'http://minio:9000/passports/k/a.jpg': 'a' }),
      dryRun: true,
    });
    assert.equal(report.fetched, 1);
    assert.equal(await store.exists('passports', 'k/a.jpg'), false);
  }));

test('a truncated response is refused', () =>
  withStore(async (store) => {
    const report = await importObjects({
      refs: [ref(`${BASE}/passports/k/a.jpg`)],
      store,
      sourceUrl: viaMinio,
      fetchObject: async () => ({
        status: 200,
        body: Buffer.from('ab'),
        contentType: 'image/jpeg',
        contentLength: 10,
      }),
      dryRun: false,
    });
    assert.match(report.failed[0]!.reason, /does not match Content-Length/);
    assert.equal(await store.exists('passports', 'k/a.jpg'), false);
  }));
