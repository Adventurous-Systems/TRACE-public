import { eq, and, ilike, sql, desc } from 'drizzle-orm';
import {
  blockchainTransactions,
  db,
  listings,
  materialPassports,
  passportEvents,
  type MaterialPassport,
} from '@trace/db';
import {
  type CreatePassportInput,
  type UpdatePassportInput,
  type PassportQueryInput,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
  type JwtPayload,
} from '@trace/core';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { anchorQueue } from '../../lib/queue.js';
import { hasIndependentInspection } from '../quality/quality.service.js';
import { assertDiskHasRoom, assertWithinQuota, storeObject } from '../../lib/storage.js';
import { computePassportHash } from '../../lib/passport-hash.js';
import { simulatePassportAnchor } from '../../lib/anchor.js';
import { getChainAdapter } from '../../lib/chain/index.js';
import { issuePassportIdentifiers } from '../../lib/passport-identifiers.js';
import { env } from '../../env.js';

// Module-level singleton (avoids reconnecting on every verify call)

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PassportWithVerification extends MaterialPassport {
  verified: boolean;
  onchainVerified: boolean | null;
}

export interface PassportCertificate {
  passportId: string;
  status: 'pending' | 'verified' | 'failed' | 'simulated';
  certificateHash: string | null;
  certificateId: string | null;
  txHash: string | null;
  registeredAt: Date | null;
  blockNumber: number | null;
  blockId: string | null;
  hub: {
    name: string;
    address: string | null;
  } | null;
  onchainVerified: boolean | null;
  failureReason: string | null;
  lastAttemptAt: Date | null;
  chainId: string | null;
  networkLabel: string | null;
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createPassport(
  input: CreatePassportInput,
  userId: string,
  organisationId: string,
): Promise<MaterialPassport> {
  // Insert passport record (status = draft, no blockchain hash yet)
  const insertData = buildInsertValues(input);
  if (!insertData.productName || !insertData.categoryL1) {
    throw new Error('productName and categoryL1 are required');
  }
  const [passport] = await db
    .insert(materialPassports)
    .values({
      ...insertData,
      productName: insertData.productName,
      categoryL1: insertData.categoryL1,
      organisationId,
      registeredBy: userId,
      status: 'draft',
    })
    .returning();

  if (!passport) throw new Error('Failed to insert passport');

  // Digital Link + QR image, then mark active.
  await issuePassportIdentifiers(passport.id);
  const [updated] = await db
    .update(materialPassports)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(materialPassports.id, passport.id))
    .returning();

  // Log creation event
  await db.insert(passportEvents).values({
    passportId: passport.id,
    eventType: 'ObjectEvent',
    eventData: {
      action: 'ADD',
      bizStep: 'urn:epcglobal:cbv:bizstep:commissioning',
      disposition: 'urn:epcglobal:cbv:disp:active',
    },
    actorId: userId,
  });

  const activePassport = updated ?? passport;

  // Demo mode: prepare a tamper-evident fingerprint synchronously, no live tx.
  if (env.DEMO_SIMULATE_ANCHOR) {
    return await simulatePassportAnchor(activePassport);
  }

  // Enqueue blockchain anchoring job (non-blocking)
  await anchorQueue.add(
    'default',
    { passportId: passport.id, organisationId },
    {
      jobId: `anchor-${passport.id}`,
    },
  );

  return activePassport;
}

// ─── Read ────────────────────────────────────────────────────────────────────

/** Who is reading a passport: a signed-in user, or nobody (undefined). */
export type PassportViewer = Pick<JwtPayload, 'role' | 'organisationId'> | undefined;

/**
 * What anyone may read of a passport, field by field. Everything about the
 * material is public; who registered it and the platform's own bookkeeping
 * are not. organisationId is public because it is part of the fingerprint
 * document, so anyone can recompute the fingerprint. Every column is listed
 * in one of the two lists (checked below), so a new column needs a decision.
 */
export const PUBLIC_PASSPORT_FIELDS = [
  'id',
  'organisationId',
  'gtin',
  'serialNumber',
  'digitalLinkUri',
  'qrCodeUrl',
  'productName',
  'categoryL1',
  'categoryL2',
  'unitOfMeasure',
  'materialComposition',
  'dimensions',
  'technicalSpecs',
  'manufacturerName',
  'countryOfOrigin',
  'productionDate',
  'gwpTotal',
  'embodiedCarbon',
  'recycledContent',
  'epdReference',
  'ceMarking',
  'declarationOfPerformance',
  'harmonisedStandard',
  'origin',
  'previousBuildingId',
  'deconstructionDate',
  'deconstructionMethod',
  'reclaimedBy',
  'conditionGrade',
  'conditionNotes',
  'conditionPhotos',
  'originalAge',
  'remainingLifeEstimate',
  'carbonSavingsVsNew',
  'circularityScore',
  'reuseCount',
  'reuseSuitability',
  'handlingRequirements',
  'hazardousSubstances',
  'status',
  'blockchainTxHash',
  'blockchainPassportHash',
  'blockchainAnchoredAt',
  'blockchainChainId',
  'createdAt',
] as const satisfies readonly (keyof MaterialPassport)[];
/** Seen only by the organisation that holds the passport, and the platform. */
export const PRIVATE_PASSPORT_FIELDS = [
  'registeredBy',
  'customAttributes',
  'updatedAt',
] as const satisfies readonly (keyof MaterialPassport)[];
type PublicPassportField = (typeof PUBLIC_PASSPORT_FIELDS)[number];
type Unclassified = Exclude<
  keyof MaterialPassport,
  PublicPassportField | (typeof PRIVATE_PASSPORT_FIELDS)[number]
>;
// A compile error here names a column in neither list: decide which it is.
const everyColumnClassified: [Unclassified] extends [never] ? true : Unclassified = true;
void everyColumnClassified;

export type PublicPassport = Pick<MaterialPassport, PublicPassportField>;

export function toPublicPassport(passport: MaterialPassport): PublicPassport {
  return Object.fromEntries(
    PUBLIC_PASSPORT_FIELDS.map((field) => [field, passport[field]]),
  ) as PublicPassport;
}

/** The holding organisation's members and the platform see the whole record. */
export function seesWholePassport(
  passport: Pick<MaterialPassport, 'organisationId'>,
  viewer: PassportViewer,
): boolean {
  return (
    !!viewer &&
    (viewer.role === 'platform_admin' ||
      (!!viewer.organisationId && viewer.organisationId === passport.organisationId))
  );
}

/**
 * The passport, if this viewer may see it at all: a draft is private to its
 * organisation, and is "not found" to anyone else, on every route.
 */
export async function loadVisiblePassport(
  passportId: string,
  viewer: PassportViewer,
): Promise<MaterialPassport> {
  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, passportId),
  });
  if (!passport) throw new NotFoundError('Passport', passportId);
  if (passport.status === 'draft' && viewer?.organisationId !== passport.organisationId) {
    throw new NotFoundError('Passport', passportId);
  }
  return passport;
}

/** Where the passport is on the marketplace: what a visitor needs to find the listing. */
export interface PassportListingSummary {
  id: string;
  status: string;
  pricePence: number;
  currency: string;
  listedAt: Date;
}

const LISTING_PREFERENCE = ['active', 'reserved', 'sold'];

/**
 * The passport's listing a visitor would want: one on sale or fully ordered,
 * else the one it sold through, newest first. A cancelled or expired listing
 * is not shown (there is nothing to go and see).
 */
export async function passportListing(passportId: string): Promise<PassportListingSummary | null> {
  const rows = await db
    .select({
      id: listings.id,
      status: listings.status,
      expiresAt: listings.expiresAt,
      pricePence: listings.pricePence,
      currency: listings.currency,
      createdAt: listings.createdAt,
    })
    .from(listings)
    .where(eq(listings.passportId, passportId))
    .orderBy(desc(listings.createdAt));
  const now = new Date();
  const candidates = rows
    .map((row) => ({
      ...row,
      // A listing past its date reads as expired at once (listingStatusAt).
      status:
        row.status === 'active' && row.expiresAt && row.expiresAt <= now ? 'expired' : row.status,
    }))
    .filter((row) => LISTING_PREFERENCE.includes(row.status))
    .sort((a, b) => LISTING_PREFERENCE.indexOf(a.status) - LISTING_PREFERENCE.indexOf(b.status));
  const chosen = candidates[0];
  if (!chosen) return null;
  return {
    id: chosen.id,
    status: chosen.status,
    pricePence: chosen.pricePence,
    currency: chosen.currency,
    listedAt: chosen.createdAt,
  };
}

/** The whole record for its organisation and the platform; the public fields for anyone else. */
export async function getPassportById(
  passportId: string,
  viewer?: PassportViewer,
): Promise<(MaterialPassport | PublicPassport) & { listing: PassportListingSummary | null }> {
  const passport = await loadVisiblePassport(passportId, viewer);
  return {
    ...(seesWholePassport(passport, viewer) ? passport : toPublicPassport(passport)),
    listing: await passportListing(passportId),
  };
}

/**
 * The counts on an organisation's dashboard, over all of its passports. (The
 * dashboard used to count these from the five most recent ones it had loaded.)
 */
export async function getPassportStats(organisationId: string): Promise<{
  total: number;
  byStatus: Record<string, number>;
  anchored: number;
  awaitingAnchor: number;
}> {
  const rows = await db
    .select({
      status: materialPassports.status,
      count: sql<number>`cast(count(*) as int)`,
      anchored: sql<number>`cast(count(${materialPassports.blockchainTxHash}) as int)`,
      awaiting: sql<number>`cast(count(*) filter (where ${materialPassports.blockchainPassportHash} is null and ${materialPassports.status} <> 'draft') as int)`,
    })
    .from(materialPassports)
    .where(eq(materialPassports.organisationId, organisationId))
    .groupBy(materialPassports.status);
  return {
    total: rows.reduce((sum, row) => sum + row.count, 0),
    byStatus: Object.fromEntries(rows.map((row) => [row.status, row.count])),
    anchored: rows.reduce((sum, row) => sum + row.anchored, 0),
    awaitingAnchor: rows.reduce((sum, row) => sum + row.awaiting, 0),
  };
}

export async function listPassports(
  query: PassportQueryInput,
  organisationId: string,
): Promise<{ data: MaterialPassport[]; total: number; page: number; limit: number }> {
  const conditions = [eq(materialPassports.organisationId, organisationId)];

  if (query.status) {
    conditions.push(eq(materialPassports.status, query.status));
  }
  if (query.categoryL1) {
    conditions.push(eq(materialPassports.categoryL1, query.categoryL1));
  }
  if (query.categoryL2) {
    conditions.push(eq(materialPassports.categoryL2, query.categoryL2));
  }
  if (query.conditionGrade) {
    conditions.push(eq(materialPassports.conditionGrade, query.conditionGrade));
  }
  if (query.search) {
    conditions.push(ilike(materialPassports.productName, `%${query.search}%`));
  }

  const where = and(...conditions);
  const offset = (query.page - 1) * query.limit;

  const [data, countResult] = await Promise.all([
    db.query.materialPassports.findMany({
      where,
      orderBy: [desc(materialPassports.createdAt)],
      limit: query.limit,
      offset,
    }),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(materialPassports)
      .where(where),
  ]);

  return {
    data,
    total: countResult[0]?.count ?? 0,
    page: query.page,
    limit: query.limit,
  };
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updatePassport(
  passportId: string,
  input: UpdatePassportInput,
  userId: string,
  organisationId: string,
): Promise<MaterialPassport> {
  const existing = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, passportId),
  });

  if (!existing) throw new NotFoundError('Passport', passportId);
  if (existing.organisationId !== organisationId) {
    throw new ForbiddenError('You do not have permission to update this passport');
  }

  // Editable only while draft/active. Once a passport is listed, reserved, sold, or
  // decommissioned its published record is final — amendments are locked so the traded
  // record stays trustworthy. (Edits before this point are append-only amendments that
  // recompute the tamper-evident fingerprint; see the passport_events history.)
  if (['listed', 'reserved', 'sold', 'decommissioned'].includes(existing.status)) {
    throw new ConflictError(
      `This material can no longer be edited because it is ${existing.status}. Editing is locked once a material is listed or sold.`,
    );
  }

  // An inspector's grade is not the seller's to change (owner decision,
  // 2026-10-02). Everything else on the passport stays editable.
  if (
    input.conditionGrade !== undefined &&
    input.conditionGrade !== existing.conditionGrade &&
    (await hasIndependentInspection(passportId))
  ) {
    throw new ConflictError(
      'An independent inspection set the grade of this material, so only another inspection can change it.',
    );
  }

  // Build update set from only the fields present in the request. D-04:
  // updatePassport used to reuse buildInsertValues (written for creates,
  // where every absent field defaults to null/[]/{}), so a one-field PATCH
  // silently wiped every other column — hazardous-substance declarations
  // included, with the fingerprint recomputed over the now-empty record and
  // still reporting "Untampered". buildUpdateValues never defaults an absent
  // field; it is only ever present in updateSet if the caller sent it.
  const updateSet: Record<string, unknown> = {
    ...buildUpdateValues(input),
    updatedAt: new Date(),
    blockchainPassportHash: null,
    blockchainTxHash: null,
    blockchainAnchoredAt: null,
  };

  const [updated] = await db
    .update(materialPassports)
    .set(updateSet)
    .where(eq(materialPassports.id, passportId))
    .returning();

  if (!updated) throw new Error('Update failed');

  // Log amendment event — append-only history. Record the recomputed fingerprint so
  // each version is fully auditable off-chain (mirrors the on-chain PassportHashUpdated
  // event once anchoring is live).
  const amendedHash = computePassportHash(updated);
  await db.insert(passportEvents).values({
    passportId,
    eventType: 'ObjectEvent',
    eventData: {
      action: 'OBSERVE',
      bizStep: 'urn:epcglobal:cbv:bizstep:inspecting',
      disposition: 'urn:epcglobal:cbv:disp:active',
      amendment: true,
      fingerprint: amendedHash,
    },
    actorId: userId,
  });

  // Demo mode: re-prepare the fingerprint synchronously instead of re-anchoring.
  if (env.DEMO_SIMULATE_ANCHOR) {
    return await simulatePassportAnchor(updated);
  }

  // Re-queue blockchain anchor
  await anchorQueue.add(
    'default',
    { passportId, organisationId },
    {
      jobId: `anchor-${passportId}-${Date.now()}`,
    },
  );

  return updated;
}

// ─── Verify ───────────────────────────────────────────────────────────────────

export interface PassportIntegrityResult {
  match: boolean;
  /**
   * True when no fingerprint is recorded yet, because the passport is new or
   * a change is waiting to be (re-)anchored. Nothing to compare against, so
   * the result is "pending", never a mismatch.
   */
  pending: boolean;
  recomputedHash: string;
  storedHash: string | null;
}

/**
 * Recompute the passport's canonical fingerprint and compare to the stored one.
 * An honest tamper check (recompute + compare) — not an on-chain assertion.
 */
export async function verifyPassportIntegrity(
  passportId: string,
  viewer?: PassportViewer,
): Promise<PassportIntegrityResult> {
  const passport = await loadVisiblePassport(passportId, viewer);
  const recomputedHash = computePassportHash(passport);
  const storedHash = passport.blockchainPassportHash;
  return {
    match: storedHash !== null && recomputedHash === storedHash,
    pending: storedHash === null,
    recomputedHash,
    storedHash,
  };
}

/**
 * Returns basic passport data plus on-chain verification status.
 * The actual hash comparison is done in the blockchain worker/service,
 * so here we just surface the stored anchor data.
 */
export async function verifyPassport(passportId: string): Promise<PassportWithVerification> {
  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, passportId),
  });

  if (!passport) throw new NotFoundError('Passport', passportId);

  const verified = passport.blockchainTxHash !== null && passport.blockchainAnchoredAt !== null;

  // Attempt on-chain verification only when we actually submitted a
  // transaction for this passport. D-27: a simulated record (anchoredAt set,
  // txHash null) was never submitted to any chain, so there is no on-chain
  // record for it to match. Querying anyway returned `false` — "does not
  // match" — and that became a false tamper accusation in the certificate's
  // failureReason. No txHash means unknown (null), never mismatch (false).
  let onchainVerified: boolean | null = null;
  if (
    env.MATERIAL_REGISTRY_ADDRESS &&
    passport.blockchainPassportHash &&
    passport.blockchainTxHash
  ) {
    // Node unreachable or contract not deployed → null (unknown), not an error.
    onchainVerified = await getChainAdapter().verifyPassport(
      env.MATERIAL_REGISTRY_ADDRESS,
      passportId,
      passport.blockchainPassportHash,
    );
  }

  return { ...passport, verified, onchainVerified };
}

/**
 * What the public passport page reads: the passport as this viewer may see
 * it, its verification status, and its listing.
 */
export async function getPassportVerification(
  passportId: string,
  viewer?: PassportViewer,
): Promise<
  (MaterialPassport | PublicPassport) & {
    verified: boolean;
    onchainVerified: boolean | null;
    listing: PassportListingSummary | null;
  }
> {
  const visible = await loadVisiblePassport(passportId, viewer);
  const { verified, onchainVerified, ...passport } = await verifyPassport(passportId);
  return {
    ...(seesWholePassport(visible, viewer) ? passport : toPublicPassport(passport)),
    verified,
    onchainVerified,
    listing: await passportListing(passportId),
  };
}

export async function getPassportCertificate(
  passportId: string,
  viewer?: PassportViewer,
): Promise<PassportCertificate> {
  await loadVisiblePassport(passportId, viewer);
  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, passportId),
    with: {
      organisation: {
        columns: {
          name: true,
          blockchainAddress: true,
        },
      },
    },
  });

  if (!passport) throw new NotFoundError('Passport', passportId);

  const latestChainTx = await db.query.blockchainTransactions.findFirst({
    where: and(
      eq(blockchainTransactions.resourceType, 'passport'),
      eq(blockchainTransactions.resourceId, passportId),
    ),
    orderBy: [desc(blockchainTransactions.createdAt)],
  });

  const verifiedPassport = await verifyPassport(passportId);
  const anchored =
    passport.blockchainTxHash !== null &&
    passport.blockchainAnchoredAt !== null &&
    verifiedPassport.onchainVerified !== false;

  // Demo simulation: a real fingerprint was prepared but no tx was submitted.
  const simulated =
    passport.blockchainTxHash === null &&
    passport.blockchainAnchoredAt !== null &&
    passport.blockchainPassportHash !== null;

  const status: PassportCertificate['status'] = anchored
    ? 'verified'
    : simulated
      ? 'simulated'
      : latestChainTx?.status === 'failed' || verifiedPassport.onchainVerified === false
        ? 'failed'
        : 'pending';

  return {
    passportId,
    status,
    certificateHash: passport.blockchainPassportHash,
    certificateId: passport.blockchainTxHash,
    txHash: passport.blockchainTxHash,
    registeredAt: passport.blockchainAnchoredAt,
    blockNumber: latestChainTx?.blockNumber ?? null,
    blockId: latestChainTx?.blockId ?? null,
    hub: passport.organisation
      ? {
          name: passport.organisation.name,
          address: passport.organisation.blockchainAddress,
        }
      : null,
    onchainVerified: verifiedPassport.onchainVerified,
    // D-27: a simulated record has no on-chain counterpart, so it can carry no
    // on-chain failure. Suppressed explicitly rather than relying on there
    // being no blockchain_transactions row — a passport that was really
    // anchored, then edited (which clears the anchor columns) and re-anchored
    // in simulation would still have the old row, and would otherwise leak its
    // stale failureReason into a certificate that is now purely simulated.
    failureReason: simulated
      ? null
      : verifiedPassport.onchainVerified === false
        ? 'Certificate hash does not match the on-chain record'
        : (latestChainTx?.failureReason ?? null),
    lastAttemptAt: latestChainTx?.updatedAt ?? latestChainTx?.createdAt ?? null,
    // Which chain the anchor is on, and its human-readable name — only for a
    // real on-chain anchor, so a simulated record never names a network.
    chainId: status === 'verified' ? passport.blockchainChainId : null,
    networkLabel:
      status === 'verified' && passport.blockchainChainId
        ? (env.CHAIN_NETWORK_LABEL ?? null)
        : null,
  };
}

// ─── History ─────────────────────────────────────────────────────────────────

/** The steps of an event the public may read; not who acted, who bought, or for how much. */
const PUBLIC_EVENT_DATA = [
  'action',
  'bizStep',
  'disposition',
  'amendment',
  'fingerprint',
  'quantity',
];

export interface PublicPassportEvent {
  id: string;
  eventType: string;
  eventData: Record<string, unknown>;
  blockchainTxHash: string | null;
  createdAt: Date;
}

export function toPublicEvent(event: typeof passportEvents.$inferSelect): PublicPassportEvent {
  return {
    id: event.id,
    eventType: event.eventType,
    eventData: Object.fromEntries(
      Object.entries(event.eventData ?? {}).filter(([key]) => PUBLIC_EVENT_DATA.includes(key)),
    ),
    blockchainTxHash: event.blockchainTxHash,
    createdAt: event.createdAt,
  };
}

/**
 * The passport's EPCIS events, newest first. Its organisation and the
 * platform read them whole; anyone else reads what happened and when, not
 * who did it, who bought, or the amount (a sale's event names its buyer).
 */
export async function getPassportHistory(
  passportId: string,
  viewer?: PassportViewer,
): Promise<Array<typeof passportEvents.$inferSelect | PublicPassportEvent>> {
  const passport = await loadVisiblePassport(passportId, viewer);
  const events = await db.query.passportEvents.findMany({
    where: eq(passportEvents.passportId, passportId),
    orderBy: [desc(passportEvents.createdAt)],
  });
  return seesWholePassport(passport, viewer) ? events : events.map(toPublicEvent);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InsertRow = Record<string, any>;

// Create-only. Narrowed to CreatePassportInput (D-04) so this can never be
// called with update input again — that mistake is exactly what caused a
// one-field PATCH to wipe every other column. Updates go through
// buildUpdateValues, below.
function buildInsertValues(input: CreatePassportInput): InsertRow {
  return {
    productName: input.productName,
    categoryL1: input.categoryL1,
    categoryL2: input.categoryL2 ?? null,
    unitOfMeasure: input.unitOfMeasure ?? null,
    serialNumber: input.serialNumber ?? null,
    // Cast JSONB arrays/objects to bypass exactOptionalPropertyTypes friction
    materialComposition: (input.materialComposition ?? []) as unknown,
    dimensions: (input.dimensions ?? null) as unknown,
    technicalSpecs: (input.technicalSpecs ?? {}) as unknown,
    manufacturerName: input.manufacturerName ?? null,
    countryOfOrigin: input.countryOfOrigin ?? null,
    productionDate: input.productionDate ?? null,
    gwpTotal: input.gwpTotal !== undefined ? String(input.gwpTotal) : null,
    embodiedCarbon: input.embodiedCarbon !== undefined ? String(input.embodiedCarbon) : null,
    recycledContent: input.recycledContent !== undefined ? String(input.recycledContent) : null,
    epdReference: input.epdReference ?? null,
    ceMarking: input.ceMarking ?? false,
    declarationOfPerformance: input.declarationOfPerformance ?? null,
    harmonisedStandard: input.harmonisedStandard ?? null,
    origin: input.origin ?? null,
    previousBuildingId: input.previousBuildingId ?? null,
    deconstructionDate: input.deconstructionDate ?? null,
    deconstructionMethod: input.deconstructionMethod ?? null,
    reclaimedBy: input.reclaimedBy ?? null,
    conditionGrade: input.conditionGrade ?? null,
    conditionNotes: input.conditionNotes ?? null,
    originalAge: input.originalAge ?? null,
    remainingLifeEstimate: input.remainingLifeEstimate ?? null,
    carbonSavingsVsNew:
      input.carbonSavingsVsNew !== undefined ? String(input.carbonSavingsVsNew) : null,
    circularityScore: input.circularityScore ?? null,
    reuseSuitability: (input.reuseSuitability ?? []) as unknown,
    handlingRequirements: input.handlingRequirements ?? null,
    hazardousSubstances: (input.hazardousSubstances ?? []) as unknown,
    customAttributes: (input.customAttributes ?? {}) as unknown,
  };
}

/**
 * The update counterpart to buildInsertValues, above. A create needs every
 * field defaulted (a fresh row has no prior value to preserve); an update
 * does not — a field absent from the request body must be left untouched,
 * not overwritten with null/[]/{}. See D-04.
 *
 * UpdatePassportSchema fields are all `.optional()` and not `.nullable()`,
 * so "present" and "not undefined" are the same test here — there is
 * currently no schema-level way to explicitly clear a field via PATCH
 * (sending `null` fails validation before this function ever runs). Adding
 * that is a separate, smaller product decision, not part of this fix.
 */
function buildUpdateValues(input: UpdatePassportInput): InsertRow {
  const set: InsertRow = {};
  if (input.productName !== undefined) set['productName'] = input.productName;
  if (input.categoryL1 !== undefined) set['categoryL1'] = input.categoryL1;
  if (input.categoryL2 !== undefined) set['categoryL2'] = input.categoryL2;
  if (input.unitOfMeasure !== undefined) set['unitOfMeasure'] = input.unitOfMeasure;
  if (input.serialNumber !== undefined) set['serialNumber'] = input.serialNumber;
  if (input.materialComposition !== undefined)
    set['materialComposition'] = input.materialComposition as unknown;
  if (input.dimensions !== undefined) set['dimensions'] = input.dimensions as unknown;
  if (input.technicalSpecs !== undefined) set['technicalSpecs'] = input.technicalSpecs as unknown;
  if (input.manufacturerName !== undefined) set['manufacturerName'] = input.manufacturerName;
  if (input.countryOfOrigin !== undefined) set['countryOfOrigin'] = input.countryOfOrigin;
  if (input.productionDate !== undefined) set['productionDate'] = input.productionDate;
  if (input.gwpTotal !== undefined) set['gwpTotal'] = String(input.gwpTotal);
  if (input.embodiedCarbon !== undefined) set['embodiedCarbon'] = String(input.embodiedCarbon);
  if (input.recycledContent !== undefined) set['recycledContent'] = String(input.recycledContent);
  if (input.epdReference !== undefined) set['epdReference'] = input.epdReference;
  if (input.ceMarking !== undefined) set['ceMarking'] = input.ceMarking;
  if (input.declarationOfPerformance !== undefined)
    set['declarationOfPerformance'] = input.declarationOfPerformance;
  if (input.harmonisedStandard !== undefined) set['harmonisedStandard'] = input.harmonisedStandard;
  if (input.origin !== undefined) set['origin'] = input.origin;
  if (input.previousBuildingId !== undefined) set['previousBuildingId'] = input.previousBuildingId;
  if (input.deconstructionDate !== undefined) set['deconstructionDate'] = input.deconstructionDate;
  if (input.deconstructionMethod !== undefined)
    set['deconstructionMethod'] = input.deconstructionMethod;
  if (input.reclaimedBy !== undefined) set['reclaimedBy'] = input.reclaimedBy;
  if (input.conditionGrade !== undefined) set['conditionGrade'] = input.conditionGrade;
  if (input.conditionNotes !== undefined) set['conditionNotes'] = input.conditionNotes;
  if (input.originalAge !== undefined) set['originalAge'] = input.originalAge;
  if (input.remainingLifeEstimate !== undefined)
    set['remainingLifeEstimate'] = input.remainingLifeEstimate;
  if (input.carbonSavingsVsNew !== undefined)
    set['carbonSavingsVsNew'] = String(input.carbonSavingsVsNew);
  if (input.circularityScore !== undefined) set['circularityScore'] = input.circularityScore;
  if (input.reuseSuitability !== undefined)
    set['reuseSuitability'] = input.reuseSuitability as unknown;
  if (input.handlingRequirements !== undefined)
    set['handlingRequirements'] = input.handlingRequirements;
  if (input.hazardousSubstances !== undefined)
    set['hazardousSubstances'] = input.hazardousSubstances as unknown;
  if (input.customAttributes !== undefined)
    set['customAttributes'] = input.customAttributes as unknown;
  return set;
}

// ─── Upload photo ─────────────────────────────────────────────────────────────

function assertRoomForPhoto(passport: { conditionPhotos: unknown }): void {
  const count = ((passport.conditionPhotos ?? []) as string[]).length;
  if (count >= env.PASSPORT_PHOTOS_MAX) {
    throw new ConflictError(`A passport can have at most ${env.PASSPORT_PHOTOS_MAX} photos`);
  }
}

export async function uploadPassportPhoto(
  passportId: string,
  buffer: Buffer,
  _mimetype: string,
  organisationId: string,
): Promise<MaterialPassport> {
  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, passportId),
  });

  if (!passport) throw new NotFoundError('Passport', passportId);
  if (passport.organisationId !== organisationId) throw new ForbiddenError('Access denied');
  assertRoomForPhoto(passport);
  await assertDiskHasRoom();

  // Normalise to JPEG: sharp decodes HEIC/HEIF + other formats, applies EXIF
  // orientation, and downscales large camera photos — so any phone/laptop image
  // ends up browser-displayable and a modest size.
  let normalised: Buffer;
  try {
    normalised = await sharp(buffer)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    throw new ValidationError(
      'Could not process the image — please upload a valid JPEG, PNG, WebP, or HEIC photo',
    );
  }

  const key = `passports/${passportId}/photos/${Date.now()}-${randomUUID().slice(0, 8)}.jpg`;

  // One transaction per organisation at a time (assertWithinQuota locks), so
  // neither the quota nor the photo count can be overrun by uploads in parallel.
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ conditionPhotos: materialPassports.conditionPhotos })
      .from(materialPassports)
      .where(eq(materialPassports.id, passportId))
      .for('update');
    if (!current) throw new NotFoundError('Passport', passportId);
    assertRoomForPhoto(current);
    await assertWithinQuota(tx, organisationId, normalised.length);

    const photoUrl = await storeObject(
      {
        key,
        buffer: normalised,
        contentType: 'image/jpeg',
        kind: 'photo',
        organisationId,
        passportId,
      },
      tx,
    );
    const existing = (current.conditionPhotos ?? []) as string[];
    const [row] = await tx
      .update(materialPassports)
      .set({ conditionPhotos: [...existing, photoUrl] as string[], updatedAt: new Date() })
      .where(eq(materialPassports.id, passportId))
      .returning();
    return row;
  });

  if (!updated) throw new Error('Failed to update passport photos');
  return updated;
}
