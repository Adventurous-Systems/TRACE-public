import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkInvariants,
  type ListingRow,
  type OrderRow,
  type PassportRow,
  type Violation,
} from './invariants.js';

const passport = (over: Partial<PassportRow> = {}): PassportRow => ({
  id: 'p1',
  productName: 'Bricks',
  status: 'listed',
  storedHash: '0xaa',
  computedHash: '0xaa',
  ...over,
});
const listing = (over: Partial<ListingRow> = {}): ListingRow => ({
  id: 'l1',
  passportId: 'p1',
  status: 'active',
  quantity: 10,
  quantityAvailable: 10,
  minOrderQuantity: 1,
  ...over,
});
const order = (over: Partial<OrderRow> = {}): OrderRow => ({
  id: 'o1',
  listingId: 'l1',
  status: 'pending',
  quantity: 2,
  amountPence: 600,
  disputeDeadline: null,
  legacyWholeLot: false,
  ...over,
});
const rules = (violations: Violation[], severity: Violation['severity'] = 'error') =>
  violations.filter((v) => v.severity === severity).map((v) => v.rule);
const check = (listings: ListingRow[], orders: OrderRow[] = [], passports = [passport()]) =>
  checkInvariants({ listings, orders, passports });

test('a lot with open and completed orders that add up is clean', () => {
  const violations = check(
    [listing({ quantityAvailable: 5 })],
    [
      order({ id: 'o1', quantity: 2 }),
      order({ id: 'o2', quantity: 3, status: 'completed', disputeDeadline: new Date() }),
      order({ id: 'o3', quantity: 4, status: 'cancelled' }),
    ],
  );
  assert.deepEqual(violations, []);
});

test('stock that does not match the orders taking it is an error', () => {
  assert.deepEqual(rules(check([listing({ quantityAvailable: 9 })], [order({ quantity: 2 })])), [
    'stock-sum',
  ]);
  assert.ok(rules(check([listing({ quantityAvailable: 11 })])).includes('stock-range'));
});

test('a listing status must agree with its stock and open orders', () => {
  assert.ok(
    rules(check([listing({ quantityAvailable: 0 })], [order({ quantity: 10 })])).includes(
      'status-stock',
    ),
  );
  // Reserved needs an open order: all sold is "sold", not "reserved".
  assert.ok(
    rules(
      check(
        [listing({ status: 'reserved', quantityAvailable: 0 })],
        [order({ quantity: 10, status: 'completed', disputeDeadline: new Date() })],
        [passport({ status: 'reserved' })],
      ),
    ).includes('status-stock'),
  );
  assert.ok(
    rules(
      check(
        [listing({ status: 'sold', quantityAvailable: 0 })],
        [order({ quantity: 10 })],
        [passport({ status: 'sold' })],
      ),
    ).includes('status-stock'),
  );
});

test('a cancelled or expired listing must not strand open orders', () => {
  assert.ok(
    rules(
      check(
        [listing({ status: 'cancelled', quantityAvailable: 8 })],
        [order()],
        [passport({ status: 'active' })],
      ),
    ).includes('stranded-order'),
  );
});

test('a passport status must follow its live listing, and have only one', () => {
  assert.deepEqual(rules(check([listing()], [], [passport({ status: 'reserved' })])), [
    'passport-status',
  ]);
  assert.ok(rules(check([listing(), listing({ id: 'l2' })])).includes('one-live-listing'));
  // A sold material may move on to installed.
  assert.deepEqual(
    check(
      [listing({ status: 'sold', quantityAvailable: 0 })],
      [order({ quantity: 10, status: 'completed', disputeDeadline: new Date() })],
      [passport({ status: 'installed' })],
    ),
    [],
  );
});

test('an accepted order has a dispute deadline; a minimum order fits the lot', () => {
  assert.ok(
    rules(check([listing({ quantityAvailable: 8 })], [order({ status: 'confirmed' })])).includes(
      'dispute-window',
    ),
  );
  assert.ok(rules(check([listing({ minOrderQuantity: 11 })])).includes('minimum-order'));
});

test('an order marked as placed before part-of-a-lot ordering is accepted as it is', () => {
  const old = order({
    quantity: 10,
    amountPence: 365,
    disputeDeadline: new Date(),
    legacyWholeLot: true,
  });
  assert.deepEqual(
    check(
      [listing({ status: 'reserved', quantityAvailable: 0 })],
      [old],
      [passport({ status: 'reserved' })],
    ),
    [],
  );
  // The same row without the mark does not fit the current model.
  assert.deepEqual(
    rules(
      check(
        [listing({ status: 'reserved', quantityAvailable: 0 })],
        [{ ...old, legacyWholeLot: false }],
        [passport({ status: 'reserved' })],
      ),
    ),
    ['dispute-window', 'order-amount'],
  );
});

test('a stored fingerprint that no longer matches the data is an error; pending is not', () => {
  assert.deepEqual(rules(check([listing()], [], [passport({ computedHash: '0xbb' })])), [
    'stale-fingerprint',
  ]);
  assert.deepEqual(check([listing()], [], [passport({ storedHash: null })]), []);
});

test('an order or a listing the sweep should have closed is a warning, not an error', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
  const run = (listings: ListingRow[], orders: OrderRow[] = []) =>
    checkInvariants({ listings, orders, passports: [passport()] }, now);

  // An unanswered order past its own deadline, and one the previous release
  // placed (no deadline) more than 72 hours ago.
  for (const overdue of [
    order({ responseDeadline: hoursAgo(1), createdAt: hoursAgo(73) }),
    order({ responseDeadline: null, createdAt: hoursAgo(73) }),
  ]) {
    const violations = run([listing({ quantityAvailable: 8 })], [overdue]);
    assert.deepEqual(rules(violations), []);
    assert.deepEqual(rules(violations, 'warning'), ['overdue-order']);
  }
  // Within its limit, or only minutes past it (the sweep is on its way): clean.
  assert.deepEqual(
    run(
      [listing({ quantityAvailable: 6 })],
      [
        order({
          id: 'o1',
          responseDeadline: new Date(now.getTime() + 1000),
          createdAt: hoursAgo(71),
        }),
        order({
          id: 'o2',
          responseDeadline: new Date(now.getTime() - 60 * 1000),
          createdAt: hoursAgo(72),
        }),
      ],
    ),
    [],
  );

  // An accepted order past its problem window.
  assert.deepEqual(
    rules(
      run(
        [listing({ quantityAvailable: 8 })],
        [order({ status: 'confirmed', disputeDeadline: hoursAgo(1) })],
      ),
      'warning',
    ),
    ['overdue-order'],
  );

  // A listing past its date with nothing open; with an open order it waits.
  assert.deepEqual(rules(run([listing({ expiresAt: hoursAgo(1) })]), 'warning'), [
    'overdue-listing',
  ]);
  assert.deepEqual(
    run(
      [listing({ expiresAt: hoursAgo(1), quantityAvailable: 8 })],
      [order({ responseDeadline: new Date(now.getTime() + 1000) })],
    ),
    [],
  );
});
