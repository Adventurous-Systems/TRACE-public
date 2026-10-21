import assert from 'node:assert/strict';
import test from 'node:test';
import { CATALOG, SEED_TAG } from './catalogue.js';
import { planSpareRetirement, type CuratedPassportRow } from './demo-spares-policy.js';

function row(
  key: string,
  lot: number | undefined,
  listingStatuses: string[],
  extra: Partial<CuratedPassportRow> = {},
): CuratedPassportRow {
  return {
    passportId: `passport-${key}-${lot ?? 'original'}`,
    productName: `${key} — Demo Lot ${lot ?? 1}`,
    customAttributes: {
      seedSource: SEED_TAG,
      catalogueKey: key,
      ...(lot === undefined ? {} : { demoLotNumber: lot }),
    },
    listingStatuses,
    transactions: 0,
    events: 0,
    qualityReports: 0,
    sensorReadings: 0,
    ...extra,
  };
}

test('live as at launch: one live lot and two cancelled spares per product → 14 retired', () => {
  // Lot 3 is the live one for some products, as on the demo.
  const rows = CATALOG.flatMap((product, i) => {
    const live = (i % 3) + 1;
    return [1, 2, 3].map((lot) => row(product.key, lot, [lot === live ? 'active' : 'cancelled']));
  });
  const plan = planSpareRetirement(rows);
  assert.equal(
    plan.reduce((sum, p) => sum + p.retire.length, 0),
    14,
  );
  assert.equal(
    plan.reduce((sum, p) => sum + p.protected.length, 0),
    0,
  );
  plan.forEach((p, i) => {
    assert.equal(p.keep?.passportId, `passport-${p.catalogueKey}-${(i % 3) + 1}`);
  });

  // A second run finds nothing left to do.
  const retired = new Set(plan.flatMap((p) => p.retire.map((r) => r.passportId)));
  const rerun = planSpareRetirement(rows.filter((r) => !retired.has(r.passportId)));
  assert.equal(
    rerun.reduce((sum, p) => sum + p.retire.length + p.protected.length, 0),
    0,
  );
});

test('a spare with anything depending on it is reported, never deleted', () => {
  const key = CATALOG[0]!.key;
  const plan = planSpareRetirement([
    row(key, 1, ['active']),
    row(key, 2, ['cancelled'], { transactions: 1 }),
    row(key, 3, ['cancelled'], { events: 2 }),
    row(key, 4, ['cancelled'], { qualityReports: 1 }),
    row(key, 5, ['cancelled'], { sensorReadings: 3 }),
    row(key, 6, ['sold']),
    row(key, 7, ['expired', 'cancelled']),
    row(key, 8, []),
  ])[0]!;
  assert.equal(plan.keep?.passportId, `passport-${key}-1`);
  assert.deepEqual(
    plan.retire.map((r) => r.passportId),
    [`passport-${key}-7`, `passport-${key}-8`],
  );
  assert.deepEqual(
    plan.protected.map((p) => p.reasons.join('; ')),
    [
      '1 order(s)',
      '2 history event(s)',
      '1 quality report(s)',
      '3 sensor reading(s)',
      'a listing that is sold',
    ],
  );
});

test('a second live lot is kept and reported, not deleted', () => {
  const key = CATALOG[1]!.key;
  const plan = planSpareRetirement([row(key, 2, ['active']), row(key, 3, ['reserved'])])[1]!;
  assert.equal(plan.keep?.passportId, `passport-${key}-2`);
  assert.deepEqual(plan.retire, []);
  assert.deepEqual(plan.protected[0]?.reasons, ['a listing that is reserved']);
});

test('with no live lot, the lowest-numbered passport (the original) is kept', () => {
  const key = CATALOG[2]!.key;
  const plan = planSpareRetirement([
    row(key, 3, ['cancelled']),
    row(key, undefined, ['cancelled']),
    row(key, 2, ['cancelled']),
  ])[2]!;
  assert.equal(plan.keep?.passportId, `passport-${key}-original`);
  assert.deepEqual(
    plan.retire.map((r) => r.passportId),
    [`passport-${key}-2`, `passport-${key}-3`],
  );
});

test('with no live lot, a lot that sold is kept: the top-up reopens it in place', () => {
  const key = CATALOG[3]!.key;
  const plan = planSpareRetirement([
    row(key, 1, ['cancelled']),
    row(key, 2, ['sold'], { transactions: 1, events: 1 }),
    row(key, 3, ['cancelled']),
  ])[3]!;
  assert.equal(plan.keep?.passportId, `passport-${key}-2`);
  assert.deepEqual(
    plan.retire.map((r) => r.passportId),
    [`passport-${key}-1`, `passport-${key}-3`],
  );
});

test('rows that are not curated catalogue passports are ignored', () => {
  const plan = planSpareRetirement([
    { ...row('not-in-the-catalogue', 1, ['cancelled']) },
    {
      ...row(CATALOG[0]!.key, 2, ['cancelled']),
      customAttributes: { catalogueKey: CATALOG[0]!.key },
    },
  ]);
  assert.equal(
    plan.reduce((sum, p) => sum + p.retire.length + p.protected.length, 0),
    0,
  );
  assert.ok(plan.every((p) => p.keep === undefined));
});
