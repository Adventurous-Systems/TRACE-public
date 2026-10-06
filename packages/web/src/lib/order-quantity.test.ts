import { describe, expect, it } from 'vitest';
import { defaultOrderQuantity, orderQuantityProblem } from './order-quantity';

const bricks = { quantityAvailable: 5000, minOrderQuantity: 100 };

describe('defaultOrderQuantity', () => {
  it('starts at the minimum order', () => {
    expect(defaultOrderQuantity(bricks)).toBe(100);
  });
  it('starts at what is left when that is below the minimum', () => {
    expect(defaultOrderQuantity({ quantityAvailable: 40, minOrderQuantity: 100 })).toBe(40);
  });
});

describe('orderQuantityProblem', () => {
  it('accepts anything from the minimum to what is left', () => {
    expect(orderQuantityProblem(100, bricks)).toBeNull();
    expect(orderQuantityProblem(5000, bricks)).toBeNull();
  });
  it('refuses more than is left, and below the minimum', () => {
    expect(orderQuantityProblem(5001, bricks)).toBe('Only 5,000 left.');
    expect(orderQuantityProblem(99, bricks)).toBe('The minimum order is 100.');
  });
  it('allows the whole remainder even when it is below the minimum', () => {
    expect(orderQuantityProblem(40, { quantityAvailable: 40, minOrderQuantity: 100 })).toBeNull();
  });
  it('refuses fractions and zero', () => {
    expect(orderQuantityProblem(0, bricks)).toMatch(/at least 1/);
    expect(orderQuantityProblem(1.5, bricks)).toMatch(/whole number/);
  });
});

describe('a curated lot on the demo keeps its last unit', () => {
  const staircase = { quantityAvailable: 2, minOrderQuantity: 1, orderableQuantity: 1 };

  it('lets one order take all but the last unit', () => {
    expect(orderQuantityProblem(1, staircase)).toBeNull();
    expect(orderQuantityProblem(2, staircase)).toBe(
      'On the demo the last one stays on the marketplace: you can order up to 1.',
    );
  });

  it('starts within what may be ordered, and lets the capped rest go below the minimum', () => {
    const bricks = { quantityAvailable: 100, minOrderQuantity: 100, orderableQuantity: 99 };
    expect(defaultOrderQuantity(bricks)).toBe(99);
    expect(orderQuantityProblem(99, bricks)).toBeNull();
    expect(orderQuantityProblem(50, bricks)).toBe('The minimum order is 100.');
  });

  it('says nothing about it where all that is left may be ordered', () => {
    const lot = { quantityAvailable: 2, minOrderQuantity: 1, orderableQuantity: 2 };
    expect(orderQuantityProblem(3, lot)).toBe('Only 2 left.');
  });
});
