/**
 * Which catalogue corrections apply to an existing curated passport or lot.
 *
 * Only an explicit allowlist of descriptive, catalogue-owned fields is ever
 * corrected. Never the product name (lots carry a "— Demo Lot NNN" suffix),
 * never status, and never anything an inspector or seller can change on a
 * live demo (condition grade, notes, photos). That is what makes a correction
 * safe to run on a host with visitor data, unlike demo:restore.
 */
import { SEED_TAG } from '@trace/core/constants/demo-catalogue';
import type { Product } from './catalogue.js';

export const CORRECTABLE_FIELDS = [
  'categoryL1',
  'categoryL2',
  'reclaimedBy',
  'unitOfMeasure',
] as const;
export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

/** Corrected values, typed like their columns (categoryL1 is never null). */
export interface CatalogueCorrections {
  categoryL1?: string;
  categoryL2?: string | null;
  reclaimedBy?: string | null;
  unitOfMeasure?: string | null;
}

interface PassportLike {
  productName: string;
  customAttributes: Record<string, unknown> | null;
  categoryL1: string;
  categoryL2: string | null;
  reclaimedBy: string | null;
  unitOfMeasure: string | null;
}

/** A catalogue product's curated passport or one of its numbered lots. */
export function isCatalogueLot(passport: PassportLike, product: Product): boolean {
  const metadata = passport.customAttributes ?? {};
  return (
    metadata['catalogueKey'] === product.key ||
    (metadata['seedSource'] === SEED_TAG && passport.productName === product.passport.productName)
  );
}

/** Field → corrected value, for every allowlisted field that differs. */
export function catalogueCorrections(
  passport: PassportLike,
  product: Product,
): CatalogueCorrections {
  const corrections: Record<string, string | null> = {};
  for (const field of CORRECTABLE_FIELDS) {
    const want = (product.passport as Record<string, unknown>)[field];
    if (want === undefined) continue;
    const wanted = (want as string | null) ?? null;
    // categoryL1 is required: never "correct" it to null.
    if (field === 'categoryL1' && wanted === null) continue;
    if ((passport[field] ?? null) !== wanted) corrections[field] = wanted;
  }
  return corrections as CatalogueCorrections;
}
