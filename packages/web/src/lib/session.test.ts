import { describe, expect, it } from 'vitest';
import { sameUser } from './session';

const buyer = { id: 'u1', email: 'b@example.com', role: 'buyer', organisationId: null };

describe('sameUser', () => {
  it('is true for an identical answer, so the page keeps its user object', () => {
    expect(sameUser(buyer, { ...buyer })).toBe(true);
    expect(sameUser(null, null)).toBe(true);
  });

  it('is false once the role or organisation changes, so the page follows', () => {
    expect(sameUser(buyer, { ...buyer, role: 'hub_staff' })).toBe(false);
    expect(sameUser(buyer, { ...buyer, organisationId: 'o1' })).toBe(false);
    expect(sameUser(buyer, null)).toBe(false);
  });
});
