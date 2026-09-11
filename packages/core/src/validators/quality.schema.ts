import { z } from 'zod';

export const CreateQualityReportSchema = z.object({
  passportId: z.string().uuid(),
  structuralScore: z.number().int().min(1).max(10).optional(),
  aestheticScore: z.number().int().min(1).max(10).optional(),
  environmentalScore: z.number().int().min(1).max(10).optional(),
  overallGrade: z.enum(['A', 'B', 'C', 'D']).optional(),
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
