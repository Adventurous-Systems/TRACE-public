import { describe, expect, it } from 'vitest';
import { firstStepWithError, STEP_FIELDS, WizardSchema, type WizardField } from './register-wizard';

const minimal = { productName: 'Reclaimed beam', categoryL1: 'structural-steel' };
const errorsOf = (extra: Record<string, unknown>) => {
  const result = WizardSchema.safeParse({ ...minimal, ...extra });
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe('WizardSchema', () => {
  it('accepts the two required fields alone, with every other field left empty', () => {
    const empty = Object.fromEntries(
      Object.values(STEP_FIELDS)
        .flat()
        .filter((f) => !['productName', 'categoryL1', 'ceMarking', 'dimensionUnit'].includes(f))
        .map((f) => [f, '']),
    );
    expect(errorsOf(empty)).toEqual({});
  });

  it('reads numbers typed into a form, and keeps empty ones as not given', () => {
    const parsed = WizardSchema.parse({ ...minimal, dimensionLength: '2400', gwpTotal: '' });
    expect(parsed.dimensionLength).toBe(2400);
    expect(parsed.gwpTotal).toBeUndefined();
  });

  // The two values that stopped "Register material" silently (owner test,
  // 2026-10-02): each must now come with a message a supplier can act on.
  it('says what is wrong with an EPD reference that is not a web address', () => {
    expect(errorsOf({ epdReference: 'EPD-12345' }).epdReference).toMatch(/full web address/);
    expect(errorsOf({ epdReference: 'https://epd.example/1' })).toEqual({});
  });

  it('says what is wrong with a decimal number of years', () => {
    expect(errorsOf({ remainingLifeEstimate: '12.5' }).remainingLifeEstimate).toMatch(
      /whole years/,
    );
    expect(errorsOf({ remainingLifeEstimate: '12' })).toEqual({});
  });

  it('gives every other rule a message too', () => {
    expect(errorsOf({ countryOfOrigin: 'GBR' }).countryOfOrigin).toMatch(/two-letter/);
    expect(errorsOf({ dimensionWidth: '-1' }).dimensionWidth).toMatch(/greater than 0/);
    expect(errorsOf({ recycledContent: '140' }).recycledContent).toMatch(/0 to 100/);
    expect(errorsOf({ carbonSavingsVsNew: '-3' }).carbonSavingsVsNew).toMatch(/0 or more/);
    expect(errorsOf({ gwpTotal: 'lots' }).gwpTotal).toMatch(/number/);
  });
});

describe('the wizard steps', () => {
  it('place every field of the form on exactly one step', () => {
    const placed = Object.values(STEP_FIELDS).flat();
    const all = Object.keys(WizardSchema.shape) as WizardField[];
    expect([...placed].sort()).toEqual([...all].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it('find the first step with a problem', () => {
    expect(firstStepWithError({})).toBeNull();
    expect(firstStepWithError({ epdReference: { message: 'x' } })).toBe('environmental');
    expect(
      firstStepWithError({
        epdReference: { message: 'x' },
        remainingLifeEstimate: { message: 'y' },
      }),
    ).toBe('circular');
  });
});
