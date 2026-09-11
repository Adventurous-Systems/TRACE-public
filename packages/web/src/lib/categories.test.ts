import { describe, it, expect } from 'vitest';
import { categoryLabel, categoryPath, subcategoryLabel } from './categories';

// J-03: this is the D-08 fix, finished. Verified against real slugs rather
// than invented ones, so a category-data change that breaks this is a real
// signal.
describe('categoryLabel', () => {
  it('resolves a known L1 slug to its label', () => {
    expect(categoryLabel('structural-steel')).toBe('Structural Steel');
  });

  it('resolves L1 and L2 together, joined with a middle dot', () => {
    expect(categoryLabel('structural-steel', 'channels')).toBe('Structural Steel · Channels (PFC)');
  });

  it('falls back to the raw slug for an unknown L1, rather than throwing or hiding it', () => {
    expect(categoryLabel('not-a-real-category')).toBe('not-a-real-category');
  });

  it('falls back to the raw slug for an L2 that does not belong to its L1', () => {
    expect(categoryLabel('structural-steel', 'not-a-real-subcategory')).toBe(
      'Structural Steel · not-a-real-subcategory',
    );
  });

  it('returns an empty string for a missing L1', () => {
    expect(categoryLabel(null)).toBe('');
    expect(categoryLabel(undefined)).toBe('');
  });

  it('omits the separator when there is no L2', () => {
    expect(categoryLabel('structural-steel', null)).toBe('Structural Steel');
    expect(categoryLabel('structural-steel', undefined)).toBe('Structural Steel');
  });
});

describe('categoryPath', () => {
  it('uses the "›" separator instead of "·"', () => {
    expect(categoryPath('structural-steel', 'channels')).toBe('Structural Steel › Channels (PFC)');
  });
});

describe('subcategoryLabel', () => {
  it('resolves the L2 label alone, for callers rendering L1/L2 as separate fields', () => {
    expect(subcategoryLabel('structural-steel', 'channels')).toBe('Channels (PFC)');
  });

  it('falls back to the raw L2 slug when it does not belong to the L1', () => {
    expect(subcategoryLabel('structural-steel', 'not-real')).toBe('not-real');
  });

  it('falls back to the raw L2 slug when L1 is missing', () => {
    expect(subcategoryLabel(null, 'channels')).toBe('channels');
  });
});
