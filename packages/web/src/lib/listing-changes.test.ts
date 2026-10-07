import { describe, expect, it } from 'vitest';
import { listingChangeSummary } from './listing-changes';

describe('listingChangeSummary', () => {
  it('names each changed field, before and after, in the seller’s terms', () => {
    expect(
      listingChangeSummary({
        passportId: 'p',
        changes: {
          pricePence: { from: 1250, to: 1100 },
          quantity: { from: 10, to: 14 },
          expiresAt: { from: '2026-11-01T23:59:59.999Z', to: null },
        },
      }),
    ).toBe('Price £12.50 → £11.00 · Quantity 10 → 14 · Expiry 1 Nov 2026 → no end date');
  });

  it('shows the shipping method and its notes', () => {
    expect(
      listingChangeSummary({
        changes: {
          shippingOptions: {
            from: [{ method: 'both', notes: 'order quantity by arrangement' }],
            to: [{ method: 'collection' }],
          },
        },
      }),
    ).toMatch(/^Shipping .+ \(order quantity by arrangement\) → [^(]+$/);
  });

  it('is null for an older event that recorded no changes', () => {
    expect(listingChangeSummary({ passportId: 'p' })).toBeNull();
    expect(listingChangeSummary(undefined)).toBeNull();
    expect(listingChangeSummary({ changes: {} })).toBeNull();
  });
});
