import { describe, expect, it } from 'vitest';
import { LoginSchema, RegisterSchema } from './auth.schema.js';
import {
  CreatePassportSchema,
  PassportQuerySchema,
  UpdatePassportSchema,
} from './passport.schema.js';
import { MATERIAL_CATEGORIES } from '../constants/categories.js';

describe('validation contracts across the Zod security upgrade', () => {
  it('keeps arbitrary passport dictionaries and numeric coercion', () => {
    const input = {
      productName: 'Reclaimed beam',
      categoryL1: MATERIAL_CATEGORIES[0]!.slug,
      technicalSpecs: { strength: 'C24', nested: { verified: true }, optional: null },
      customAttributes: { project: 'reuse', count: 2 },
      gwpTotal: '12.5',
    };
    const parsed = CreatePassportSchema.parse(input);
    expect(parsed.technicalSpecs).toEqual(input.technicalSpecs);
    expect(parsed.customAttributes).toEqual(input.customAttributes);
    expect(parsed.gwpTotal).toBe(12.5);
  });

  it('keeps optional fields absent from an empty partial update', () => {
    expect(UpdatePassportSchema.parse({})).toEqual({});
  });

  it('keeps pagination defaults and rejects out-of-range queries', () => {
    expect(PassportQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(PassportQuerySchema.parse({ page: '2', limit: '50' })).toEqual({ page: 2, limit: 50 });
    expect(PassportQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('keeps signup/login field validation and usable issue paths', () => {
    expect(
      RegisterSchema.safeParse({
        name: 'Buyer',
        email: 'buyer+reuse@example.com',
        password: 'LongEnough123!',
      }).success,
    ).toBe(true);
    const invalid = LoginSchema.safeParse({ email: 'invalid', password: 'short' });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues.map((issue) => issue.path[0])).toEqual(['email', 'password']);
    }
  });
});
