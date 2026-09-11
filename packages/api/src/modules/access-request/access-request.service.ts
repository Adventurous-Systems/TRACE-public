import { and, desc, eq } from 'drizzle-orm';
import { db, betaAccessRequests, organisations, users } from '@trace/db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type AccessRequestQueryInput,
  type ApproveAccessRequestInput,
  type CreateAccessRequestInput,
  type RejectAccessRequestInput,
  type UpdateAccessRequestOrganisationInput,
  type UpdateApprovedUserAccessInput,
  type UpdatePendingAccessRequestInput,
} from '@trace/core';
import { maybeEnsureOrganisationWallet } from '../../lib/wallet.js';

function slugifyOrganisationName(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 63) || 'organisation'
  );
}

async function resolveOrganisationForApproval(
  input: { organisationId?: string | undefined; organisationName?: string | undefined },
  fallbackName?: string | null,
) {
  if (input.organisationId) {
    const organisation = await db.query.organisations.findFirst({
      where: eq(organisations.id, input.organisationId),
    });

    if (!organisation) {
      throw new NotFoundError('Organisation', input.organisationId);
    }

    await maybeEnsureOrganisationWallet(organisation.id).catch(() => null);
    return organisation;
  }

  const requestedName = input.organisationName?.trim() || fallbackName?.trim();
  if (!requestedName) {
    throw new NotFoundError('Organisation', 'missing organisation name');
  }

  const existingByName = await db.query.organisations.findFirst({
    where: eq(organisations.name, requestedName),
  });

  if (existingByName) {
    await maybeEnsureOrganisationWallet(existingByName.id).catch(() => null);
    return existingByName;
  }

  const baseSlug = slugifyOrganisationName(requestedName);
  let slug = baseSlug;
  let suffix = 2;

  while (true) {
    const existingBySlug = await db.query.organisations.findFirst({
      where: eq(organisations.slug, slug),
    });

    if (!existingBySlug) {
      break;
    }

    slug = `${baseSlug.slice(0, Math.max(1, 63 - String(suffix).length - 1))}-${suffix}`;
    suffix += 1;
  }

  const [createdOrganisation] = await db
    .insert(organisations)
    .values({
      name: requestedName,
      type: 'hub',
      slug,
      verified: false,
      branding: {},
    })
    .returning();

  await maybeEnsureOrganisationWallet(createdOrganisation!.id).catch(() => null);
  return createdOrganisation!;
}

function sanitizeUser(
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    organisationId: string | null;
  } | null,
) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organisationId: user.organisationId,
  };
}

function sanitizeOrganisation(
  organisation: {
    id: string;
    name: string;
    type: string;
    slug: string;
    verified: boolean;
    blockchainAddress?: string | null;
  } | null,
) {
  if (!organisation) return null;
  return {
    id: organisation.id,
    name: organisation.name,
    type: organisation.type,
    slug: organisation.slug,
    verified: organisation.verified,
    blockchainAddress: organisation.blockchainAddress ?? null,
  };
}

function serializeAccessRequestWithRelations(request: {
  id: string;
  userId: string;
  requestedRole: string;
  organisationName: string | null;
  targetOrganisationId: string | null;
  notes: string | null;
  reviewNotes: string | null;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
    organisationId: string | null;
  } | null;
  targetOrganisation?: {
    id: string;
    name: string;
    type: string;
    slug: string;
    verified: boolean;
    blockchainAddress?: string | null;
  } | null;
  reviewer?: {
    id: string;
    email: string;
    name: string;
    role: string;
    organisationId: string | null;
  } | null;
}) {
  return {
    ...request,
    user: sanitizeUser(request.user ?? null),
    reviewer: sanitizeUser(request.reviewer ?? null),
    targetOrganisation: sanitizeOrganisation(request.targetOrganisation ?? null),
  };
}

export async function submitAccessRequest(
  userId: string,
  userRole: string,
  input: CreateAccessRequestInput,
) {
  if (userRole !== 'buyer') {
    throw new ForbiddenError('Only buyer accounts can request elevated access');
  }

  const existingPending = await db.query.betaAccessRequests.findFirst({
    where: and(eq(betaAccessRequests.userId, userId), eq(betaAccessRequests.status, 'pending')),
  });

  if (existingPending) {
    throw new ConflictError('You already have a pending access request');
  }

  const [request] = await db
    .insert(betaAccessRequests)
    .values({
      userId,
      requestedRole: input.requestedRole,
      organisationName: input.organisationName,
      notes: input.notes ?? null,
    })
    .returning();

  return request!;
}

export async function listMyAccessRequests(userId: string) {
  return db.query.betaAccessRequests.findMany({
    where: eq(betaAccessRequests.userId, userId),
    orderBy: [desc(betaAccessRequests.createdAt)],
  });
}

export async function listAccessRequests(query: AccessRequestQueryInput) {
  const where = query.status ? eq(betaAccessRequests.status, query.status) : undefined;

  const requests = await db.query.betaAccessRequests.findMany({
    where,
    with: {
      user: true,
      targetOrganisation: true,
      reviewer: true,
    },
    orderBy: [desc(betaAccessRequests.createdAt)],
  });

  return requests.map(serializeAccessRequestWithRelations);
}

export async function listAccessRequestOrganisations() {
  return db.query.organisations.findMany({
    columns: {
      id: true,
      name: true,
      slug: true,
      type: true,
      verified: true,
      blockchainAddress: true,
    },
    orderBy: [organisations.name],
  });
}

export async function updatePendingAccessRequest(
  requestId: string,
  input: UpdatePendingAccessRequestInput,
) {
  const request = await db.query.betaAccessRequests.findFirst({
    where: eq(betaAccessRequests.id, requestId),
    with: {
      user: true,
      targetOrganisation: true,
      reviewer: true,
    },
  });

  if (!request) {
    throw new NotFoundError('Access request', requestId);
  }

  if (request.status !== 'pending') {
    throw new ConflictError('Only pending access requests can be edited');
  }

  const [updated] = await db
    .update(betaAccessRequests)
    .set({
      requestedRole: input.requestedRole,
      organisationName: input.organisationName,
      notes: input.notes ?? null,
      reviewNotes: input.reviewNotes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(betaAccessRequests.id, requestId))
    .returning();

  const hydrated = await db.query.betaAccessRequests.findFirst({
    where: eq(betaAccessRequests.id, updated!.id),
    with: {
      user: true,
      targetOrganisation: true,
      reviewer: true,
    },
  });

  return hydrated ? serializeAccessRequestWithRelations(hydrated) : null;
}

export async function approveAccessRequest(
  requestId: string,
  reviewerId: string,
  input: ApproveAccessRequestInput,
) {
  const request = await db.query.betaAccessRequests.findFirst({
    where: eq(betaAccessRequests.id, requestId),
  });

  if (!request) {
    throw new NotFoundError('Access request', requestId);
  }

  if (request.status !== 'pending') {
    throw new ConflictError('Only pending access requests can be approved');
  }

  const organisation = await resolveOrganisationForApproval(input, request.organisationName);

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        role: input.role,
        organisationId: organisation.id,
      })
      .where(eq(users.id, request.userId));

    await tx
      .update(betaAccessRequests)
      .set({
        status: 'approved',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        targetOrganisationId: organisation.id,
        reviewNotes: input.reviewNotes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(betaAccessRequests.id, requestId));
  });

  const updated = await db.query.betaAccessRequests.findFirst({
    where: eq(betaAccessRequests.id, requestId),
    with: {
      user: true,
      targetOrganisation: true,
      reviewer: true,
    },
  });
  return updated ? serializeAccessRequestWithRelations(updated) : null;
}

export async function updateApprovedUserAccess(
  requestId: string,
  reviewerId: string,
  input: UpdateApprovedUserAccessInput,
) {
  const request = await db.query.betaAccessRequests.findFirst({
    where: eq(betaAccessRequests.id, requestId),
  });

  if (!request) {
    throw new NotFoundError('Access request', requestId);
  }

  if (request.status !== 'approved') {
    throw new ConflictError('Only approved access requests can be updated');
  }

  const nextOrganisation =
    input.role === 'buyer'
      ? null
      : await resolveOrganisationForApproval(input, request.organisationName);

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        role: input.role,
        organisationId: nextOrganisation?.id ?? null,
      })
      .where(eq(users.id, request.userId));

    await tx
      .update(betaAccessRequests)
      .set({
        targetOrganisationId: nextOrganisation?.id ?? null,
        reviewNotes: input.reviewNotes ?? request.reviewNotes,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(betaAccessRequests.id, requestId));
  });

  const updated = await db.query.betaAccessRequests.findFirst({
    where: eq(betaAccessRequests.id, requestId),
    with: {
      user: true,
      targetOrganisation: true,
      reviewer: true,
    },
  });

  return updated ? serializeAccessRequestWithRelations(updated) : null;
}

export async function updateAccessRequestOrganisation(
  organisationId: string,
  input: UpdateAccessRequestOrganisationInput,
) {
  const organisation = await db.query.organisations.findFirst({
    where: eq(organisations.id, organisationId),
  });

  if (!organisation) {
    throw new NotFoundError('Organisation', organisationId);
  }

  const [updated] = await db
    .update(organisations)
    .set({
      name: input.name,
      verified: input.verified,
      updatedAt: new Date(),
    })
    .where(eq(organisations.id, organisationId))
    .returning();

  return updated!;
}

export async function rejectAccessRequest(
  requestId: string,
  reviewerId: string,
  input: RejectAccessRequestInput,
) {
  const request = await db.query.betaAccessRequests.findFirst({
    where: eq(betaAccessRequests.id, requestId),
  });

  if (!request) {
    throw new NotFoundError('Access request', requestId);
  }

  if (request.status !== 'pending') {
    throw new ConflictError('Only pending access requests can be rejected');
  }

  const [updated] = await db
    .update(betaAccessRequests)
    .set({
      status: 'rejected',
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      reviewNotes: input.reviewNotes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(betaAccessRequests.id, requestId))
    .returning();

  return updated!;
}
