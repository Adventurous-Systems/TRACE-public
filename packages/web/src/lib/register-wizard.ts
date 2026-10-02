/**
 * The rules of the "Register material" wizard: what each field accepts, which
 * step each field is on, and how to find the step a problem is on.
 *
 * They live outside the component so they can be tested, and so that every
 * rule has a message a supplier can act on. Before this, only two fields
 * showed an error; any other invalid value (an EPD reference that is not a
 * web address, a decimal number of years) stopped "Register material" with
 * nothing on screen to say why.
 */
import { z } from 'zod';
import { UNITS_OF_MEASURE } from '@trace/core';

/** An empty field is "not given", not an invalid value. */
const emptyToUndefined = (value: unknown) =>
  value === '' || value === null || value === undefined ? undefined : value;

const optionalNumber = (rule: z.ZodNumber) =>
  z.preprocess((value) => {
    const given = emptyToUndefined(value);
    return given === undefined ? undefined : Number(given);
  }, rule.optional());

const number = () => z.number({ invalid_type_error: 'Enter a number.' });
const dimension = () => optionalNumber(number().positive('Enter a number greater than 0.'));
const carbon = () => optionalNumber(number().nonnegative('Enter 0 or more.'));

export const WizardSchema = z.object({
  // Step 1 — Basic
  productName: z.string().min(1, 'Product name is required').max(255),
  categoryL1: z.string().min(1, 'Category is required'),
  categoryL2: z.string().optional(),
  manufacturerName: z.string().optional(),
  countryOfOrigin: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^[A-Za-z]{2}$/, 'Use the two-letter country code, for example GB.')
      .optional(),
  ),
  serialNumber: z.string().optional(),

  // Step 2 — Specs
  unitOfMeasure: z.enum(UNITS_OF_MEASURE).optional().or(z.literal('')),
  dimensionLength: dimension(),
  dimensionWidth: dimension(),
  dimensionHeight: dimension(),
  dimensionWeight: dimension(),
  dimensionUnit: z.enum(['mm', 'cm', 'm']).default('mm'),

  // Step 3 — Circular
  conditionGrade: z.enum(['A', 'B', 'C', 'D']).optional().or(z.literal('')),
  conditionNotes: z.string().max(2000, 'Keep the notes under 2,000 characters.').optional(),
  deconstructionMethod: z.string().optional(),
  reclaimedBy: z.string().optional(),
  previousBuildingId: z.string().optional(),
  remainingLifeEstimate: optionalNumber(
    number().int('Enter whole years, without a decimal.').nonnegative('Enter 0 or more years.'),
  ),
  handlingRequirements: z.string().optional(),

  // Step 4 — Environmental
  gwpTotal: carbon(),
  embodiedCarbon: carbon(),
  recycledContent: optionalNumber(
    number()
      .min(0, 'Enter a percentage from 0 to 100.')
      .max(100, 'Enter a percentage from 0 to 100.'),
  ),
  carbonSavingsVsNew: carbon(),
  epdReference: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .url('Enter the full web address of the EPD, starting with https://, or leave this empty.')
      .optional(),
  ),
  ceMarking: z.boolean().default(false),
});

export type WizardForm = z.infer<typeof WizardSchema>;
export type WizardField = keyof WizardForm;

/** The steps a supplier fills in, in order, and the fields on each. */
export const STEP_FIELDS = {
  basic: [
    'productName',
    'categoryL1',
    'categoryL2',
    'manufacturerName',
    'countryOfOrigin',
    'serialNumber',
  ],
  specs: [
    'unitOfMeasure',
    'dimensionLength',
    'dimensionWidth',
    'dimensionHeight',
    'dimensionWeight',
    'dimensionUnit',
  ],
  circular: [
    'conditionGrade',
    'conditionNotes',
    'deconstructionMethod',
    'reclaimedBy',
    'previousBuildingId',
    'remainingLifeEstimate',
    'handlingRequirements',
  ],
  environmental: [
    'gwpTotal',
    'embodiedCarbon',
    'recycledContent',
    'carbonSavingsVsNew',
    'epdReference',
    'ceMarking',
  ],
} as const satisfies Record<string, readonly WizardField[]>;

export type InputStep = keyof typeof STEP_FIELDS;

/** The first step that has a field with a problem, or null when none has. */
export function firstStepWithError(
  errors: Partial<Record<WizardField, unknown>>,
): InputStep | null {
  for (const step of Object.keys(STEP_FIELDS) as InputStep[]) {
    if (STEP_FIELDS[step].some((field) => errors[field])) return step;
  }
  return null;
}
