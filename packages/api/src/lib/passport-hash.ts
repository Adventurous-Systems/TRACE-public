/**
 * Canonical passport fingerprinting.
 *
 * The implementation moved to @trace/db so the API and the seed/restore
 * scripts share exactly one copy — they previously kept two hand-maintained
 * ones, and any drift silently turned the demo's "Untampered" result into
 * "Mismatch". See packages/db/src/passport-hash.ts.
 *
 * This module stays as the API's import path (passport.service.ts and
 * anchor-passport.worker.ts import from here) and is guarded by the
 * golden-hash test alongside it.
 */
export { buildCanonicalJsonLd, computePassportHash } from '@trace/db';
