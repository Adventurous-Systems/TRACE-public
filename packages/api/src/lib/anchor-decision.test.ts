import { describe, expect, it } from 'vitest';
import { decideAnchorAction } from './anchor-decision.js';

const HASH_A = `0x${'a'.repeat(64)}`;
const HASH_B = `0x${'b'.repeat(64)}`;

describe('decideAnchorAction', () => {
  it('registers a passport that was never submitted', () => {
    expect(
      decideAnchorAction({ blockchainTxHash: null, blockchainPassportHash: null }, HASH_A),
    ).toBe('register');
  });

  it('registers a simulated passport (fingerprint stored, no transaction)', () => {
    expect(
      decideAnchorAction({ blockchainTxHash: null, blockchainPassportHash: HASH_A }, HASH_A),
    ).toBe('register');
  });

  it('skips an anchored passport whose fingerprint is unchanged', () => {
    expect(
      decideAnchorAction({ blockchainTxHash: '0xtx', blockchainPassportHash: HASH_A }, HASH_A),
    ).toBe('skip');
  });

  // The bug this replaces: re-anchor jobs after e.g. a conditionGrade change
  // were skipped because a tx hash already existed, leaving the chain stale.
  it('updates an anchored passport whose fingerprint changed', () => {
    expect(
      decideAnchorAction({ blockchainTxHash: '0xtx', blockchainPassportHash: HASH_A }, HASH_B),
    ).toBe('update');
  });
});
