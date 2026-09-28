import { describe, expect, it } from 'vitest';
import { parseTrustMode, trustCopy, UNKNOWN_TRUST_MODE } from './trust-mode';

describe('parseTrustMode', () => {
  it('reads the on-chain mode, chain id and network label from /health', () => {
    expect(
      parseTrustMode({
        success: true,
        data: {
          anchorMode: 'onchain',
          chainId: 'vechain:0xabc',
          chainNetworkLabel: 'TRACE demo chain (VeChain Thor Solo)',
        },
      }),
    ).toEqual({
      anchorMode: 'onchain',
      chainId: 'vechain:0xabc',
      networkLabel: 'TRACE demo chain (VeChain Thor Solo)',
    });
  });

  it('treats anything unexpected as unknown', () => {
    expect(parseTrustMode(null)).toEqual(UNKNOWN_TRUST_MODE);
    expect(parseTrustMode({ data: { anchorMode: 'mainnet!' } }).anchorMode).toBe('unknown');
  });
});

describe('trustCopy', () => {
  it('names the configured network when anchoring is on chain', () => {
    const copy = trustCopy({
      anchorMode: 'onchain',
      chainId: 'vechain:0xabc',
      networkLabel: 'TRACE demo chain (VeChain Thor Solo)',
    });
    expect(copy.cardTitle).toBe('Blockchain Anchored');
    expect(copy.headline).toContain('TRACE demo chain (VeChain Thor Solo)');
  });

  // The landing page used to claim "blockchain-anchored … on VeChainThor"
  // while every passport was only simulated. Never again.
  it.each(['simulated', 'unknown'] as const)('never claims anchoring when %s', (anchorMode) => {
    const copy = trustCopy({ anchorMode, chainId: null, networkLabel: null });
    const text = `${copy.headline} ${copy.cardTitle} ${copy.cardDescription}`;
    expect(text).not.toMatch(/anchored on|blockchain-anchored|Blockchain Anchored|recorded on/i);
    expect(text).toMatch(/tamper-evident/i);
  });
});
