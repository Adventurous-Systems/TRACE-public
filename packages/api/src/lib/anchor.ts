/**
 * Re-anchoring a passport after its substantive data changes.
 *
 * WHY THIS EXISTS
 * The canonical fingerprint (see @trace/db passport-hash) covers the material's
 * substantive properties — including `conditionGrade`. Any code path that
 * changes one of those fields MUST re-anchor, or the stored fingerprint goes
 * stale and the public /verify-integrity endpoint reports "Mismatch" on a
 * passport nobody tampered with.
 *
 * This was previously inlined as a private helper in passport.service.ts, so
 * only the passport module got it right. quality.service.ts writes
 * `conditionGrade` when an inspector files a report with a grade, and did not
 * re-anchor — meaning filing an inspection during a demo permanently broke that
 * product's trust moment. Same failure as the `status`/makeOffer bug that was
 * removed from the canonical document; this one is a genuine data change, so
 * the fix is to re-anchor rather than to stop hashing the field.
 *
 * Every future writer of a hashed field should call this.
 */
import { eq } from 'drizzle-orm';
import { db, materialPassports, type MaterialPassport } from '@trace/db';
import { env } from '../env.js';
import { anchorQueue } from './queue.js';
import { computePassportHash } from './passport-hash.js';

/**
 * Demo simulation: compute a real keccak256 fingerprint and record it as a
 * "trust layer prepared" state WITHOUT submitting a VeChain transaction.
 * The convention `blockchainAnchoredAt != null && blockchainTxHash == null`
 * marks a simulated record (see getPassportCertificate / verifyPassport).
 */
export async function simulatePassportAnchor(
  passport: MaterialPassport,
): Promise<MaterialPassport> {
  const hash = computePassportHash(passport);
  const [updated] = await db
    .update(materialPassports)
    .set({
      blockchainPassportHash: hash,
      blockchainAnchoredAt: new Date(),
      blockchainTxHash: null,
      updatedAt: new Date(),
    })
    .where(eq(materialPassports.id, passport.id))
    .returning();
  return updated ?? passport;
}

/**
 * Re-anchor a passport whose hashed data has just changed.
 *
 * In demo/simulation mode the fingerprint is recomputed synchronously, so the
 * trust seal is correct the instant the change lands. Otherwise a fresh anchor
 * job is queued; the jobId is time-suffixed so it never collides with the
 * passport's original anchor job.
 */
export async function reanchorPassport(passport: MaterialPassport): Promise<MaterialPassport> {
  if (env.DEMO_SIMULATE_ANCHOR) {
    return await simulatePassportAnchor(passport);
  }

  await anchorQueue.add(
    'default',
    { passportId: passport.id, organisationId: passport.organisationId },
    { jobId: `anchor-${passport.id}-${Date.now()}` },
  );

  return passport;
}
