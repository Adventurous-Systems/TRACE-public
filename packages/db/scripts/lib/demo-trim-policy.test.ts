import assert from 'node:assert/strict';
import test from 'node:test';
import { CATALOG, SEED_TAG } from './catalogue.js';
import { eligibleDemoLot, planDemoLotTrim, type TrimSourceRow } from './demo-trim-policy.js';

function row(key: string, lot: number, hasTransaction = false): TrimSourceRow {
  return {
    listingId: `${key}-${lot}`,
    passportId: `passport-${key}-${lot}`,
    customAttributes: { seedSource: SEED_TAG, catalogueKey: key, demoLotNumber: lot },
    hasTransaction,
  };
}

test('fixture dry-run plans fourteen cancellations across seven products', () => {
  const lots = CATALOG.flatMap((product) =>
    [1, 2, 3].map((lot) => eligibleDemoLot(row(product.key, lot))!),
  );
  const plan = planDemoLotTrim(lots, 1);
  assert.equal(
    plan.reduce((sum, product) => sum + product.active, 0),
    21,
  );
  assert.equal(
    plan.reduce((sum, product) => sum + product.cancelIds.length, 0),
    14,
  );
  assert.deepEqual(
    plan.flatMap((product) => product.keepIds),
    CATALOG.map((product) => `${product.key}-1`),
  );

  const cancelled = new Set(plan.flatMap((product) => product.cancelIds));
  const rerun = planDemoLotTrim(
    lots.filter((lot) => !cancelled.has(lot.listingId)),
    1,
  );
  assert.equal(
    rerun.reduce((sum, product) => sum + product.cancelIds.length, 0),
    0,
  );
});

test('never selects an excess transaction-linked lot for cancellation', () => {
  const key = CATALOG[0]!.key;
  const lots = [
    eligibleDemoLot(row(key, 1))!,
    eligibleDemoLot(row(key, 2, true))!,
    eligibleDemoLot(row(key, 3))!,
  ];
  const product = planDemoLotTrim(lots, 1).find((entry) => entry.catalogueKey === key)!;
  assert.deepEqual(product.keepIds, [`${key}-1`]);
  assert.deepEqual(product.protectedIds, [`${key}-2`]);
  assert.deepEqual(product.cancelIds, [`${key}-3`]);
});

test('rejects unmarked, unknown, and invalidly numbered rows', () => {
  const key = CATALOG[0]!.key;
  assert.equal(
    eligibleDemoLot({
      ...row(key, 1),
      customAttributes: { catalogueKey: key, demoLotNumber: 1 },
    }),
    undefined,
  );
  assert.equal(eligibleDemoLot(row('not-in-catalogue', 1)), undefined);
  assert.equal(
    eligibleDemoLot({
      ...row(key, 1),
      customAttributes: { seedSource: SEED_TAG, catalogueKey: key, demoLotNumber: 0 },
    }),
    undefined,
  );
});
