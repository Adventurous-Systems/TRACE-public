import { describe, expect, it } from 'vitest';
import { listingStatus, orderGuidance, stepText, type OrderStep } from './orders';

const step = (over: Partial<OrderStep>): OrderStep => ({
  action: 'placed',
  toStatus: 'pending',
  actorSide: 'buyer',
  note: null,
  createdAt: '2026-10-02T10:00:00Z',
  ...over,
});

describe('orderGuidance', () => {
  it('tells each side of a new order who must act, and by when', () => {
    const order = { status: 'pending', responseDeadline: '2026-10-05T10:00:00Z' };
    expect(orderGuidance({ ...order, viewerSide: 'buyer' })).toMatch(
      /^The seller has until 5 Oct 2026, .* to accept or reject it\. After that the order lapses\.$/,
    );
    expect(orderGuidance({ ...order, viewerSide: 'seller' })).toMatch(
      /^Answer by 5 Oct 2026, .*, or the order lapses and its quantity returns to the lot\.$/,
    );
  });

  it('tells each side of an accepted order what closes it', () => {
    const order = { status: 'confirmed', disputeDeadline: '2026-10-04T10:00:00Z' };
    expect(orderGuidance({ ...order, viewerSide: 'buyer' })).toMatch(
      /report a problem by 4 Oct 2026, .*\. After that the order completes by itself\.$/,
    );
    expect(orderGuidance({ ...order, viewerSide: 'seller' })).toMatch(
      /or the order completes by itself on 4 Oct 2026/,
    );
  });

  it('still makes sense for an order with no dates (placed by the previous release)', () => {
    expect(orderGuidance({ status: 'pending', viewerSide: 'buyer' })).toBe(
      'Waiting for the seller to accept or reject it.',
    );
    expect(orderGuidance({ status: 'pending', viewerSide: 'seller' })).toBeNull();
  });

  it('says how an order a time limit closed came to end', () => {
    expect(
      orderGuidance({
        status: 'cancelled',
        steps: [
          step({}),
          step({ action: 'lapse', toStatus: 'cancelled', actorSide: 'time_limit' }),
        ],
      }),
    ).toMatch(/did not answer within 72 hours/);
    expect(
      orderGuidance({
        status: 'completed',
        steps: [step({ action: 'auto_complete', toStatus: 'completed', actorSide: 'time_limit' })],
      }),
    ).toMatch(/within 48 hours/);
  });

  it('says which way a flagged order was resolved', () => {
    const resolved = (toStatus: string) =>
      orderGuidance({
        status: toStatus,
        steps: [step({ action: 'resolve_dispute', toStatus, actorSide: 'platform' })],
      });
    expect(resolved('resolved')).toMatch(/the sale stands/);
    expect(resolved('cancelled')).toMatch(/the order is cancelled/);
  });

  it('says who declined or cancelled an order (R2)', () => {
    const closed = (action: string, actorSide: string, viewerSide: 'buyer' | 'seller') =>
      orderGuidance({
        status: 'cancelled',
        viewerSide,
        steps: [step({}), step({ action, toStatus: 'cancelled', actorSide })],
      });
    expect(closed('reject', 'seller', 'buyer')).toBe('The seller declined this order.');
    expect(closed('reject', 'seller', 'seller')).toMatch(/^You declined this order/);
    expect(closed('cancel', 'buyer', 'buyer')).toBe('You cancelled this order.');
    expect(closed('cancel', 'buyer', 'seller')).toBe('The buyer cancelled this order.');
    expect(closed('cancel', 'seller', 'buyer')).toBe('The seller cancelled this order.');
  });

  it('adds nothing to an order that simply finished', () => {
    expect(
      orderGuidance({
        status: 'completed',
        steps: [step({ action: 'confirm_delivery', toStatus: 'completed' })],
      }),
    ).toBeNull();
  });
});

describe('stepText', () => {
  it('names who took each step', () => {
    expect(stepText(step({}))).toBe('Order placed by the buyer');
    expect(stepText(step({ action: 'accept', actorSide: 'seller' }))).toBe(
      'Accepted by the seller',
    );
    expect(stepText(step({ action: 'cancel', actorSide: 'seller' }))).toBe(
      'Cancelled by the seller',
    );
    expect(stepText(step({ action: 'flag_dispute' }))).toBe('Problem reported by the buyer');
    expect(
      stepText(step({ action: 'resolve_dispute', toStatus: 'cancelled', actorSide: 'platform' })),
    ).toBe('Resolved by the platform: the order is cancelled');
    expect(stepText(step({ action: 'lapse', actorSide: 'time_limit' }))).toMatch(/^Lapsed/);
  });
});

describe('listingStatus', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('reads a listing past its date as expired before the sweep marks it', () => {
    expect(listingStatus({ status: 'active', expiresAt: '2026-10-02T11:59:00Z' }, now)).toBe(
      'expired',
    );
    expect(listingStatus({ status: 'active', expiresAt: '2026-10-03T00:00:00Z' }, now)).toBe(
      'active',
    );
    expect(listingStatus({ status: 'active', expiresAt: null }, now)).toBe('active');
    expect(listingStatus({ status: 'sold', expiresAt: '2026-10-01T00:00:00Z' }, now)).toBe('sold');
  });
});
