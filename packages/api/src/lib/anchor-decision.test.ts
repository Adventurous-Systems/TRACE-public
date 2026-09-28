import { describe, expect, it } from 'vitest';
import { decideAnchorAction } from './anchor-decision.js';

const HASH_A = `0x${'a'.repeat(64)}`;
const HASH_B = `0x${'b'.repeat(64)}`;

describe('decideAnchorAction', () => {
  it('registers a passport the registry has never seen', () => {
    expect(decideAnchorAction({ registered: false, dataHash: null }, HASH_A)).toBe('register');
  });

  it('skips a passport whose anchored hash is already current', () => {
    expect(decideAnchorAction({ registered: true, dataHash: HASH_A }, HASH_A)).toBe('skip');
  });

  it('compares hashes case-insensitively', () => {
    expect(
      decideAnchorAction(
        { registered: true, dataHash: HASH_A.toUpperCase().replace('0X', '0x') },
        HASH_A,
      ),
    ).toBe('skip');
  });

  // Re-anchor after a hashed field changes (e.g. conditionGrade from a quality
  // report). The old worker skipped these because a tx hash existed.
  it('updates a registered passport whose data changed', () => {
    expect(decideAnchorAction({ registered: true, dataHash: HASH_A }, HASH_B)).toBe('update');
  });

  // updatePassport() clears the database's anchor columns on edit. Deciding
  // from the database made this "register", which the registry rejects with
  // PassportAlreadyExists — edits were never re-anchored.
  it('updates (never re-registers) an edited passport the registry already holds', () => {
    expect(decideAnchorAction({ registered: true, dataHash: HASH_A }, HASH_B)).not.toBe('register');
  });
});
