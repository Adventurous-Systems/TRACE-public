/**
 * What a passport says about the material itself, in words a buyer reads:
 * where it comes from, what it is made of, its size and its specifications.
 * The data was always there (seeded and returned by the API); no page showed
 * it until the 2026-10-13 journey audit.
 */
import { PASSPORT_ORIGIN_LABELS, type PassportOrigin } from '@trace/core';

export interface DimensionsLike {
  length?: number | null;
  width?: number | null;
  height?: number | null;
  weight?: number | null;
  unit?: string | null;
  weightUnit?: string | null;
}

/** "215 × 102.5 × 65 mm · 2.4 kg", or null when nothing is recorded. */
export function dimensionsLine(d: DimensionsLike | null | undefined): string | null {
  if (!d) return null;
  const size = [d.length, d.width, d.height].filter((n) => n !== undefined && n !== null);
  const parts = [
    size.length ? `${size.join(' × ')} ${d.unit ?? ''}`.trim() : null,
    d.weight ? `${d.weight} ${d.weightUnit ?? 'kg'}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** "Reclaimed", "Surplus (unused stock)", "New circular product"; null when not said. */
export function originLabel(origin: string | null | undefined): string | null {
  return origin && origin in PASSPORT_ORIGIN_LABELS
    ? PASSPORT_ORIGIN_LABELS[origin as PassportOrigin]
    : null;
}

const SPEC_LABELS: Record<string, string> = {
  compressiveStrength: 'Compressive strength',
  waterAbsorption: 'Water absorption',
  thermalConductivity: 'Thermal conductivity',
  durability: 'Durability',
  reactionToFire: 'Reaction to fire',
  certification: 'Certification',
  thickness: 'Thickness',
  widths: 'Widths',
  acoustic: 'Acoustic performance',
  breathability: 'Breathability',
  pestResistance: 'Pest resistance',
  type: 'Type',
  description: 'Description',
  treadDepth: 'Tread depth',
  riserHeight: 'Riser height',
  steps: 'Steps',
  height: 'Height',
  length: 'Length',
  angle: 'Angle',
  source: 'Source',
};

/**
 * Specs that would contradict the passport elsewhere: a grade belongs to the
 * condition grade, which an inspection can change (journey 7 re-grades the
 * bricks from B to C; a spec still saying "B" would contradict it).
 */
const HIDDEN_SPECS = new Set(['grade', 'conditionGrade']);

/** "compressiveStrength", "fire_rating", "u-value" → "Compressive strength", "Fire rating", "U value". */
export function specLabel(key: string): string {
  if (SPEC_LABELS[key]) return SPEC_LABELS[key];
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The technical specifications worth showing, in the order they were recorded. */
export function specRows(
  specs: Record<string, unknown> | null | undefined,
): Array<{ label: string; value: string }> {
  return Object.entries(specs ?? {})
    .filter(([key, value]) => !HIDDEN_SPECS.has(key) && isShowable(value))
    .map(([key, value]) => ({ label: specLabel(key), value: String(value) }));
}

function isShowable(value: unknown): value is string | number | boolean {
  return (
    (typeof value === 'string' && value.trim() !== '') ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean'
  );
}

export interface CompositionLike {
  material: string;
  percentage?: number | null;
  recycled?: boolean | null;
}

/** The materials it is made of, largest share first. */
export function compositionRows(
  composition: CompositionLike[] | null | undefined,
): Array<{ material: string; share: string | null; recycled: boolean }> {
  return [...(composition ?? [])]
    .filter((part) => part.material?.trim())
    .sort((a, b) => (b.percentage ?? -1) - (a.percentage ?? -1))
    .map((part) => ({
      material: part.material,
      share: typeof part.percentage === 'number' ? `${part.percentage}%` : null,
      recycled: part.recycled === true,
    }));
}

/** A reuse a seller wrote as a slug ("feature-wall") reads as words ("Feature wall"). */
export function reuseLabel(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
