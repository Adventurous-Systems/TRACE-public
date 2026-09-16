import { describe, it, expect } from 'vitest';
import { keccak256 as ethersKeccak256 } from 'ethers';
import type { MaterialPassport } from '@trace/db';
import { SEED_TAG } from '@trace/core/constants/demo-catalogue';
import { buildCanonicalJsonLd, computePassportHash } from './passport-hash.js';

/**
 * These tests protect the demo's headline moment.
 *
 * A passport's fingerprint is written in two places (the API's anchor paths and
 * the seed/restore scripts) and recomputed in a third (the public
 * /verify-integrity endpoint). If any of those disagree, a curated passport
 * reports "Mismatch" live in front of a prospect, with no other symptom. In
 * June all seven curated passports were in exactly that state.
 *
 * The fixture deliberately mirrors a real curated product: non-ASCII characters
 * (® and an em dash, as in "K-BRIQ® — Medero Dark Grey"), nulls, JSONB
 * arrays/objects, numeric-as-string columns and dates.
 */
const FIXTURE: MaterialPassport = {
  id: '00000000-0000-4000-8000-000000000001',
  organisationId: '00000000-0000-4000-8000-000000000002',
  gtin: null,
  serialNumber: null,
  digitalLinkUri: null,
  qrCodeUrl: null,
  productName: 'K-BRIQ® — Medero Dark Grey',
  categoryL1: 'masonry',
  categoryL2: 'bricks',
  unitOfMeasure: 'unit',
  materialComposition: [
    { material: 'Recycled construction waste', percentage: 90, recycled: true },
  ],
  dimensions: { length: 215, width: 102.5, height: 65, unit: 'mm', weight: 2.4, weightUnit: 'kg' },
  technicalSpecs: { compressiveStrength: '20 N/mm²' },
  manufacturerName: 'Kenoteq',
  countryOfOrigin: 'GB',
  productionDate: new Date('2026-05-01T00:00:00.000Z'),
  // numeric columns come back from Drizzle as strings, not numbers — this
  // distinction changes the serialised document and therefore the hash.
  gwpTotal: '0.0725',
  embodiedCarbon: '0.0725',
  recycledContent: '90',
  epdReference: null,
  ceMarking: false,
  declarationOfPerformance: null,
  harmonisedStandard: null,
  previousBuildingId: null,
  deconstructionDate: null,
  deconstructionMethod: null,
  reclaimedBy: null,
  conditionGrade: 'A',
  conditionNotes: 'Factory new — circular product',
  conditionPhotos: [],
  originalAge: null,
  remainingLifeEstimate: 100,
  carbonSavingsVsNew: '0.4975',
  circularityScore: null,
  reuseCount: 0,
  reuseSuitability: [],
  handlingRequirements: null,
  hazardousSubstances: [],
  customAttributes: { seedSource: SEED_TAG },
  status: 'listed',
  blockchainTxHash: null,
  blockchainPassportHash: null,
  blockchainAnchoredAt: null,
  registeredBy: null,
  createdAt: new Date('2026-06-04T09:49:27.000Z'),
  updatedAt: new Date('2026-09-01T09:00:00.000Z'),
};

/**
 * The exact field set of the canonical document, sorted.
 *
 * This is the real drift guard. Adding, removing or renaming any field here
 * invalidates EVERY stored hash in every environment — previously-anchored
 * passports report a mismatch until they are rehashed. If this test fails,
 * that is the change you are making; do it deliberately, with a backfill.
 */
const EXPECTED_FIELDS = [
  '@context',
  '@id',
  '@type',
  'carbonSavingsVsNew',
  'categoryL1',
  'categoryL2',
  'ceMarking',
  'conditionGrade',
  'conditionNotes',
  'countryOfOrigin',
  'createdAt',
  'deconstructionDate',
  'deconstructionMethod',
  'dimensions',
  'embodiedCarbon',
  'epdReference',
  'gtin',
  'gwpTotal',
  'hazardousSubstances',
  'id',
  'manufacturerName',
  'materialComposition',
  'organisationId',
  // localeCompare puts productionDate before productName ('i' sorts before 'N')
  'productionDate',
  'productName',
  'reclaimedBy',
  'recycledContent',
  'remainingLifeEstimate',
  'serialNumber',
  'technicalSpecs',
];

describe('canonical passport fingerprint', () => {
  it('hashes exactly this set of fields, in sorted order', () => {
    const parsed = JSON.parse(buildCanonicalJsonLd(FIXTURE)) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(EXPECTED_FIELDS);
    expect(Object.keys(parsed)).toEqual(
      [...Object.keys(parsed)].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('agrees with the ethers implementation byte for byte', () => {
    // The API used ethers; the seed scripts used js-sha3. They are consolidated
    // on js-sha3 now, and this asserts the two remain interchangeable so the
    // choice of library can never silently change a stored fingerprint.
    const json = buildCanonicalJsonLd(FIXTURE);
    expect(computePassportHash(FIXTURE)).toBe(ethersKeccak256(Buffer.from(json, 'utf-8')));
  });

  it('is deterministic regardless of property order on the input', () => {
    const reordered = Object.fromEntries(
      Object.entries(FIXTURE).reverse(),
    ) as unknown as MaterialPassport;
    expect(computePassportHash(reordered)).toBe(computePassportHash(FIXTURE));
  });

  it('is 0x-prefixed keccak256', () => {
    expect(computePassportHash(FIXTURE)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('excludes photos, so attaching one later does not break the fingerprint', () => {
    const withPhoto: MaterialPassport = {
      ...FIXTURE,
      conditionPhotos: ['https://example.test/passports/x/photos/1.jpg'],
    };
    expect(computePassportHash(withPhoto)).toBe(computePassportHash(FIXTURE));
  });

  it('excludes updatedAt, so touching a row does not break the fingerprint', () => {
    // ops/sql/2026-09-01-restore-curated-demo-state.sql relies on this.
    const touched: MaterialPassport = {
      ...FIXTURE,
      updatedAt: new Date('2027-01-01T00:00:00.000Z'),
    };
    expect(computePassportHash(touched)).toBe(computePassportHash(FIXTURE));
  });

  it('changes when substantive data changes', () => {
    const tampered: MaterialPassport = { ...FIXTURE, conditionGrade: 'C' };
    expect(computePassportHash(tampered)).not.toBe(computePassportHash(FIXTURE));
  });

  it('treats numeric columns as strings, matching what Drizzle returns', () => {
    // A numeric read back as a JS number instead of a string serialises
    // differently and silently changes the hash.
    const asNumber = { ...FIXTURE, gwpTotal: 0.0725 as unknown as string };
    expect(computePassportHash(asNumber)).not.toBe(computePassportHash(FIXTURE));
  });

  it('excludes status, so a marketplace offer cannot forge a tamper alarm', () => {
    // This is the regression that broke all seven curated passports in June:
    // makeOffer flips a passport to 'reserved' without rehashing, so a
    // legitimate purchase turned "Untampered" into "Mismatch". Lifecycle state
    // is not a property of the material and must not be fingerprinted.
    for (const status of ['active', 'listed', 'reserved', 'sold', 'installed'] as const) {
      const moved: MaterialPassport = { ...FIXTURE, status };
      expect(computePassportHash(moved)).toBe(computePassportHash(FIXTURE));
    }
  });
});
