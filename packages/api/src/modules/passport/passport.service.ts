import { eq, and, ilike, sql, desc } from 'drizzle-orm';
import {
  blockchainTransactions,
  db,
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
} from '@trace/core';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { ThorClient } from '@vechain/sdk-network';
import { ABIFunction } from '@vechain/sdk-core';
import { anchorQueue } from '../../lib/queue.js';
import { uploadBuffer } from '../../lib/storage.js';
import { computePassportHash } from '../../lib/passport-hash.js';
import { simulatePassportAnchor } from '../../lib/anchor.js';
import { env } from '../../env.js';

// Module-level singleton (avoids reconnecting on every verify call)
const thorClient = ThorClient.at(env.VECHAIN_NODE_URL);

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

  const publicUrl = `${env.WEB_URL}/passport/${passport.id}`;
  let qrCodeUrl: string | undefined;

  if (env.NODE_ENV !== 'test') {
    const qrBuffer = await QRCode.toBuffer(publicUrl, {
      type: 'png',
      width: 400,
      margin: 2,
      errorCorrectionLevel: 'H',
    });
    const qrKey = `passports/${passport.id}/qr.png`;
    qrCodeUrl = await uploadBuffer(env.MINIO_BUCKET_PASSPORTS, qrKey, qrBuffer, 'image/png');
  }

  // Update with QR code URL and mark as active
  const [updated] = await db
    .update(materialPassports)
    .set({
      qrCodeUrl: qrCodeUrl ?? null,
      digitalLinkUri: publicUrl,
      status: 'active',
      updatedAt: new Date(),
    })
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

export async function getPassportById(
  passportId: string,
  requestingOrgId?: string,
): Promise<MaterialPassport> {
  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, passportId),
  });

  if (!passport) throw new NotFoundError(`Passport ${passportId} not found`);

  // Drafts are org-private
  if (passport.status === 'draft' && requestingOrgId !== passport.organisationId) {
    throw new NotFoundError(`Passport ${passportId} not found`);
  }

  return passport;
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

  if (!existing) throw new NotFoundError(`Passport ${passportId} not found`);
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

/**
 * Returns basic passport data plus on-chain verification status.
 * The actual hash comparison is done in the blockchain worker/service,
 * so here we just surface the stored anchor data.
 */
const VERIFY_FUNCTION = new ABIFunction({
  type: 'function',
  name: 'verifyPassport',
  inputs: [
    { name: 'passportId', type: 'bytes32' },
    { name: 'dataHash', type: 'bytes32' },
  ],
  outputs: [
    { name: 'valid', type: 'bool' },
    {
      name: 'record',
      type: 'tuple',
      components: [
        { name: 'dataHash', type: 'bytes32' },
        { name: 'owner', type: 'address' },
        { name: 'status', type: 'uint8' },
        { name: 'registeredAt', type: 'uint64' },
        { name: 'updatedAt', type: 'uint64' },
        { name: 'metadataUri', type: 'string' },
      ],
    },
  ],
  stateMutability: 'view',
});

function uuidToBytes32(uuid: string): string {
  return '0x' + uuid.replace(/-/g, '').padStart(64, '0');
}

export interface PassportIntegrityResult {
  match: boolean;
  recomputedHash: string;
  storedHash: string | null;
}

/**
 * Recompute the passport's canonical fingerprint and compare to the stored one.
 * An honest tamper check (recompute + compare) — not an on-chain assertion.
 */
export async function verifyPassportIntegrity(
  passportId: string,
): Promise<PassportIntegrityResult> {
  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, passportId),
  });
  if (!passport) throw new NotFoundError(`Passport ${passportId} not found`);
  const recomputedHash = computePassportHash(passport);
  const storedHash = passport.blockchainPassportHash;
  return {
    match: storedHash !== null && recomputedHash === storedHash,
    recomputedHash,
    storedHash,
  };
}

export async function verifyPassport(passportId: string): Promise<PassportWithVerification> {
  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, passportId),
  });

  if (!passport) throw new NotFoundError(`Passport ${passportId} not found`);

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
    try {
      const result = await thorClient.contracts.executeCall(
        env.MATERIAL_REGISTRY_ADDRESS,
        VERIFY_FUNCTION,
        [uuidToBytes32(passportId), passport.blockchainPassportHash],
      );
      onchainVerified = result.result?.array?.[0] === true;
    } catch {
      // Node unreachable or contract not deployed — return null, not an error
      onchainVerified = null;
    }
  }

  return { ...passport, verified, onchainVerified };
}

export async function getPassportCertificate(passportId: string): Promise<PassportCertificate> {
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

  if (!passport) throw new NotFoundError(`Passport ${passportId} not found`);

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
  };
}

// ─── History ─────────────────────────────────────────────────────────────────

export async function getPassportHistory(passportId: string): Promise<unknown[]> {
  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, passportId),
  });
  if (!passport) throw new NotFoundError(`Passport ${passportId} not found`);

  return db.query.passportEvents.findMany({
    where: eq(passportEvents.passportId, passportId),
    orderBy: [desc(passportEvents.createdAt)],
  });
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

export async function uploadPassportPhoto(
  passportId: string,
  buffer: Buffer,
  _mimetype: string,
  organisationId: string,
): Promise<MaterialPassport> {
  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, passportId),
  });

  if (!passport) throw new NotFoundError(`Passport ${passportId} not found`);
  if (passport.organisationId !== organisationId) throw new ForbiddenError('Access denied');

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

  const key = `passports/${passportId}/photos/${Date.now()}.jpg`;
  const photoUrl = await uploadBuffer(env.MINIO_BUCKET_PASSPORTS, key, normalised, 'image/jpeg');

  const existing = (passport.conditionPhotos ?? []) as string[];

  const [updated] = await db
    .update(materialPassports)
    .set({
      conditionPhotos: [...existing, photoUrl] as string[],
      updatedAt: new Date(),
    })
    .where(eq(materialPassports.id, passportId))
    .returning();

  if (!updated) throw new Error('Failed to update passport photos');
  return updated;
}
