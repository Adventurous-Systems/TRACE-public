/**
 * Visitor-facing formatting: dates, and labels for internal enum values.
 *
 * TRACE is a UK service, and numeric dates are ambiguous across locales
 * ("6/1/2026" is 6 January in the UK, 1 June in the US), and the browser's
 * default locale decided which one a visitor saw. Dates are therefore always
 * shown in en-GB with the month spelled out. Raw enum values ("selective",
 * "both", "active") were also leaking into the UI; these helpers give them
 * human labels. Found in the 2026-09-29 browser rehearsal.
 */
import { BUSINESS_TIME_ZONE, type DeconstructionMethod } from '@trace/core';

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const UK_DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: BUSINESS_TIME_ZONE,
});

/**
 * The day a moment falls on in the UK: "5 Nov 2026". For dates that mean a UK
 * day, such as a listing's expiry (the end of that day, UK time), so a reader
 * elsewhere sees the same day the seller chose, not the next one (R3).
 */
export function formatUkDay(value: DateInput): string {
  const date = toDate(value);
  return date ? UK_DAY.format(date) : '';
}

/** "1 Jun 2026", or an empty string for a missing/invalid date. */
export function formatDate(value: DateInput): string {
  const date = toDate(value);
  return date
    ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
}

/** "29 Sep 2026, 15:41", or an empty string for a missing/invalid date. */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  return date
    ? date.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
}

const DECONSTRUCTION_LABELS: Record<DeconstructionMethod, string> = {
  selective: 'Selective deconstruction',
  mechanical: 'Mechanical deconstruction',
  manual: 'Manual deconstruction',
  mixed: 'Mixed methods',
};

export function deconstructionMethodLabel(method: string | null | undefined): string {
  if (!method) return '';
  return DECONSTRUCTION_LABELS[method as DeconstructionMethod] ?? method;
}

const SHIPPING_LABELS: Record<string, string> = {
  collection: 'Collection',
  delivery: 'Delivery',
  both: 'Delivery or collection',
};

export function shippingMethodLabel(method: string | null | undefined): string {
  if (!method) return '';
  return SHIPPING_LABELS[method] ?? method;
}

/** An amount in pence as pounds: "£3.60", "£18,000.00". */
export function formatPrice(pence: number): string {
  return `£${(pence / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
