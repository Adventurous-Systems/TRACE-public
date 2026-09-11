import { getCategoryBySlug, getSubcategoryBySlug } from '@trace/core';

/**
 * J-03: finishes D-08's category-label fix. The 9 Sept fix corrected only
 * the marketplace filter dropdown (`marketplace/page.tsx`) — every other
 * page still printed the raw stored slug ("structural-steel" instead of
 * "Structural Steel"), including both public-facing pages
 * (`/marketplace/:id` and `/passport/:id`). `categoryL2` was raw everywhere,
 * including in the original fix.
 *
 * A shared helper rather than repeating the `?? fallback` expression at each
 * of the ~9 call sites, and — unlike the JSX it replaces — this is a pure
 * function with no `@/` imports, so it is unit-testable under the current
 * vitest setup (component tests are not, per the D-08 carbon-factors.ts
 * precedent).
 *
 * Falls back to the raw slug for an unknown value rather than throwing or
 * hiding it, so an out-of-sync category list degrades to today's behaviour
 * instead of a blank field.
 */
export function categoryLabel(l1: string | null | undefined, l2?: string | null): string {
  if (!l1) return '';
  const l1Label = getCategoryBySlug(l1)?.label ?? l1;
  if (!l2) return l1Label;
  const l2Label = getSubcategoryBySlug(l1, l2)?.label ?? l2;
  return `${l1Label} · ${l2Label}`;
}

/** Same as {@link categoryLabel} but with the '›' separator the public
 * passport page uses instead of '·'. */
export function categoryPath(l1: string | null | undefined, l2?: string | null): string {
  if (!l1) return '';
  const l1Label = getCategoryBySlug(l1)?.label ?? l1;
  if (!l2) return l1Label;
  const l2Label = getSubcategoryBySlug(l1, l2)?.label ?? l2;
  return `${l1Label} › ${l2Label}`;
}

/** The L2 label alone, for a caller that renders category/subcategory as
 * separate fields rather than one joined string (e.g. a definition list). */
export function subcategoryLabel(l1: string | null | undefined, l2: string): string {
  if (!l1) return l2;
  return getSubcategoryBySlug(l1, l2)?.label ?? l2;
}
