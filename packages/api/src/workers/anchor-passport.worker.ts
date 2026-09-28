/**
 * Blockchain anchoring worker.
 *
 * Flow:
 *   1. Receive { passportId, organisationId } from the anchor-passport BullMQ queue
 *   2. Load the full passport from the DB and recompute its canonical fingerprint
 *   3. Decide register / update / skip (see lib/anchor-decision.ts)
 *   4. Submit MaterialRegistry.registerPassport() or .updatePassportHash()
 *      through the configured ChainAdapter (lib/chain/)
 *   5. Wait for the receipt
 *   6. Write blockchain_tx_hash, blockchain_passport_hash, blockchain_anchored_at
 *      and blockchain_chain_id back to the DB
 *
 * A second, repeatable "anchor-sweep" job queues passports that have a
 * fingerprint but were never submitted (seeded, replenished or created while
 * simulating), so they are anchored without the scripts touching the queue.
 */

import { Worker, type Job } from 'bullmq';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { blockchainTransactions, db, materialPassports, type MaterialPassport } from '@trace/db';
import { createLogger } from '@trace/core';
import { Wallet } from 'ethers';
import { env } from '../env.js';
import {
  createBlockchainTransaction,
  recordAuditEvent,
  updateBlockchainTransaction,
} from '../lib/audit.js';
import {
  anchorQueue,
  anchorSweepQueue,
  redisConnection,
  type AnchorPassportJob,
} from '../lib/queue.js';
import { getChainAdapter } from '../lib/chain/index.js';
import { ensureOrganisationWallet } from '../lib/wallet.js';
import { computePassportHash } from '../lib/passport-hash.js';
import { decideAnchorAction } from '../lib/anchor-decision.js';
import {
  findPassportsMissingIdentifiers,
  issuePassportIdentifiers,
} from '../lib/passport-identifiers.js';

const logger = createLogger('anchor-worker');

const SWEEP_EVERY_MS = 5 * 60 * 1000;
const SWEEP_BATCH_SIZE = 50;

async function ensureHubRole(
  registryAddress: string,
  hubAddress: string,
  organisationId: string,
): Promise<void> {
  const chain = getChainAdapter();
  if (await chain.hasHubRole(registryAddress, hubAddress)) return;

  if (!env.DEPLOYER_PRIVATE_KEY) {
    throw new Error('DEPLOYER_PRIVATE_KEY is required to grant HUB_ROLE to org wallets');
  }

  const deployer = {
    address: new Wallet(env.DEPLOYER_PRIVATE_KEY).address,
    privateKey: env.DEPLOYER_PRIVATE_KEY,
  };
  const blockchainLog = await createBlockchainTransaction({
    action: 'org.grantHubRole',
    resourceType: 'organisation',
    resourceId: organisationId,
    organisationId,
    chainId: await chain.chainId(),
    originAddress: deployer.address,
    contractAddress: registryAddress,
    metadata: { hubAddress },
  });

  try {
    const submitted = await chain.grantHubRole(deployer, { registryAddress, hubAddress });

    if (blockchainLog) {
      await updateBlockchainTransaction(blockchainLog.id, {
        txHash: submitted.txId,
        status: 'submitted',
        gasLimit: submitted.gasLimit,
        gasPayerAddress: submitted.gasPayerAddress,
        submittedAt: new Date(),
        metadata: {
          hubAddress,
          gasPayerSource: submitted.gasPayerSource,
          delegated: submitted.delegated,
          gasEstimate: submitted.gasEstimate,
        },
      });
    }

    const receipt = await chain.waitForReceipt(submitted.txId);
    if (!receipt || receipt.reverted) {
      throw new Error(
        `HUB_ROLE grant transaction ${submitted.txId} failed or was not confirmed in time`,
      );
    }

    if (blockchainLog) {
      await updateBlockchainTransaction(blockchainLog.id, {
        status: 'succeeded',
        gasUsed: receipt.gasUsed,
        gasPayerAddress: receipt.gasPayer ?? submitted.gasPayerAddress,
        vthoPaidWei: receipt.paid,
        blockNumber: receipt.blockNumber,
        blockId: receipt.blockId,
        confirmedAt: new Date(),
      });
    }

    await recordAuditEvent({
      actor: { organisationId },
      action: 'org.grantHubRole',
      resourceType: 'organisation',
      resourceId: organisationId,
      status: 'succeeded',
      metadata: {
        txHash: submitted.txId,
        hubAddress,
        gasUsed: receipt.gasUsed,
        vthoPaidWei: receipt.paid,
      },
    });
  } catch (err) {
    if (blockchainLog) {
      await updateBlockchainTransaction(blockchainLog.id, {
        status: 'failed',
        failureReason: err instanceof Error ? err.message : String(err),
      });
    }
    await recordAuditEvent({
      actor: { organisationId },
      action: 'org.grantHubRole',
      resourceType: 'organisation',
      resourceId: organisationId,
      status: 'failed',
      failureReason: err instanceof Error ? err.message : String(err),
      metadata: { hubAddress },
    });
    throw err;
  }
}

/**
 * The registry already holds this passport's current fingerprint, but the
 * database may not say so — e.g. the passport was edited (which clears the
 * anchor columns) and then edited back. Restore the anchor columns from the
 * transaction that anchored this exact hash.
 */
async function syncAlreadyAnchored(
  passport: MaterialPassport,
  dataHash: string,
  chainId: string,
): Promise<void> {
  if (
    passport.blockchainTxHash &&
    passport.blockchainPassportHash === dataHash &&
    passport.blockchainChainId === chainId
  ) {
    return;
  }
  const anchoringTx = (
    await db.query.blockchainTransactions.findMany({
      where: and(
        eq(blockchainTransactions.resourceType, 'passport'),
        eq(blockchainTransactions.resourceId, passport.id),
        eq(blockchainTransactions.status, 'succeeded'),
      ),
      orderBy: [desc(blockchainTransactions.confirmedAt)],
    })
  ).find((tx) => tx.metadata['certificateHash'] === dataHash);

  await db
    .update(materialPassports)
    .set({
      blockchainTxHash: anchoringTx?.txHash ?? passport.blockchainTxHash,
      blockchainPassportHash: dataHash,
      blockchainAnchoredAt: anchoringTx?.confirmedAt ?? passport.blockchainAnchoredAt ?? new Date(),
      blockchainChainId: chainId,
      updatedAt: new Date(),
    })
    .where(eq(materialPassports.id, passport.id));
}

// ─── Main job processor ───────────────────────────────────────────────────

async function processAnchorJob(job: Job<AnchorPassportJob>): Promise<void> {
  const { passportId } = job.data;
  logger.info({ passportId, attempt: job.attemptsMade }, 'Processing anchor job');

  const passport = await db.query.materialPassports.findFirst({
    where: eq(materialPassports.id, passportId),
  });

  if (!passport) {
    logger.warn({ passportId }, 'Passport not found, skipping');
    return;
  }

  const registryAddress = env.MATERIAL_REGISTRY_ADDRESS;
  if (!registryAddress) {
    throw new Error('MATERIAL_REGISTRY_ADDRESS is not set — cannot anchor passport');
  }

  const chain = getChainAdapter();
  const dataHash = computePassportHash(passport);
  // Decide from the registry, not the database (see lib/anchor-decision.ts).
  const onchain = await chain.getPassportAnchor(registryAddress, passportId);
  const action = decideAnchorAction(onchain, dataHash);
  const chainId = await chain.chainId();

  if (action === 'skip') {
    await syncAlreadyAnchored(passport, dataHash, chainId);
    logger.info({ passportId }, 'Passport already anchored with its current fingerprint');
    return;
  }

  const auditAction = action === 'register' ? 'passport.anchor' : 'passport.reanchor';
  const metadataUri = passport.digitalLinkUri ?? `${env.API_URL}/api/v1/passports/${passportId}`;
  const previousHash = action === 'update' ? onchain.dataHash : null;

  logger.info({ passportId, action, dataHash, chainId }, 'Computed passport hash');

  let orgWallet: { address: string; privateKey: string } | null = null;

  const blockchainLog = await createBlockchainTransaction({
    action: auditAction,
    resourceType: 'passport',
    resourceId: passportId,
    organisationId: passport.organisationId,
    actorId: passport.registeredBy ?? null,
    chainId,
    originAddress: null,
    contractAddress: registryAddress,
    metadata: { certificateHash: dataHash, metadataUri, previousHash },
  });

  try {
    orgWallet = await ensureOrganisationWallet(passport.organisationId);

    let submitted;
    if (action === 'register') {
      await ensureHubRole(registryAddress, orgWallet.address, passport.organisationId);
      submitted = await chain.registerPassport(orgWallet, {
        registryAddress,
        passportId,
        dataHash,
        metadataUri,
      });
    } else {
      // Only the registering wallet (the organisation's) may update its hash.
      submitted = await chain.updatePassportHash(orgWallet, {
        registryAddress,
        passportId,
        dataHash,
      });
    }
    logger.info(
      {
        passportId,
        action,
        txId: submitted.txId,
        originAddress: submitted.originAddress,
        gasPayerAddress: submitted.gasPayerAddress,
        delegated: submitted.delegated,
      },
      'Transaction submitted',
    );

    if (blockchainLog) {
      await updateBlockchainTransaction(blockchainLog.id, {
        txHash: submitted.txId,
        status: 'submitted',
        originAddress: submitted.originAddress,
        gasLimit: submitted.gasLimit,
        gasPayerAddress: submitted.gasPayerAddress,
        submittedAt: new Date(),
        metadata: {
          certificateHash: dataHash,
          metadataUri,
          previousHash,
          gasPayerSource: submitted.gasPayerSource,
          delegated: submitted.delegated,
          gasEstimate: submitted.gasEstimate,
        },
      });
    }

    const receipt = await chain.waitForReceipt(submitted.txId);

    if (!receipt || receipt.reverted) {
      throw new Error(`Transaction ${submitted.txId} failed or was not confirmed in time`);
    }

    await db
      .update(materialPassports)
      .set({
        blockchainTxHash: submitted.txId,
        blockchainPassportHash: dataHash,
        blockchainAnchoredAt: new Date(),
        blockchainChainId: chainId,
        updatedAt: new Date(),
      })
      .where(eq(materialPassports.id, passportId));

    if (blockchainLog) {
      await updateBlockchainTransaction(blockchainLog.id, {
        status: 'succeeded',
        gasUsed: receipt.gasUsed,
        gasPayerAddress: receipt.gasPayer ?? submitted.gasPayerAddress,
        vthoPaidWei: receipt.paid,
        blockNumber: receipt.blockNumber,
        blockId: receipt.blockId,
        confirmedAt: new Date(),
      });
    }

    await recordAuditEvent({
      actor: {
        id: passport.registeredBy ?? null,
        organisationId: passport.organisationId,
      },
      action: auditAction,
      resourceType: 'passport',
      resourceId: passportId,
      status: 'succeeded',
      metadata: {
        txHash: submitted.txId,
        chainId,
        certificateHash: dataHash,
        previousHash,
        originAddress: orgWallet.address,
        gasPayerAddress: receipt.gasPayer ?? submitted.gasPayerAddress,
        gasUsed: receipt.gasUsed,
        vthoPaidWei: receipt.paid,
        blockNumber: receipt.blockNumber,
      },
    });

    logger.info(
      {
        passportId,
        action,
        txId: submitted.txId,
        dataHash,
        gasUsed: receipt.gasUsed,
        vthoPaidWei: receipt.paid,
        gasPayerAddress: receipt.gasPayer ?? submitted.gasPayerAddress,
      },
      'Passport anchored successfully',
    );
  } catch (err) {
    if (blockchainLog) {
      await updateBlockchainTransaction(blockchainLog.id, {
        status: 'failed',
        failureReason: err instanceof Error ? err.message : String(err),
      });
    }
    await recordAuditEvent({
      actor: {
        id: passport.registeredBy ?? null,
        organisationId: passport.organisationId,
      },
      action: auditAction,
      resourceType: 'passport',
      resourceId: passportId,
      status: 'failed',
      failureReason: err instanceof Error ? err.message : String(err),
      metadata: {
        certificateHash: dataHash,
        previousHash,
        originAddress: orgWallet?.address ?? null,
      },
    });
    logger.error({ passportId, err }, 'Failed to anchor passport');
    throw err;
  }
}

// ─── Sweep: anchor passports that were never submitted ──────────────────────

/** Passports with a fingerprint but no chain transaction, oldest first. */
export async function findUnanchoredPassports(limit: number) {
  return db
    .select({
      id: materialPassports.id,
      organisationId: materialPassports.organisationId,
    })
    .from(materialPassports)
    .where(
      and(
        isNotNull(materialPassports.blockchainPassportHash),
        isNull(materialPassports.blockchainTxHash),
      ),
    )
    .orderBy(materialPassports.createdAt)
    .limit(limit);
}

/**
 * Issue the Digital Link + QR image for passports that lack them (seeded rows
 * bypass createPassport). Runs in simulation mode too, and before anchoring so
 * new anchors carry the Digital Link as their metadata URI. One failure does
 * not stop the rest; the next sweep retries it.
 */
export async function backfillPassportIdentifiers(limit: number): Promise<number> {
  let issued = 0;
  for (const { id } of await findPassportsMissingIdentifiers(limit)) {
    try {
      await issuePassportIdentifiers(id);
      issued += 1;
    } catch (err) {
      logger.error({ passportId: id, err }, 'Could not issue passport identifiers');
    }
  }
  if (issued > 0) logger.info({ issued }, 'Issued missing passport Digital Links and QR codes');
  return issued;
}

async function processSweepJob(): Promise<void> {
  await backfillPassportIdentifiers(SWEEP_BATCH_SIZE);
  if (env.DEMO_SIMULATE_ANCHOR) return;

  const pending = await findUnanchoredPassports(SWEEP_BATCH_SIZE);
  for (const passport of pending) {
    // Same jobId as createPassport uses, so a passport already queued (or
    // retrying) is not queued twice. A job that exhausted its retries stays
    // in the failed set under that id and would block the add, so retry it.
    const existing = await anchorQueue.getJob(`anchor-${passport.id}`);
    if (existing && (await existing.isFailed())) {
      await existing.retry();
      continue;
    }
    await anchorQueue.add(
      'default',
      { passportId: passport.id, organisationId: passport.organisationId },
      { jobId: `anchor-${passport.id}` },
    );
  }
  if (pending.length > 0) {
    logger.info({ queued: pending.length }, 'Anchor sweep queued unanchored passports');
  }
}

// ─── Worker bootstrap ─────────────────────────────────────────────────────

export function startAnchorWorker() {
  const worker = new Worker<AnchorPassportJob>('anchor-passport', processAnchorJob, {
    connection: redisConnection,
    concurrency: 3,
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, passportId: job.data.passportId }, 'Anchor job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, passportId: job?.data.passportId, err }, 'Anchor job failed');
  });

  const sweepWorker = new Worker('anchor-sweep', processSweepJob, {
    connection: redisConnection,
    concurrency: 1,
  });
  sweepWorker.on('failed', (_job, err) => {
    logger.error({ err }, 'Anchor sweep failed');
  });
  void anchorSweepQueue
    .upsertJobScheduler('anchor-sweep', { every: SWEEP_EVERY_MS })
    .catch((err: unknown) => logger.error({ err }, 'Could not schedule the anchor sweep'));

  logger.info('Anchor passport worker started');
  return {
    close: async () => {
      await Promise.all([worker.close(), sweepWorker.close()]);
    },
    on: worker.on.bind(worker),
  };
}
