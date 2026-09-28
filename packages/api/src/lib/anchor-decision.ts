/**
 * What an anchor job should do for a passport, decided from what the registry
 * currently holds for it (ChainAdapter.getPassportAnchor), never from the
 * database's anchor columns:
 *
 *   - not registered on chain                  → register
 *   - registered, chain hash ≠ recomputed hash → update (updatePassportHash)
 *   - registered, chain hash = recomputed hash → skip (already current)
 *
 * The database is not a safe source: updatePassport() clears
 * blockchainTxHash when a passport is edited, and a simulated record has a
 * fingerprint but no transaction. Deciding from those made an edited passport
 * try registerPassport again, which the registry rejects
 * (PassportAlreadyExists), so edits were never re-anchored.
 */
export type AnchorAction = 'register' | 'update' | 'skip';

export function decideAnchorAction(
  onchain: { registered: boolean; dataHash: string | null },
  recomputedHash: string,
): AnchorAction {
  if (!onchain.registered) return 'register';
  return onchain.dataHash?.toLowerCase() === recomputedHash.toLowerCase() ? 'skip' : 'update';
}
