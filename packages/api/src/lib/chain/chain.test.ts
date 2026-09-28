import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bytes32ToUuid, uuidToBytes32 } from './ids.js';

const API_SRC = fileURLToPath(new URL('../../', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('chain SDK boundary', () => {
  // TRACE must be able to move from VeChain to any EVM chain by adding an
  // adapter. That only holds while chain SDKs stay inside lib/chain/.
  it('imports @vechain/* only from lib/chain/', () => {
    const offenders = sourceFiles(API_SRC)
      .filter((file) => !relative(API_SRC, file).startsWith(`lib${sep}chain${sep}`))
      .filter((file) => /from\s+['"]@vechain\//.test(readFileSync(file, 'utf8')))
      .map((file) => relative(API_SRC, file));

    expect(offenders).toEqual([]);
  });
});

describe('passport id encoding', () => {
  const uuid = '3b2f6c1e-9a4d-4f6b-8c2e-1d5a7b9c0e2f';

  it('left-pads a UUID into bytes32', () => {
    const encoded = uuidToBytes32(uuid);
    expect(encoded).toMatch(/^0x[0-9a-f]{64}$/);
    expect(encoded.endsWith(uuid.replace(/-/g, ''))).toBe(true);
    expect(encoded.slice(2, 34)).toBe('0'.repeat(32));
  });

  it('round-trips bytes32 back to the UUID', () => {
    expect(bytes32ToUuid(uuidToBytes32(uuid))).toBe(uuid);
  });
});
