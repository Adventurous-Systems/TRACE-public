import { CATALOG, SEED_TAG } from './catalogue.js';

export interface TrimSourceRow {
  listingId: string;
  passportId: string;
  customAttributes: Record<string, unknown> | null;
  hasTransaction: boolean;
}

export interface EligibleDemoLot extends TrimSourceRow {
  catalogueKey: string;
  demoLotNumber: number;
}

export interface ProductTrimPlan {
  catalogueKey: string;
  active: number;
  keepIds: string[];
  cancelIds: string[];
  protectedIds: string[];
}

const CATALOGUE_KEYS = new Set(CATALOG.map((product) => product.key));

export function eligibleDemoLot(row: TrimSourceRow): EligibleDemoLot | undefined {
  const metadata = row.customAttributes ?? {};
  const catalogueKey = metadata['catalogueKey'];
  const demoLotNumber = metadata['demoLotNumber'];
  if (metadata['seedSource'] !== SEED_TAG) return undefined;
  if (typeof catalogueKey !== 'string' || !CATALOGUE_KEYS.has(catalogueKey)) return undefined;
  if (typeof demoLotNumber !== 'number' || !Number.isInteger(demoLotNumber) || demoLotNumber < 1) {
    return undefined;
  }
  return { ...row, catalogueKey, demoLotNumber };
}

export function planDemoLotTrim(lots: EligibleDemoLot[], targetActive: number): ProductTrimPlan[] {
  if (!Number.isInteger(targetActive) || targetActive < 1 || targetActive > 10) {
    throw new Error('targetActive must be an integer from 1 to 10');
  }

  return CATALOG.map((product) => {
    const active = lots
      .filter((lot) => lot.catalogueKey === product.key)
      .sort((a, b) => a.demoLotNumber - b.demoLotNumber || a.listingId.localeCompare(b.listingId));
    const keep = active.slice(0, targetActive);
    const excess = active.slice(targetActive);
    return {
      catalogueKey: product.key,
      active: active.length,
      keepIds: keep.map((lot) => lot.listingId),
      cancelIds: excess.filter((lot) => !lot.hasTransaction).map((lot) => lot.listingId),
      protectedIds: excess.filter((lot) => lot.hasTransaction).map((lot) => lot.listingId),
    };
  });
}
