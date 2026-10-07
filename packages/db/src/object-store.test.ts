import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFileObjectStore, ObjectConflictError } from './object-store.js';

async function withStore(
  run: (store: ReturnType<typeof createFileObjectStore>, root: string) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), 'trace-objects-'));
  try {
    await run(createFileObjectStore({ root, publicBaseUrl: 'https://demo.example/minio/' }), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('put stores the file at bucket/key and returns the MinIO-shaped URL', () =>
  withStore(async (store, root) => {
    const stored = await store.put(
      'passports',
      'passports/p1/photos/1.jpg',
      Buffer.from('a'),
      'image/jpeg',
    );
    assert.equal(stored.url, 'https://demo.example/minio/passports/passports/p1/photos/1.jpg');
    assert.equal(stored.bytes, 1);
    assert.equal(stored.created, true);
    const file = path.join(root, 'passports', 'passports', 'p1', 'photos', '1.jpg');
    assert.equal(await readFile(file, 'utf8'), 'a');
    assert.equal((await stat(file)).mode & 0o777, 0o644);
    assert.deepEqual(await readdir(path.join(root, '.incoming')), []);
  }));

test('the same bytes again are accepted; different bytes are refused', () =>
  withStore(async (store) => {
    await store.put('passports', 'k/qr.png', Buffer.from('one'), 'image/png');
    const again = await store.put('passports', 'k/qr.png', Buffer.from('one'), 'image/png');
    assert.equal(again.created, false);
    await assert.rejects(
      store.put('passports', 'k/qr.png', Buffer.from('two'), 'image/png'),
      ObjectConflictError,
    );
    assert.equal((await store.read('passports', 'k/qr.png')).toString(), 'one');
  }));

test('keys that could escape the root or name a hidden file are refused', () =>
  withStore(async (store) => {
    for (const [bucket, key] of [
      ['passports', '../x.jpg'],
      ['passports', 'a/../../x.jpg'],
      ['passports', '/abs.jpg'],
      ['passports', 'a//b.jpg'],
      ['passports', '.incoming/x'],
      ['..', 'x.jpg'],
      ['passports', ''],
    ] as const) {
      await assert.rejects(
        store.put(bucket, key, Buffer.from('x'), 'image/jpeg'),
        /Invalid object/,
      );
    }
  }));

test('locate reads bucket and key back from a stored URL on any origin', () =>
  withStore(async (store) => {
    assert.deepEqual(store.locate('http://localhost:3003/minio/passports/passports/p1/qr.png'), {
      bucket: 'passports',
      key: 'passports/p1/qr.png',
    });
    assert.equal(store.locate('https://demo.example/other/passports/x.jpg'), null);
    assert.equal(store.locate('https://demo.example/minio/passports/.incoming/x'), null);
    assert.equal(store.locate('not a url'), null);
  }));

test('freeBytes and checkWritable report on the root', () =>
  withStore(async (store) => {
    assert.ok((await store.freeBytes()) > 0);
    await store.checkWritable();
    assert.equal(await store.exists('passports', 'nope.jpg'), false);
  }));
