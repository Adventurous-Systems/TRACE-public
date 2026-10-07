import assert from 'node:assert/strict';
import test from 'node:test';
import { UNITS_OF_MEASURE } from '@trace/core';
import { CATALOG, SEED_TAG, lotShippingNote } from './catalogue.js';
import {
  catalogueCorrections,
  isCatalogueLot,
  lotCorrections,
  SUPERSEDED_CONDITION_NOTES,
  SUPERSEDED_LOT_NOTES,
} from './catalogue-corrections.js';

const studWalling = CATALOG.find((p) => p.key === 'reclaimed-aluminium-stud-walling')!;
const bricks = CATALOG.find((p) => p.key === 'reclaimed-facing-bricks')!;

function lot(overrides: Record<string, unknown> = {}) {
  return {
    productName: `${studWalling.passport.productName} — Demo Lot 001`,
    customAttributes: { seedSource: SEED_TAG, catalogueKey: studWalling.key, demoLotNumber: 1 },
    categoryL1: 'structural-steel',
    categoryL2: 'channels',
    reclaimedBy: 'Reconditioning partners',
    unitOfMeasure: 'each',
    ...overrides,
  };
}

test('the catalogue files aluminium stud walling as partition framing, not structural steel', () => {
  assert.equal(studWalling.passport.categoryL1, 'partitions-linings');
  assert.equal(studWalling.passport.categoryL2, 'metal-stud-framing');
});

test('the reclaiming hub is "Stirling Reuse Hub" throughout the catalogue', () => {
  for (const product of CATALOG) {
    assert.notEqual(product.passport.reclaimedBy, 'Stirling Community Reuse Hub', product.key);
  }
  assert.equal(bricks.passport.reclaimedBy, 'Stirling Reuse Hub');
});

test('every catalogue product says what it is sold per', () => {
  for (const product of CATALOG) {
    const unit = product.passport.unitOfMeasure;
    assert.ok(unit && (UNITS_OF_MEASURE as readonly string[]).includes(unit), product.key);
  }
});

test('a lot seeded before units existed gets its unit, and nothing else changes', () => {
  const current = lot({
    categoryL1: 'partitions-linings',
    categoryL2: 'metal-stud-framing',
    unitOfMeasure: null,
  });
  assert.deepEqual(catalogueCorrections(current, studWalling), { unitOfMeasure: 'each' });
});

test('a lot filed under the old category gets exactly the category corrected', () => {
  assert.deepEqual(catalogueCorrections(lot(), studWalling), {
    categoryL1: 'partitions-linings',
    categoryL2: 'metal-stud-framing',
  });
});

test('a lot already matching the catalogue needs no correction', () => {
  const current = lot({ categoryL1: 'partitions-linings', categoryL2: 'metal-stud-framing' });
  assert.deepEqual(catalogueCorrections(current, studWalling), {});
});

test('lots are matched by catalogueKey, and legacy curated rows by exact name', () => {
  assert.equal(isCatalogueLot(lot(), studWalling), true);
  assert.equal(isCatalogueLot(lot(), bricks), false);
  const legacy = lot({
    productName: studWalling.passport.productName,
    customAttributes: { seedSource: SEED_TAG },
  });
  assert.equal(isCatalogueLot(legacy, studWalling), true);
  // A visitor's own passport with the same name is never a catalogue lot.
  assert.equal(isCatalogueLot({ ...legacy, customAttributes: {} }, studWalling), false);
});

function brickLot(conditionNotes: string | null) {
  return {
    productName: `${bricks.passport.productName} — Demo Lot 001`,
    customAttributes: { seedSource: SEED_TAG, catalogueKey: bricks.key, demoLotNumber: 1 },
    categoryL1: bricks.passport.categoryL1,
    categoryL2: bricks.passport.categoryL2 ?? null,
    reclaimedBy: bricks.passport.reclaimedBy ?? null,
    unitOfMeasure: bricks.passport.unitOfMeasure ?? null,
    conditionNotes,
  };
}

test('a condition note still as an earlier catalogue wrote it gets the current text', () => {
  const old = 'Reclaimed perforated facing bricks, cleaned and palletised. B grade.';
  assert.deepEqual(catalogueCorrections(brickLot(old), bricks), {
    conditionNotes: bricks.passport.conditionNotes,
  });
});

test('a condition note someone edited is never corrected', () => {
  assert.deepEqual(catalogueCorrections(brickLot('Two pallets chipped. B grade.'), bricks), {});
  assert.deepEqual(catalogueCorrections(brickLot(null), bricks), {});
  assert.deepEqual(catalogueCorrections(brickLot(bricks.passport.conditionNotes!), bricks), {});
});

test('no current catalogue note states a grade, and none is listed as superseded', () => {
  for (const product of CATALOG) {
    assert.doesNotMatch(product.passport.conditionNotes ?? '', /\b[A-D] grade\b/, product.key);
    const superseded = SUPERSEDED_CONDITION_NOTES[product.key] ?? [];
    assert.ok(!superseded.includes(product.passport.conditionNotes ?? ''), product.key);
  }
});

const kbriq = CATALOG.find((p) => p.key === 'kbriq-medero-dark-grey')!;
const sisalwool = CATALOG.find((p) => p.key === 'sisalwool-100')!;

function liveLot(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active',
    quantity: 5000,
    minOrderQuantity: 1,
    shippingOptions: [
      { method: 'both', notes: 'From £3.60 each — order quantity by arrangement.' },
    ],
    ...overrides,
  };
}

test('an older K-BRIQ lot gets the catalogue minimum and loses "by arrangement"', () => {
  assert.equal(kbriq.listing.minOrderQuantity, 100);
  assert.deepEqual(lotCorrections(liveLot(), kbriq), {
    minOrderQuantity: 100,
    shippingOptions: [{ method: 'both', notes: lotShippingNote(kbriq) }],
  });
});

test('every superseded lot note belongs to a catalogue product and says "by arrangement"', () => {
  for (const [key, notes] of Object.entries(SUPERSEDED_LOT_NOTES)) {
    assert.ok(
      CATALOG.some((p) => p.key === key),
      key,
    );
    for (const note of notes) assert.match(note, /by arrangement/);
  }
  assert.deepEqual(
    lotCorrections(
      liveLot({
        quantity: 250,
        shippingOptions: [
          { method: 'both', notes: 'From £82 per pack — order quantity by arrangement.' },
        ],
      }),
      sisalwool,
    ),
    { shippingOptions: [{ method: 'both', notes: lotShippingNote(sisalwool) }] },
  );
});

test('a minimum or note someone changed since stays as it is', () => {
  assert.deepEqual(
    lotCorrections(
      liveLot({
        minOrderQuantity: 50,
        shippingOptions: [{ method: 'collection', notes: 'Forklift on site' }],
      }),
      kbriq,
    ),
    {},
  );
});

test('closed lots are history and are never corrected', () => {
  for (const status of ['sold', 'cancelled', 'expired']) {
    assert.deepEqual(lotCorrections(liveLot({ status }), kbriq), {}, status);
  }
});

test('a minimum is never set above the lot size', () => {
  assert.deepEqual(lotCorrections(liveLot({ quantity: 60, shippingOptions: [] }), kbriq), {});
});
