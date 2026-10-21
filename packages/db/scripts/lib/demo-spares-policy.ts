import { CATALOG } from './catalogue.js';
import { catalogueKeyOf, demoLotNumberOf, productLot } from './catalogue-lots.js';

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

/** A spare may only have listings that never sold anything. */
const RETIRABLE_LISTING = ['cancelled', 'expired'];

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
 * Per catalogue product: keep its one lot (productLot: the live one, else one
 * that sold, else the lowest-numbered), as the top-up and demo-restore pick it.
 * Every other passport of the product is deleted if nothing depends on it,
 * and reported otherwise.
 */
export function planSpareRetirement(rows: CuratedPassportRow[]): ProductSparePlan[] {
  const statusesOf = (id: string) =>
    rows.find((row) => row.passportId === id)?.listingStatuses ?? [];
  return CATALOG.map((product) => {
    const lots = rows
      .filter((row) => catalogueKeyOf(row) === product.key)
      .map((row) => ({ ...row, id: row.passportId }));
    const keeper = productLot(lots, statusesOf);
    const plan: ProductSparePlan = { catalogueKey: product.key, retire: [], protected: [] };
    if (!keeper) return plan;
    plan.keep = { passportId: keeper.passportId, productName: keeper.productName };
    lots.sort((a, b) => demoLotNumberOf(a) - demoLotNumberOf(b) || a.id.localeCompare(b.id));
    for (const lot of lots) {
      if (lot.passportId === keeper.passportId) continue;
      const reasons = spareProtection(lot);
      const entry = { passportId: lot.passportId, productName: lot.productName };
      if (reasons.length === 0) plan.retire.push(entry);
      else plan.protected.push({ ...entry, reasons });
    }
    return plan;
  });
}
