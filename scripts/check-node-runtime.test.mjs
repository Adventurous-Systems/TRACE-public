import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertNodeRuntime } from './check-node-runtime.mjs';

const script = fileURLToPath(new URL('./check-node-runtime.mjs', import.meta.url));
const run = (entry, version) => spawnSync(process.execPath, [entry, version], { encoding: 'utf8' });

test('accepts the security release and newer patches within Node 24', () => {
  for (const value of ['24.22.1', 'v24.22.1', '24.22.2', '24.23.0']) {
    assert.equal(assertNodeRuntime(value), value.replace(/^v/, ''));
  }
});

test('rejects earlier releases, EOL majors and unreviewed major upgrades', () => {
  for (const value of ['24.21.0', '24.22.0', '20.20.2', '22.23.4', '25.0.0', '26.12.1']) {
    assert.throws(() => assertNodeRuntime(value), /unsupported/);
  }
});

test('fails closed on missing, malformed or command-error output', () => {
  for (const value of [
    undefined,
    '',
    'OCI runtime exec failed',
    '24',
    '24.22.1-beta',
    '24.22.1\nother',
  ]) {
    assert.throws(() => assertNodeRuntime(value), /invalid/);
  }
});

test('the command line accepts the patched runtime and rejects an older one', () => {
  const accepted = run(script, 'v24.22.1');
  assert.equal(accepted.status, 0);
  assert.match(accepted.stdout, /Node runtime accepted: 24\.22\.1/);
  const rejected = run(script, 'v24.21.0');
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /unsupported/);
});

test('the command line still checks when reached through a symlink', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'node-runtime-check-'));
  try {
    const link = path.join(dir, 'check-node-runtime.mjs');
    symlinkSync(script, link);
    const rejected = run(link, 'v24.21.0');
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /unsupported/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
