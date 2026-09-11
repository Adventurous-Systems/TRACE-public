import { z } from 'zod';
import { USER_ROLES, ORGANISATION_TYPES } from '../constants/config.js';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  name: z.string().min(1).max(255),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

export const JwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(USER_ROLES),
  organisationId: z.string().uuid().optional(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

export type JwtPayloadInput = z.infer<typeof JwtPayloadSchema>;

export const CreateOrganisationSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(ORGANISATION_TYPES),
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  branding: z
    .object({
      logoUrl: z.string().url().optional(),
      primaryColour: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      description: z.string().max(500).optional(),
      website: z.string().url().optional(),
    })
    .optional(),
});

export type CreateOrganisationInput = z.infer<typeof CreateOrganisationSchema>;
