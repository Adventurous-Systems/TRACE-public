/**
 * What an anchor job should do for a passport, given its current fingerprint.
 *
 * The worker used to skip every passport that already had a transaction hash,
 * so reanchorPassport() (called after a hashed field such as conditionGrade
 * changes) queued jobs that did nothing and the chain kept the old hash. The
 * registry supports updates (MaterialRegistry.updatePassportHash), so:
 *
 *   - never submitted to a chain (no tx hash)     → register
 *   - submitted, stored hash ≠ recomputed hash    → update
 *   - submitted, stored hash = recomputed hash    → skip (nothing changed)
 *
 * A simulated record (fingerprint stored, no tx hash) counts as "never
 * submitted", so switching a deployment from simulation to on-chain anchors
 * its existing passports.
 */
export type AnchorAction = 'register' | 'update' | 'skip';

export function decideAnchorAction(
  passport: { blockchainTxHash: string | null; blockchainPassportHash: string | null },
  recomputedHash: string,
): AnchorAction {
  if (!passport.blockchainTxHash) return 'register';
  return passport.blockchainPassportHash === recomputedHash ? 'skip' : 'update';
}
