import { describe, expect, it } from 'vitest';
import {
  compositionRows,
  dimensionsLine,
  originLabel,
  reuseLabel,
  specLabel,
  specRows,
} from './passport-details';

describe('dimensionsLine', () => {
  it('joins the sizes with their unit, then the weight', () => {
    expect(dimensionsLine({ length: 215, width: 102.5, height: 65, unit: 'mm', weight: 2.4 })).toBe(
      '215 × 102.5 × 65 mm · 2.4 kg',
    );
  });
  it('says nothing when nothing is recorded', () => {
    expect(dimensionsLine(null)).toBeNull();
    expect(dimensionsLine({ unit: 'mm' })).toBeNull();
  });
});

describe('originLabel', () => {
  it('names the three origins, and nothing else', () => {
    expect(originLabel('reclaimed')).toBe('Reclaimed');
    expect(originLabel('surplus')).toBe('Surplus (unused stock)');
    expect(originLabel('new')).toBe('New circular product');
    expect(originLabel(null)).toBeNull();
    expect(originLabel('bogus')).toBeNull();
  });
});

describe('specRows', () => {
  it('labels the catalogue specs in words, in their recorded order', () => {
    expect(
      specRows({
        compressiveStrength: '30 N/mm²',
        reactionToFire: 'A2-s1,d0',
        certification: 'BBA 25/7367',
      }),
    ).toEqual([
      { label: 'Compressive strength', value: '30 N/mm²' },
      { label: 'Reaction to fire', value: 'A2-s1,d0' },
      { label: 'Certification', value: 'BBA 25/7367' },
    ]);
  });
  it('never shows a grade, which the condition grade owns (an inspection can change it)', () => {
    expect(specRows({ type: 'AAC block', grade: 'B' })).toEqual([
      { label: 'Type', value: 'AAC block' },
    ]);
  });
  it('turns any other key into words, and skips what is empty or not a value', () => {
    expect(specLabel('fire_rating')).toBe('Fire rating');
    expect(specLabel('uValue')).toBe('U value');
    expect(specRows({ empty: '', nested: { a: 1 }, steps: 13 })).toEqual([
      { label: 'Steps', value: '13' },
    ]);
    expect(specRows(null)).toEqual([]);
  });
});

describe('compositionRows', () => {
  it('lists the largest share first, with whether it is recycled', () => {
    expect(
      compositionRows([
        { material: 'Recycled gypsum', percentage: 6, recycled: true },
        { material: 'Recycled aggregate', percentage: 90, recycled: true },
        { material: 'Binder' },
      ]),
    ).toEqual([
      { material: 'Recycled aggregate', share: '90%', recycled: true },
      { material: 'Recycled gypsum', share: '6%', recycled: true },
      { material: 'Binder', share: null, recycled: false },
    ]);
  });
});

describe('reuseLabel', () => {
  it('reads a slug as words', () => {
    expect(reuseLabel('feature-wall')).toBe('Feature wall');
    expect(reuseLabel('Facing brickwork')).toBe('Facing brickwork');
  });
});
