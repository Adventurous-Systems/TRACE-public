import { z } from 'zod';

export const CreateProposalSchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(20).max(10000),
});

export const CastVoteSchema = z.object({
  proposalId: z.string().uuid(),
  support: z.boolean(),
});

export const GovernanceQuerySchema = z.object({
  status: z.enum(['active', 'passed', 'rejected', 'executed', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateProposalInput = z.infer<typeof CreateProposalSchema>;
export type CastVoteInput = z.infer<typeof CastVoteSchema>;
export type GovernanceQueryInput = z.infer<typeof GovernanceQuerySchema>;
