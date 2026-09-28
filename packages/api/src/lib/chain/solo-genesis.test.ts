import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSoloGenesis } from './solo-genesis.js';

const REPO_GENESIS = JSON.parse(
  readFileSync(new URL('../../../../../genesis.json', import.meta.url), 'utf8'),
) as { accounts: Array<{ address: string }> };

describe('buildSoloGenesis', () => {
  it('matches the repository genesis.json apart from the funded address', () => {
    const address = REPO_GENESIS.accounts[0]!.address;
    expect(buildSoloGenesis(address)).toEqual(REPO_GENESIS);
  });

  it('funds only the given deployer', () => {
    const address = '0x1111111111111111111111111111111111111111';
    const genesis = buildSoloGenesis(address);
    expect(genesis.accounts.map((a) => a.address)).toEqual([address]);
    expect(genesis.authority[0]!.masterAddress).toBe(address);
  });

  it('rejects anything that is not an address', () => {
    expect(() => buildSoloGenesis('0x1234')).toThrow();
  });
});
