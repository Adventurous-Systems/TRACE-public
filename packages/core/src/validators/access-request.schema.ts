import { z } from 'zod';

export const AccessRequestRoleSchema = z.enum(['hub_staff', 'hub_admin']);
export const ApprovedAccessRoleSchema = z.enum(['buyer', 'hub_staff', 'hub_admin']);
export const AccessRequestStatusSchema = z.enum(['pending', 'approved', 'rejected']);

export const CreateAccessRequestSchema = z.object({
  requestedRole: AccessRequestRoleSchema,
  organisationName: z.string().min(1).max(255),
  notes: z.string().max(1000).optional(),
});

export type CreateAccessRequestInput = z.infer<typeof CreateAccessRequestSchema>;

export const AccessRequestQuerySchema = z.object({
  status: AccessRequestStatusSchema.optional(),
});

export type AccessRequestQueryInput = z.infer<typeof AccessRequestQuerySchema>;

export const UpdatePendingAccessRequestSchema = z.object({
  requestedRole: AccessRequestRoleSchema,
  organisationName: z.string().min(1).max(255),
  notes: z.string().max(1000).optional(),
  reviewNotes: z.string().max(1000).optional(),
});

export type UpdatePendingAccessRequestInput = z.infer<typeof UpdatePendingAccessRequestSchema>;

export const ApproveAccessRequestSchema = z
  .object({
    role: AccessRequestRoleSchema,
    organisationId: z.string().uuid().optional(),
    organisationName: z.string().min(1).max(255).optional(),
    reviewNotes: z.string().max(1000).optional(),
  })
  .refine(
    (value) => Boolean(value.organisationId || value.organisationName),
    'Either organisationId or organisationName is required',
  );

export type ApproveAccessRequestInput = z.infer<typeof ApproveAccessRequestSchema>;

export const UpdateApprovedUserAccessSchema = z
  .object({
    role: ApprovedAccessRoleSchema,
    organisationId: z.string().uuid().optional(),
    organisationName: z.string().min(1).max(255).optional(),
    reviewNotes: z.string().max(1000).optional(),
  })
  .refine(
    (value) => value.role === 'buyer' || Boolean(value.organisationId || value.organisationName),
    'Elevated users require either organisationId or organisationName',
  );

export type UpdateApprovedUserAccessInput = z.infer<typeof UpdateApprovedUserAccessSchema>;

export const UpdateAccessRequestOrganisationSchema = z.object({
  name: z.string().min(1).max(255),
  verified: z.boolean(),
});

export type UpdateAccessRequestOrganisationInput = z.infer<
  typeof UpdateAccessRequestOrganisationSchema
>;

export const RejectAccessRequestSchema = z.object({
  reviewNotes: z.string().max(1000).optional(),
});

export type RejectAccessRequestInput = z.infer<typeof RejectAccessRequestSchema>;
