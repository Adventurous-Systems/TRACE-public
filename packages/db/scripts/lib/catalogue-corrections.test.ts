import assert from 'node:assert/strict';
import test from 'node:test';
import { UNITS_OF_MEASURE } from '@trace/core';
import { CATALOG, SEED_TAG, lotShippingNote } from './catalogue.js';
import type { MaterialPassport } from '../../drizzle/schema.js';
import {
  catalogueCorrections,
  fingerprintChanges,
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
    origin: 'surplus',
    deconstructionMethod: null,
    deconstructionDate: null,
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
    origin: 'reclaimed',
    deconstructionMethod: 'selective',
    deconstructionDate: new Date('2026-06-01T00:00:00.000Z'),
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

// ── Origin, the surplus aluminium lot, and fingerprints (owner, 2026-10-13) ──

test('every catalogue product says where it comes from', () => {
  const origins = Object.fromEntries(CATALOG.map((p) => [p.key, p.passport.origin]));
  assert.deepEqual(origins, {
    'kbriq-medero-dark-grey': 'new',
    'sisalwool-100': 'new',
    'reclaimed-aerated-concrete-blocks': 'reclaimed',
    'reclaimed-concrete-lintels': 'reclaimed',
    'reclaimed-facing-bricks': 'reclaimed',
    'reclaimed-prefabricated-staircase': 'reclaimed',
    'reclaimed-aluminium-stud-walling': 'surplus',
  });
});

test('surplus stock was never deconstructed, and is not named "Reclaimed"', () => {
  assert.equal(studWalling.passport.productName, 'Surplus Aluminium Stud Walling');
  assert.equal(studWalling.passport.deconstructionMethod, null);
  assert.equal(studWalling.passport.deconstructionDate, null);
});

test('an aluminium lot seeded as reclaimed is renamed, keeps its lot number, and loses its deconstruction', () => {
  const old = lot({
    productName: 'Reclaimed Aluminium Stud Walling — Demo Lot 003',
    categoryL1: 'partitions-linings',
    categoryL2: 'metal-stud-framing',
    origin: null,
    deconstructionMethod: 'selective',
    deconstructionDate: new Date('2026-06-01T00:00:00.000Z'),
  });
  assert.deepEqual(catalogueCorrections(old, studWalling), {
    productName: 'Surplus Aluminium Stud Walling — Demo Lot 003',
    origin: 'surplus',
    deconstructionMethod: null,
    deconstructionDate: null,
  });
});

test('the original aluminium passport, seeded under the old name, is still the product, and renamed', () => {
  const original = lot({
    productName: 'Reclaimed Aluminium Stud Walling',
    customAttributes: { seedSource: SEED_TAG },
    categoryL1: 'partitions-linings',
    categoryL2: 'metal-stud-framing',
  });
  assert.equal(isCatalogueLot(original, studWalling), true);
  assert.deepEqual(catalogueCorrections(original, studWalling), {
    productName: 'Surplus Aluminium Stud Walling',
    // So a release from before the rename still finds it by key.
    customAttributes: { seedSource: SEED_TAG, catalogueKey: studWalling.key },
  });
  // A visitor's passport of that name is not the catalogue's.
  assert.equal(isCatalogueLot({ ...original, customAttributes: {} }, studWalling), false);
});

test('a name nobody superseded is never changed', () => {
  const current = lot({
    productName: 'Surplus Aluminium Stud Walling — Demo Lot 004',
    categoryL1: 'partitions-linings',
    categoryL2: 'metal-stud-framing',
  });
  assert.deepEqual(catalogueCorrections(current, studWalling), {});
});

test('a reclaimed lot gets its origin, and its deconstruction date is never touched', () => {
  const before = { ...brickLot(bricks.passport.conditionNotes!), origin: null };
  assert.deepEqual(catalogueCorrections(before, bricks), { origin: 'reclaimed' });
  const later = { ...before, deconstructionDate: new Date('2025-01-01T00:00:00.000Z') };
  assert.deepEqual(catalogueCorrections(later, bricks), { origin: 'reclaimed' });
});

function row(overrides: Partial<MaterialPassport> = {}): MaterialPassport {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    organisationId: '00000000-0000-4000-8000-000000000020',
    productName: 'Reclaimed Aluminium Stud Walling — Demo Lot 003',
    categoryL1: 'partitions-linings',
    categoryL2: 'metal-stud-framing',
    gtin: null,
    serialNumber: 'TRACE-DEMO-RECLAIMED-ALUMINIUM-STUD-WALLING-003',
    materialComposition: [{ material: 'Aluminium', percentage: 100, recycled: true }],
    dimensions: null,
    technicalSpecs: {},
    manufacturerName: null,
    countryOfOrigin: 'GB',
    productionDate: null,
    gwpTotal: null,
    embodiedCarbon: null,
    recycledContent: null,
    epdReference: null,
    ceMarking: false,
    conditionGrade: 'B',
    conditionNotes: null,
    deconstructionDate: new Date('2026-06-01T00:00:00.000Z'),
    deconstructionMethod: 'selective',
    reclaimedBy: 'Reconditioning partners',
    remainingLifeEstimate: 30,
    carbonSavingsVsNew: '12',
    hazardousSubstances: [],
    origin: null,
    unitOfMeasure: 'each',
    createdAt: new Date('2026-09-15T00:00:00.000Z'),
    ...overrides,
  } as MaterialPassport;
}

test('an origin-only correction leaves the fingerprint, so the anchor stays valid', () => {
  assert.equal(fingerprintChanges(row(), { origin: 'reclaimed' }), false);
  assert.equal(
    fingerprintChanges(row(), { customAttributes: { seedSource: SEED_TAG, catalogueKey: 'x' } }),
    false,
  );
  assert.equal(fingerprintChanges(row(), { unitOfMeasure: 'm' }), false);
});

test('renaming or clearing the deconstruction changes the fingerprint, so it is re-anchored', () => {
  assert.equal(
    fingerprintChanges(row(), { productName: 'Surplus Aluminium Stud Walling — Demo Lot 003' }),
    true,
  );
  assert.equal(
    fingerprintChanges(row(), { deconstructionMethod: null, deconstructionDate: null }),
    true,
  );
});
