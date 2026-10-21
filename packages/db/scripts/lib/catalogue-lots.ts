import { CATALOG, LIVE_LOT_STATUSES, SEED_TAG, isCatalogueName } from './catalogue.js';

/**
 * Which catalogue product a curated passport belongs to, its lot number, and
 * which of a product's passports is its one lot (owner, 2026-10-21: one
 * passport per product). The top-up, demo-retire-spares, demo-restore and the
 * invariant check all use these, so they agree on the same lot.
 */

export interface CuratedPassportLike {
  id: string;
  productName: string;
  customAttributes: Record<string, unknown> | null;
}

const CATALOGUE_KEYS = new Set(CATALOG.map((product) => product.key));

/**
 * The catalogue product of a curated passport: its catalogueKey, or, for an
 * original seeded before keys existed, its name (current or superseded).
 * Undefined for anything without the curated tag.
 */
export function catalogueKeyOf(
  passport: Pick<CuratedPassportLike, 'productName' | 'customAttributes'>,
): string | undefined {
  const metadata = passport.customAttributes ?? {};
  if (metadata['seedSource'] !== SEED_TAG) return undefined;
  const key = metadata['catalogueKey'];
  if (typeof key === 'string') return CATALOGUE_KEYS.has(key) ? key : undefined;
  return CATALOG.find((product) => isCatalogueName(passport.productName, product))?.key;
}

/** A passport without a lot number is a product's original, so lot 1. */
export function demoLotNumberOf(passport: Pick<CuratedPassportLike, 'customAttributes'>): number {
  const value = passport.customAttributes?.['demoLotNumber'];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
}

/**
 * A product's one lot among its passports: the lowest-numbered one on sale or
 * fully ordered; else the lowest-numbered one that sold (the top-up reopens it
 * in place, and a sold passport can never be deleted); else the lowest-numbered.
 */
export function productLot<T extends CuratedPassportLike>(
  passports: T[],
  listingStatusesOf: (passportId: string) => string[],
): T | undefined {
  const ordered = [...passports].sort(
    (a, b) => demoLotNumberOf(a) - demoLotNumberOf(b) || a.id.localeCompare(b.id),
  );
  const has = (passport: T, statuses: readonly string[]) =>
    listingStatusesOf(passport.id).some((status) => statuses.includes(status));
  return (
    ordered.find((passport) => has(passport, LIVE_LOT_STATUSES)) ??
    ordered.find((passport) => has(passport, ['sold'])) ??
    ordered[0]
  );
}
