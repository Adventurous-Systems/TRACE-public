import assert from 'node:assert/strict';
import test from 'node:test';
import { CATALOG, SEED_TAG, SUPERSEDED_PRODUCT_NAMES } from './catalogue.js';
import { catalogueKeyOf, demoLotNumberOf, productLot } from './catalogue-lots.js';

const bricks = CATALOG.find((product) => product.key === 'reclaimed-facing-bricks')!;
const lot = (id: string, number?: number) => ({
  id,
  productName: `${bricks.passport.productName} — Demo Lot ${number ?? 1}`,
  customAttributes: {
    seedSource: SEED_TAG,
    catalogueKey: bricks.key,
    ...(number === undefined ? {} : { demoLotNumber: number }),
  },
});

test('a passport belongs to a product by its key, or as an original by its name', () => {
  assert.equal(catalogueKeyOf(lot('a', 2)), bricks.key);
  const original = {
    productName: bricks.passport.productName,
    customAttributes: { seedSource: SEED_TAG },
  };
  assert.equal(catalogueKeyOf(original), bricks.key);
  const [key, [oldName]] = Object.entries(SUPERSEDED_PRODUCT_NAMES)[0]! as [string, string[]];
  assert.equal(
    catalogueKeyOf({ productName: oldName!, customAttributes: { seedSource: SEED_TAG } }),
    key,
  );
});

test('untagged passports, and keys not in the catalogue, belong to no product', () => {
  assert.equal(
    catalogueKeyOf({ productName: bricks.passport.productName, customAttributes: {} }),
    undefined,
  );
  assert.equal(
    catalogueKeyOf({
      productName: bricks.passport.productName,
      customAttributes: { seedSource: SEED_TAG, catalogueKey: 'no-such-product' },
    }),
    undefined,
  );
});

test('an unnumbered original is lot 1', () => {
  assert.equal(demoLotNumberOf(lot('a')), 1);
  assert.equal(demoLotNumberOf(lot('b', 3)), 3);
  assert.equal(demoLotNumberOf({ customAttributes: { demoLotNumber: 0 } }), 1);
});

test("a product's lot: live first, then sold, then the lowest-numbered", () => {
  const statuses: Record<string, string[]> = {};
  const of = (id: string) => statuses[id] ?? [];
  const lots = [lot('l3', 3), lot('l1', 1), lot('l2', 2)];

  statuses.l1 = ['cancelled'];
  statuses.l2 = ['sold'];
  statuses.l3 = ['cancelled', 'active'];
  assert.equal(productLot(lots, of)?.id, 'l3');

  statuses.l3 = ['cancelled'];
  assert.equal(productLot(lots, of)?.id, 'l2');

  statuses.l2 = ['expired'];
  assert.equal(productLot(lots, of)?.id, 'l1');

  statuses.l1 = ['reserved'];
  statuses.l2 = ['active'];
  assert.equal(productLot(lots, of)?.id, 'l1', 'the lowest-numbered of several live lots');

  assert.equal(productLot([], of), undefined);
});
