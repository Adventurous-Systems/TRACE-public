import { z } from 'zod';
import { MATERIAL_CATEGORIES } from '../constants/categories.js';
import {
  PASSPORT_STATUSES,
  CONDITION_GRADES,
  DECONSTRUCTION_METHODS,
  UNITS_OF_MEASURE,
} from '../constants/config.js';

const l1Slugs = MATERIAL_CATEGORIES.map((c) => c.slug) as [string, ...string[]];

const DimensionsSchema = z.object({
  length: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  weight: z.number().positive().optional(),
  unit: z.enum(['mm', 'cm', 'm']).default('mm'),
  weightUnit: z.enum(['kg', 'tonne']).optional(),
});

const MaterialComponentSchema = z.object({
  material: z.string().min(1),
  percentage: z.number().min(0).max(100).optional(),
  recycled: z.boolean().optional(),
});

const HazardousSubstanceSchema = z.object({
  name: z.string().min(1),
  casNumber: z.string().optional(),
  concentration: z.string().optional(),
  hazardClass: z.string().optional(),
});

export const CreatePassportSchema = z.object({
  // Product — required
  productName: z.string().min(1).max(255),
  categoryL1: z.enum(l1Slugs),
  categoryL2: z.string().optional(),

  // Product — optional
  unitOfMeasure: z.enum(UNITS_OF_MEASURE).optional(), // basis for quantity / price / carbon
  materialComposition: z.array(MaterialComponentSchema).optional(),
  dimensions: DimensionsSchema.optional(),
  technicalSpecs: z.record(z.unknown()).optional(),

  // Manufacturer
  manufacturerName: z.string().max(255).optional(),
  countryOfOrigin: z.string().length(2).toUpperCase().optional(), // ISO 3166-1 alpha-2
  productionDate: z.coerce.date().optional(),

  // Environmental
  gwpTotal: z.coerce.number().nonnegative().optional(),
  embodiedCarbon: z.coerce.number().nonnegative().optional(),
  recycledContent: z.coerce.number().min(0).max(100).optional(),
  epdReference: z.string().url().optional(),

  // Compliance
  ceMarking: z.boolean().optional(),
  declarationOfPerformance: z.string().url().optional(),
  harmonisedStandard: z.string().optional(),

  // Circular extension
  previousBuildingId: z.string().optional(),
  deconstructionDate: z.coerce.date().optional(),
  deconstructionMethod: z.enum(DECONSTRUCTION_METHODS).optional(),
  reclaimedBy: z.string().optional(),
  conditionGrade: z.enum(CONDITION_GRADES).optional(),
  conditionNotes: z.string().max(2000).optional(),
  originalAge: z.number().int().nonnegative().optional(),
  remainingLifeEstimate: z.number().int().nonnegative().optional(),
  carbonSavingsVsNew: z.number().nonnegative().optional(),
  circularityScore: z.number().int().min(0).max(100).optional(),
  reuseSuitability: z.array(z.string()).optional(),
  handlingRequirements: z.string().optional(),
  hazardousSubstances: z.array(HazardousSubstanceSchema).optional(),

  // Flexible
  customAttributes: z.record(z.unknown()).optional(),
});

export type CreatePassportInput = z.infer<typeof CreatePassportSchema>;

export const UpdatePassportSchema = CreatePassportSchema.partial();

export type UpdatePassportInput = z.infer<typeof UpdatePassportSchema>;

export const PassportStatusSchema = z.enum(PASSPORT_STATUSES);

export const PassportQuerySchema = z.object({
  status: PassportStatusSchema.optional(),
  categoryL1: z.string().optional(),
  categoryL2: z.string().optional(),
  conditionGrade: z.enum(CONDITION_GRADES).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PassportQueryInput = z.infer<typeof PassportQuerySchema>;
