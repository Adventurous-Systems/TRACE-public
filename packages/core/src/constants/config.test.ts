import { describe, expect, it } from 'vitest';
import { formatQuantity, perUnit } from './config.js';

describe('perUnit', () => {
  it('quotes "each" without "per", and other units with it', () => {
    expect(perUnit('each')).toBe('each');
    expect(perUnit('m2')).toBe('per m²');
    expect(perUnit('pack')).toBe('per pack');
  });
  it('says nothing for an unknown or missing unit', () => {
    expect(perUnit(null)).toBe('');
    expect(perUnit(undefined)).toBe('');
  });
});

describe('formatQuantity', () => {
  it('shows counted items as a plain number with thousands separators', () => {
    expect(formatQuantity(5000, 'each')).toBe('5,000');
    expect(formatQuantity(18, null)).toBe('18');
  });
  it('pluralises counted units', () => {
    expect(formatQuantity(1, 'pack')).toBe('1 pack');
    expect(formatQuantity(250, 'pack')).toBe('250 packs');
    expect(formatQuantity(2, 'tonne')).toBe('2 tonnes');
  });
  it('keeps measured units as symbols', () => {
    expect(formatQuantity(120, 'm2')).toBe('120 m²');
    expect(formatQuantity(18, 'm')).toBe('18 linear m');
  });
});
