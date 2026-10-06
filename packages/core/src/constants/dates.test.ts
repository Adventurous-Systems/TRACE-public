import { describe, expect, it } from 'vitest';
import { endOfDayInLondon } from './dates.js';

describe('endOfDayInLondon', () => {
  it('in summer time, ends at 22:59:59.999 UTC', () => {
    expect(endOfDayInLondon('2026-10-06').toISOString()).toBe('2026-10-06T22:59:59.999Z');
  });

  it('in winter, ends at 23:59:59.999 UTC', () => {
    expect(endOfDayInLondon('2026-12-01').toISOString()).toBe('2026-12-01T23:59:59.999Z');
  });

  it('on the days the clocks change, uses the offset at the end of the day', () => {
    // Clocks go back on 25 Oct 2026 (01:00 UTC): the day ends in GMT.
    expect(endOfDayInLondon('2026-10-25').toISOString()).toBe('2026-10-25T23:59:59.999Z');
    // Clocks go forward on 29 Mar 2026: the day ends in BST.
    expect(endOfDayInLondon('2026-03-29').toISOString()).toBe('2026-03-29T22:59:59.999Z');
  });

  it('refuses something that is not a date', () => {
    expect(() => endOfDayInLondon('2026-02-30')).toThrow();
    expect(() => endOfDayInLondon('06/10/2026')).toThrow();
  });
});
