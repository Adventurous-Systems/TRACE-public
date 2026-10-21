import { CATALOG, SEED_TAG } from './catalogue.js';

/**
 * One passport per curated product (owner, 2026-10-21). Which curated
 * passports demo-retire-spares keeps, deletes, or leaves alone.
 */

export interface CuratedPassportRow {
  passportId: string;
  productName: string;
  customAttributes: Record<string, unknown> | null;
  /** Statuses of every listing of this passport. */
  listingStatuses: string[];
  transactions: number;
  events: number;
  qualityReports: number;
  sensorReadings: number;
}

export interface ProtectedSpare {
  passportId: string;
  productName: string;
  reasons: string[];
}

export interface ProductSparePlan {
  catalogueKey: string;
  /** Undefined when the product has no curated passport at all. */
  keep?: { passportId: string; productName: string };
  retire: { passportId: string; productName: string }[];
  protected: ProtectedSpare[];
}

/** A listing in one of these states is the product's lot on the marketplace. */
const LIVE_LISTING = ['active', 'reserved'];
/** A spare may only have listings that never sold anything. */
const RETIRABLE_LISTING = ['cancelled', 'expired'];
const CATALOGUE_KEYS = new Set(CATALOG.map((product) => product.key));

export function curatedKey(row: Pick<CuratedPassportRow, 'customAttributes'>): string | undefined {
  const metadata = row.customAttributes ?? {};
  const key = metadata['catalogueKey'];
  if (metadata['seedSource'] !== SEED_TAG) return undefined;
  return typeof key === 'string' && CATALOGUE_KEYS.has(key) ? key : undefined;
}

/** A passport without a lot number is a product's original, so lot 1. */
export function demoLotNumber(row: Pick<CuratedPassportRow, 'customAttributes'>): number {
  const value = row.customAttributes?.['demoLotNumber'];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
}

const isLive = (row: CuratedPassportRow) =>
  row.listingStatuses.some((status) => LIVE_LISTING.includes(status));

/** Why a spare must be left alone; empty when it can be deleted. */
export function spareProtection(row: CuratedPassportRow): string[] {
  const reasons: string[] = [];
  if (row.transactions > 0) reasons.push(`${row.transactions} order(s)`);
  if (row.events > 0) reasons.push(`${row.events} history event(s)`);
  if (row.qualityReports > 0) reasons.push(`${row.qualityReports} quality report(s)`);
  if (row.sensorReadings > 0) reasons.push(`${row.sensorReadings} sensor reading(s)`);
  const other = row.listingStatuses.filter((status) => !RETIRABLE_LISTING.includes(status));
  if (other.length > 0) reasons.push(`a listing that is ${[...new Set(other)].join(', ')}`);
  return reasons;
}

/**
 * Per catalogue product: keep its live lot (the lowest-numbered, if somehow
 * there are several), or its lowest-numbered passport when none is live, as
 * demo-restore's byCatalogueKey picks it. Every other passport of the product
 * is deleted if nothing depends on it, and reported otherwise.
 */
export function planSpareRetirement(rows: CuratedPassportRow[]): ProductSparePlan[] {
  return CATALOG.map((product) => {
    const lots = rows
      .filter((row) => curatedKey(row) === product.key)
      .sort(
        (a, b) => demoLotNumber(a) - demoLotNumber(b) || a.passportId.localeCompare(b.passportId),
      );
    const keeper = lots.find(isLive) ?? lots[0];
    const plan: ProductSparePlan = { catalogueKey: product.key, retire: [], protected: [] };
    if (!keeper) return plan;
    plan.keep = { passportId: keeper.passportId, productName: keeper.productName };
    for (const lot of lots) {
      if (lot === keeper) continue;
      const reasons = spareProtection(lot);
      const entry = { passportId: lot.passportId, productName: lot.productName };
      if (reasons.length === 0) plan.retire.push(entry);
      else plan.protected.push({ ...entry, reasons });
    }
    return plan;
  });
}
