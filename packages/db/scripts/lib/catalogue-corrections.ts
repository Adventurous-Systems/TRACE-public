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
 * Lots follow the same rule (lotCorrections): a minimum order or shipping
 * note is corrected only while it still holds what an earlier catalogue seeded.
 */
import { SEED_TAG } from '@trace/core/constants/demo-catalogue';
import { lotShippingNote, type Product } from './catalogue.js';

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

/**
 * Shipping notes earlier catalogues seeded on lots, by product key. Buyers
 * have chosen their quantity online since 2026-09-30, so "by arrangement"
 * is no longer true; new lots stopped carrying it then, older ones kept it.
 */
export const SUPERSEDED_LOT_NOTES: Record<string, readonly string[]> = {
  'kbriq-medero-dark-grey': ['From £3.60 each — order quantity by arrangement.'],
  'sisalwool-100': ['From £82 per pack — order quantity by arrangement.'],
};

/** Lots whose terms may be corrected: still on sale or fully ordered, never closed history. */
const CORRECTABLE_LOT_STATUSES = ['active', 'reserved'];

interface LotLike {
  status: string;
  quantity: number;
  minOrderQuantity: number;
  shippingOptions: Array<{ method: string; notes?: string; [key: string]: unknown }> | null;
}

export interface LotCorrections {
  minOrderQuantity?: number;
  shippingOptions?: LotLike['shippingOptions'];
}

/**
 * A curated lot's terms, brought up to the catalogue only where they still
 * hold what an earlier catalogue seeded: a minimum order of 1 from before
 * minimums existed, and a superseded shipping note. A minimum or note anyone
 * has changed since stays as it is (D4, listing management).
 */
export function lotCorrections(lot: LotLike, product: Product): LotCorrections {
  const corrections: LotCorrections = {};
  if (!CORRECTABLE_LOT_STATUSES.includes(lot.status)) return corrections;

  const minimum = product.listing.minOrderQuantity ?? 1;
  if (lot.minOrderQuantity === 1 && minimum > 1 && minimum <= lot.quantity) {
    corrections.minOrderQuantity = minimum;
  }

  const superseded = SUPERSEDED_LOT_NOTES[product.key] ?? [];
  const options = lot.shippingOptions ?? [];
  if (options.some((o) => o.notes !== undefined && superseded.includes(o.notes))) {
    corrections.shippingOptions = options.map((o) =>
      o.notes !== undefined && superseded.includes(o.notes)
        ? { ...o, notes: lotShippingNote(product) }
        : o,
    );
  }
  return corrections;
}
