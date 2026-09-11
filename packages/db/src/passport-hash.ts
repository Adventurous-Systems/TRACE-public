/**
 * Canonical passport fingerprinting — the single source of truth.
 *
 * Produces a reproducible keccak256 "digital fingerprint" of a material
 * passport's substantive data (keys sorted for determinism). Photos are
 * intentionally excluded, so a passport's fingerprint is stable whether or
 * not condition photos are attached later.
 *
 * This lives in @trace/db rather than @trace/api because BOTH sides of the
 * demo's headline moment depend on it agreeing exactly:
 *
 *   - the API writes the hash (simulated anchor + on-chain anchoring worker)
 *     and recomputes it for the public /verify-integrity endpoint;
 *   - the seed/restore scripts write the same hash for curated demo passports.
 *
 * These were previously two hand-maintained copies (packages/api/src/lib and
 * packages/db/scripts/seed-products.ts). Any drift between them turns the
 * demo's "Untampered" result into "Mismatch" with no other symptom, so the
 * copies are now one implementation guarded by a golden-hash test in
 * packages/api/src/lib/passport-hash.test.ts.
 *
 * CHANGING THE SHAPE OF THIS DOCUMENT INVALIDATES EVERY STORED HASH. Fields
 * added, removed or renamed here will make previously-anchored passports
 * report a mismatch until they are rehashed. Bump the @context version and
 * plan a backfill deliberately; do not adjust it casually.
 */
import { createRequire } from 'module';
import type { MaterialPassport } from '../drizzle/schema.js';

// js-sha3 is CommonJS and provides no named ESM export, so a bare
// `import { keccak256 } from 'js-sha3'` throws at module load:
//   SyntaxError: The requested module 'js-sha3' does not provide an export named 'keccak256'
// This interop is deliberate (see commit ab6f1b3) — do not "simplify" it.
const { keccak256 } = createRequire(import.meta.url)('js-sha3') as {
  keccak256: (input: string) => string;
};

export function buildCanonicalJsonLd(passport: MaterialPassport): string {
  const doc = {
    '@context': [
      'https://schema.org/',
      'https://w3id.org/dpp/v1',
      'https://trace.construction/context/v1',
    ],
    '@type': 'MaterialPassport',
    '@id': `https://trace.construction/passport/${passport.id}`,
    id: passport.id,
    organisationId: passport.organisationId,
    productName: passport.productName,
    categoryL1: passport.categoryL1,
    categoryL2: passport.categoryL2 ?? null,
    gtin: passport.gtin ?? null,
    serialNumber: passport.serialNumber ?? null,
    materialComposition: passport.materialComposition,
    dimensions: passport.dimensions ?? null,
    technicalSpecs: passport.technicalSpecs,
    manufacturerName: passport.manufacturerName ?? null,
    countryOfOrigin: passport.countryOfOrigin ?? null,
    productionDate: (passport.productionDate as Date | null)?.toISOString() ?? null,
    gwpTotal: passport.gwpTotal ?? null,
    embodiedCarbon: passport.embodiedCarbon ?? null,
    recycledContent: passport.recycledContent ?? null,
    epdReference: passport.epdReference ?? null,
    ceMarking: passport.ceMarking,
    conditionGrade: passport.conditionGrade ?? null,
    conditionNotes: passport.conditionNotes ?? null,
    deconstructionDate: (passport.deconstructionDate as Date | null)?.toISOString() ?? null,
    deconstructionMethod: passport.deconstructionMethod ?? null,
    reclaimedBy: passport.reclaimedBy ?? null,
    remainingLifeEstimate: passport.remainingLifeEstimate ?? null,
    carbonSavingsVsNew: passport.carbonSavingsVsNew ?? null,
    hazardousSubstances: passport.hazardousSubstances,
    // NOTE: `status` is deliberately NOT hashed. It is marketplace lifecycle
    // state (active/listed/reserved/sold), not a property of the material.
    // Including it meant makeOffer flipping a passport to 'reserved' turned a
    // valid "Untampered" result into "Mismatch" with no tampering having
    // occurred — which is exactly what silently broke all seven curated demo
    // passports in June. Removed 2026-09-01; see scripts/rehash-passports.ts.
    createdAt: passport.createdAt.toISOString(),
  };

  // Sort keys so the hash is reproducible regardless of source insertion order.
  const sorted = Object.fromEntries(Object.entries(doc).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sorted);
}

/**
 * keccak256 of the canonical document, 0x-prefixed.
 *
 * js-sha3 hashes the UTF-8 encoding of the string, which is byte-identical to
 * ethers' `keccak256(Buffer.from(json, 'utf-8'))`. The test asserts that
 * equivalence so the choice of library can never silently change the result.
 */
export function computePassportHash(passport: MaterialPassport): string {
  return `0x${keccak256(buildCanonicalJsonLd(passport))}`;
}
