import { describe, expect, it } from 'vitest';
import {
  formatPrice,
  deconstructionMethodLabel,
  formatDate,
  formatDateTime,
  formatUkDay,
  shippingMethodLabel,
} from './format';

describe('formatDate', () => {
  // "6/1/2026" read as 6 January in the UK but meant 1 June.
  it('spells the month out, day first, whatever the browser locale', () => {
    expect(formatDate('2026-06-01T00:00:00Z')).toBe('1 Jun 2026');
  });

  it('returns an empty string for missing or invalid dates', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate('not a date')).toBe('');
  });

  it('gives the UK day, so a server in UTC and a reader elsewhere agree (#418)', () => {
    // 23:30 UTC in British Summer Time is already the next day in the UK.
    expect(formatDate('2026-06-01T23:30:00Z')).toBe('2 Jun 2026');
    // A date-only value (a date column) stays that day.
    expect(formatDate('2026-06-01')).toBe('1 Jun 2026');
  });
});

describe('formatDateTime', () => {
  it('uses a 24-hour clock, a spelled-out month, and UK time', () => {
    // British Summer Time: UTC+1.
    expect(formatDateTime('2026-09-29T14:41:00Z')).toBe('29 Sept 2026, 15:41');
    // Greenwich Mean Time: UTC.
    expect(formatDateTime('2026-11-05T15:41:00Z')).toBe('5 Nov 2026, 15:41');
    expect(formatDateTime(null)).toBe('');
  });
});

describe('labels', () => {
  it('never shows raw enum values', () => {
    expect(deconstructionMethodLabel('selective')).toBe('Selective deconstruction');
    expect(shippingMethodLabel('both')).toBe('Delivery or collection');
  });

  it('falls back to the value for unknown ones, and empty for none', () => {
    expect(shippingMethodLabel('drone')).toBe('drone');
    expect(deconstructionMethodLabel(undefined)).toBe('');
  });
});

describe('formatPrice', () => {
  it('shows pounds with pence and thousands separators', () => {
    expect(formatPrice(360)).toBe('£3.60');
    expect(formatPrice(1800000)).toBe('£18,000.00');
  });
});

describe('formatUkDay', () => {
  it('gives the UK day, wherever the reader is (R3)', () => {
    // The end of 5 Nov in the UK is already 6 Nov in South Africa.
    expect(formatUkDay('2026-11-05T23:59:59.999Z')).toBe('5 Nov 2026');
    // British Summer Time: the end of 10 Oct in the UK is 22:59 UTC.
    expect(formatUkDay('2026-10-10T22:59:59.999Z')).toBe('10 Oct 2026');
    expect(formatUkDay(null)).toBe('');
  });
});
