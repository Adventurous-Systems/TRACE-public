export const PASSPORT_STATUSES = [
  'draft',
  'active',
  'listed',
  'reserved',
  'sold',
  'installed',
  'decommissioned',
] as const;

export const CONDITION_GRADES = ['A', 'B', 'C', 'D'] as const;

// Unit a material is counted/sold by. Gives quantities, price, and carbon a clear
// basis (e.g. "12 kgCO₂e per block", "£45 / m²").
export const UNITS_OF_MEASURE = [
  'each',
  'm2',
  'm',
  'kg',
  'tonne',
  'pallet',
  'set',
  'pack',
] as const;

// Human-readable labels for each unit (UI display).
export const UNIT_OF_MEASURE_LABELS: Record<(typeof UNITS_OF_MEASURE)[number], string> = {
  each: 'each',
  m2: 'm²',
  m: 'linear m',
  kg: 'kg',
  tonne: 'tonne',
  pallet: 'pallet',
  set: 'set',
  pack: 'pack',
};

// Units counted in whole things, which take a plural ("250 packs").
const COUNTED_UNIT_PLURALS: Record<string, string> = {
  tonne: 'tonnes',
  pallet: 'pallets',
  set: 'sets',
  pack: 'packs',
};

// Display label for a stored unit-of-measure code, falling back to the raw value.
export function unitLabel(u?: string | null): string {
  if (!u) return '';
  return (UNIT_OF_MEASURE_LABELS as Record<string, string>)[u] ?? u;
}

/** What a unit price or per-unit figure is quoted per: "each", "per m²"; '' if unknown. */
export function perUnit(u?: string | null): string {
  if (!u) return '';
  return u === 'each' ? 'each' : `per ${unitLabel(u)}`;
}

/** A quantity in its unit: "5,000" (each or unknown), "120 m²", "1 pack", "250 packs". */
export function formatQuantity(quantity: number, u?: string | null): string {
  const n = quantity.toLocaleString('en-GB');
  if (!u || u === 'each') return n;
  const plural = COUNTED_UNIT_PLURALS[u];
  if (plural) return `${n} ${quantity === 1 ? unitLabel(u) : plural}`;
  return `${n} ${unitLabel(u)}`;
}

// Money is whole pence in a 32-bit integer column. These limits keep every
// price, and every order total, inside it with room to spare.
/** The most a unit price or an order total may be: £20,000,000.00. */
export const MAX_AMOUNT_PENCE = 2_000_000_000;
/** The most units a lot may hold. */
export const MAX_LOT_QUANTITY = 1_000_000_000;

// Who stands behind a quality report. Only an inspector's report is an
// independent inspection; a hub's or supplier's report on a material is the
// seller's own check, and is shown as such (owner decision, 2026-10-02).
export type InspectionSource = 'independent' | 'seller' | 'platform';

export function inspectionSource(role: string | null | undefined): InspectionSource {
  if (role === 'inspector') return 'independent';
  if (role === 'platform_admin') return 'platform';
  return 'seller';
}

export const INSPECTION_SOURCE_LABELS: Record<InspectionSource, string> = {
  independent: 'Independent inspection',
  seller: "Seller's own check",
  platform: 'Checked by the platform',
};

/** The reporter's role in a buyer's words. */
export const INSPECTOR_ROLE_LABELS: Record<InspectionSource, string> = {
  independent: 'independent quality auditor',
  seller: 'the seller',
  platform: 'the platform operator',
};

export const DECONSTRUCTION_METHODS = ['selective', 'mechanical', 'manual', 'mixed'] as const;

export const USER_ROLES = [
  'platform_admin',
  'hub_admin',
  'hub_staff',
  'supplier',
  'buyer',
  'inspector',
] as const;

export const ORGANISATION_TYPES = ['hub', 'manufacturer', 'contractor', 'certifier'] as const;

export const LISTING_STATUSES = ['active', 'reserved', 'sold', 'expired', 'cancelled'] as const;

export const TRANSACTION_STATUSES = [
  'pending',
  'confirmed',
  'disputed',
  'resolved',
  'completed',
  'cancelled',
] as const;

// GS1 company prefix for prototype (not a real GS1 licence)
export const PROTOTYPE_GS1_PREFIX = '0000000';

// CBT reward amounts (in whole tokens, 18 decimals on-chain)
export const CBT_REWARDS = {
  REGISTER_PASSPORT: 10,
  SUBMIT_QUALITY_REPORT: 5,
  COMPLETE_TRANSACTION: 2,
  REFER_HUB: 50,
} as const;

// Staking / governance thresholds
export const GOVERNANCE = {
  MIN_CBT_TO_PROPOSE: 100,
  VOTING_PERIOD_DAYS: 7,
  QUORUM_PERCENT: 10,
  DISPUTE_WINDOW_HOURS: 48,
} as const;

// Blockchain anchoring
export const BLOCKCHAIN = {
  MAX_ANCHOR_RETRIES: 3,
  ANCHOR_RETRY_DELAY_MS: 5_000,
  TX_CONFIRMATION_TIMEOUT_MS: 60_000,
} as const;

// Condition grade descriptions
export const CONDITION_GRADE_LABELS: Record<string, string> = {
  A: 'Excellent — as new, no visible wear',
  B: 'Good — minor wear, fully functional',
  C: 'Fair — moderate wear, may need minor repair',
  D: 'Poor — significant wear, requires assessment',
};

// ── Order time limits (owner decisions, 2026-10-02) ─────────────────────────
/** A seller has this long to answer an order; then it lapses and the stock returns. */
export const ORDER_RESPONSE_HOURS = 72;
/**
 * After the seller accepts, the buyer has this long to report a problem; an
 * order with no word from the buyer then completes by itself.
 */
export const ORDER_PROBLEM_WINDOW_HOURS = 48;

/** How a flagged order is resolved. */
export const DISPUTE_OUTCOMES = ['sale_stands', 'cancel_order'] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];
