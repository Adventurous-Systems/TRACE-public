/**
 * Which catalogue corrections apply to an existing curated passport or lot.
 *
 * Only an explicit allowlist of descriptive, catalogue-owned fields is ever
 * corrected. Never the product name (lots carry a "— Demo Lot NNN" suffix),
 * never status, and never anything an inspector or seller can change on a
 * live demo (condition grade, notes, photos). That is what makes a correction
 * safe to run on a host with visitor data, unlike demo:restore.
 *
 * One narrow exception: a condition note that still reads exactly as an
 * earlier catalogue wrote it (SUPERSEDED_CONDITION_NOTES) nobody has edited,
 * so it is brought up to the catalogue's current text. Any other note stays.
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

/**
 * Condition notes earlier catalogues seeded, by product key. The two below
 * stated a grade ("B grade.") that an inspection can change, so the notes
 * could contradict the passport (removed 2026-10-02).
 */
export const SUPERSEDED_CONDITION_NOTES: Record<string, readonly string[]> = {
  'reclaimed-aerated-concrete-blocks': [
    'Reclaimed aircrete blocks in good reusable condition. B grade.',
  ],
  'reclaimed-facing-bricks': [
    'Reclaimed perforated facing bricks, cleaned and palletised. B grade.',
  ],
};

/** Corrected values, typed like their columns (categoryL1 is never null). */
export interface CatalogueCorrections {
  categoryL1?: string;
  categoryL2?: string | null;
  reclaimedBy?: string | null;
  unitOfMeasure?: string | null;
  conditionNotes?: string | null;
}

interface PassportLike {
  productName: string;
  customAttributes: Record<string, unknown> | null;
  categoryL1: string;
  categoryL2: string | null;
  reclaimedBy: string | null;
  unitOfMeasure: string | null;
  conditionNotes?: string | null;
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
  const notes = passport.conditionNotes ?? null;
  const currentNotes = product.passport.conditionNotes ?? null;
  if (
    notes !== null &&
    currentNotes !== null &&
    notes !== currentNotes &&
    (SUPERSEDED_CONDITION_NOTES[product.key] ?? []).includes(notes)
  ) {
    corrections['conditionNotes'] = currentNotes;
  }
  return corrections as CatalogueCorrections;
}
