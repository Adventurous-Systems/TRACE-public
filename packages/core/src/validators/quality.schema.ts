import { z } from 'zod';

export const CreateQualityReportSchema = z.object({
  passportId: z.string().uuid(),
  structuralScore: z.number().int().min(1).max(10).optional(),
  aestheticScore: z.number().int().min(1).max(10).optional(),
  environmentalScore: z.number().int().min(1).max(10).optional(),
  // A report is a verdict: one without a grade would stand on the passport
  // as "the latest inspection" and say nothing (owner decision, 2026-10-02).
  overallGrade: z.enum(['A', 'B', 'C', 'D']),
  reportNotes: z.string().max(4000).optional(),
  photoUrls: z.array(z.string().url()).default([]),
});

export type CreateQualityReportInput = z.infer<typeof CreateQualityReportSchema>;

export const QualityQuerySchema = z.object({
  passportId: z.string().uuid().optional(),
  inspectorId: z.string().uuid().optional(),
  grade: z.enum(['A', 'B', 'C', 'D']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type QualityQueryInput = z.infer<typeof QualityQuerySchema>;

// The materials an inspector can choose from when starting a report.
export const InspectionMaterialsQuerySchema = z.object({
  /** Matches the material's name, its serial number, or the start of its ID. */
  q: z.string().trim().max(100).optional(),
  categoryL1: z.string().max(100).optional(),
  /** "true": only materials with no independent inspection yet. */
  uninspected: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export type InspectionMaterialsQuery = z.infer<typeof InspectionMaterialsQuerySchema>;
