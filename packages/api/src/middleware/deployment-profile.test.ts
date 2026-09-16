import { describe, expect, it } from 'vitest';
import { curatedBrowseOnly, isReadOnlyProfile, isRequestAllowed } from './deployment-profile.js';

describe('deployment profile access policy', () => {
  it('preserves all methods for self-hosted deployments', () => {
    expect(isReadOnlyProfile('self_hosted')).toBe(false);
    expect(isRequestAllowed('self_hosted', 'POST')).toBe(true);
    expect(isRequestAllowed('self_hosted', 'DELETE')).toBe(true);
  });

  it('allows buyer interactions while preserving role-based authorization', () => {
    expect(isReadOnlyProfile('public_buyer_demo')).toBe(false);
    expect(isRequestAllowed('public_buyer_demo', 'POST')).toBe(true);
    expect(isRequestAllowed('public_buyer_demo', 'PATCH')).toBe(true);
  });
  it.each(['GET', 'HEAD', 'OPTIONS'])('allows %s in the public showcase', (method) => {
    expect(isRequestAllowed('public_showcase', method)).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects %s in the public showcase', (method) => {
    expect(isRequestAllowed('public_showcase', method)).toBe(false);
  });

  it('keeps the reserved sandbox profile fail-closed until it is implemented', () => {
    expect(isReadOnlyProfile('public_sandbox')).toBe(true);
    expect(isRequestAllowed('public_sandbox', 'POST')).toBe(false);
  });
});

describe('curated browse policy', () => {
  it.each([
    ['self_hosted', false],
    ['public_showcase', false],
    ['public_buyer_demo', true],
    ['public_sandbox', false],
  ] as const)('curatedBrowseOnly(%s) is %s', (profile, expected) => {
    expect(curatedBrowseOnly(profile)).toBe(expected);
  });
});
