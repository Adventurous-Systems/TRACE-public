import assert from 'node:assert/strict';
import test from 'node:test';
import { CATALOG, SEED_TAG } from './catalogue.js';
import { catalogueCorrections, isCatalogueLot } from './catalogue-corrections.js';

const studWalling = CATALOG.find((p) => p.key === 'reclaimed-aluminium-stud-walling')!;
const bricks = CATALOG.find((p) => p.key === 'reclaimed-facing-bricks')!;

function lot(overrides: Record<string, unknown> = {}) {
  return {
    productName: `${studWalling.passport.productName} — Demo Lot 001`,
    customAttributes: { seedSource: SEED_TAG, catalogueKey: studWalling.key, demoLotNumber: 1 },
    categoryL1: 'structural-steel',
    categoryL2: 'channels',
    reclaimedBy: 'Reconditioning partners',
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
