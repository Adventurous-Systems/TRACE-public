import { describe, expect, it } from 'vitest';
import {
  deconstructionMethodLabel,
  formatDate,
  formatDateTime,
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
});

describe('formatDateTime', () => {
  it('uses a 24-hour clock and a spelled-out month', () => {
    expect(formatDateTime(new Date(2026, 8, 29, 15, 41))).toBe('29 Sept 2026, 15:41');
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
