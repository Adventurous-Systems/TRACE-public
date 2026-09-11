import { describe, it, expect } from 'vitest';
import { ApiError } from './api-client';
import { getErrorMessage } from './api-errors';

// J-10: the acceptance criterion for this fix, stated directly — a 403
// ApiError carrying the server's raw role-permission string must never
// produce a message containing that string. This single assertion is what
// the finding actually complains about ("Role 'buyer' is not permitted.
// Required: inspector, hub_admin, platform_admin" rendered as UI copy).
describe('getErrorMessage: never leaks server internals', () => {
  it('never contains the raw role-permission string from a 403', () => {
    const err = new ApiError(
      'FORBIDDEN',
      "Role 'buyer' is not permitted. Required: inspector, hub_admin, platform_admin",
      403,
    );
    const message = getErrorMessage(err, 'load quality reports');
    expect(message).not.toContain("Role '");
    expect(message).not.toContain('Required:');
  });

  it('never surfaces a raw 500 message', () => {
    const err = new ApiError('INTERNAL_ERROR', 'relation "foo" does not exist', 500);
    expect(getErrorMessage(err)).not.toContain('relation');
  });
});

describe('getErrorMessage: code takes priority over status', () => {
  it('NO_ORGANISATION is recognised even though it rides a 400', () => {
    const err = new ApiError('NO_ORGANISATION', 'User is not associated with an organisation', 400);
    expect(getErrorMessage(err)).toBe(
      "This account isn't linked to an organisation, so there's nothing here yet.",
    );
  });

  it('a plain 400 without that code falls through to the generic branch', () => {
    const err = new ApiError('VALIDATION_ERROR', 'productName is required', 400);
    expect(getErrorMessage(err, 'save this material')).toBe("Couldn't save this material.");
  });
});

describe('getErrorMessage: status branches', () => {
  it.each([
    [429, 'Too many requests hit the API. Please wait a moment, then retry.'],
    [401, 'Your session has expired. Please sign in again.'],
    [403, "You don't have access to this."],
    [0, "Couldn't reach the TRACE API. Check your connection and try again."],
  ])('status %d', (status, expected) => {
    expect(getErrorMessage(new ApiError('X', 'irrelevant', status))).toBe(expected);
  });

  it('404 uses the context if given, else a generic not-found', () => {
    expect(getErrorMessage(new ApiError('NOT_FOUND', 'x', 404), 'this listing')).toBe(
      "Couldn't find this listing.",
    );
    expect(getErrorMessage(new ApiError('NOT_FOUND', 'x', 404))).toBe("That couldn't be found.");
  });
});

describe('getErrorMessage: non-ApiError errors', () => {
  it('surfaces a plain Error message (these originate in our own code, not the server)', () => {
    expect(getErrorMessage(new Error('Camera access denied'))).toBe('Camera access denied');
  });

  it('falls back to context or a generic message for a non-Error throw', () => {
    expect(getErrorMessage('boom', 'submit feedback')).toBe("Couldn't submit feedback.");
    expect(getErrorMessage('boom')).toBe('Something went wrong.');
  });
});
