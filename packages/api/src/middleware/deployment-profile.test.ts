import { describe, expect, it } from 'vitest';
import { isReadOnlyProfile, isRequestAllowed } from './deployment-profile.js';

describe('deployment profile access policy', () => {
  it('preserves all methods for self-hosted deployments', () => {
    expect(isReadOnlyProfile('self_hosted')).toBe(false);
    expect(isRequestAllowed('self_hosted', 'POST')).toBe(true);
    expect(isRequestAllowed('self_hosted', 'DELETE')).toBe(true);
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
