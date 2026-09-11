/**
 * Blockchain anchoring worker.
 *
 * Flow:
 *   1. Receive { passportId, organisationId } from the anchor-passport BullMQ queue
 *   2. Load the full passport from the DB
 *   3. Serialise to canonical JSON-LD (keys sorted for reproducible hash)
 *   4. Compute keccak256 hash
 *   5. Submit to MaterialRegistry.registerPassport() on VeChainThor
 *   6. Poll for tx confirmation
 *   7. Write blockchain_tx_hash, blockchain_passport_hash, blockchain_anchored_at back to DB
 */

import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, materialPassports } from '@trace/db';
import { createLogger } from '@trace/core';
import { ThorClient } from '@vechain/sdk-network';
import { ABIFunction } from '@vechain/sdk-core';
import { keccak256, Interface, toUtf8Bytes, Wallet } from 'ethers';
import { env } from '../env.js';
import {
  createBlockchainTransaction,
  recordAuditEvent,
  updateBlockchainTransaction,
} from '../lib/audit.js';
import { redisConnection, type AnchorPassportJob } from '../lib/queue.js';
import { submitVeChainTransaction } from '../lib/vechain-transactions.js';
import { ensureOrganisationWallet } from '../lib/wallet.js';
import { buildCanonicalJsonLd } from '../lib/passport-hash.js';

const logger = createLogger('anchor-worker');

// ─── VeChain setup ─────────────────────────────────────────────────────────

// Module-level singleton — one ThorClient per worker process
const thorClient = ThorClient.at(env.VECHAIN_NODE_URL);

// Minimal ABI for MaterialRegistry
const REGISTRY_ABI = [
  'function registerPassport(bytes32 passportId, bytes32 dataHash, string calldata metadataUri) external',
  'function grantHubRole(address hub) external',
];

const HUB_ROLE = keccak256(toUtf8Bytes('HUB_ROLE'));
const HAS_ROLE_FUNCTION = new ABIFunction({
  type: 'function',
  name: 'hasRole',
  inputs: [
    { name: 'role', type: 'bytes32' },
    { name: 'account', type: 'address' },
  ],
  outputs: [{ name: '', type: 'bool' }],
  stateMutability: 'view',
});

// ─── UUID → bytes32 ───────────────────────────────────────────────────────

function uuidToBytes32(uuid: string): string {
  const hex = uuid.replace(/-/g, '');
  return '0x' + hex.padStart(64, '0');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReceipt(txId: string) {
  let receipt = null;
  for (let i = 0; i < 12; i++) {
    try {
      receipt = await thorClient.transactions.getTransactionReceipt(txId);
      if (receipt) break;
    } catch {
      // not yet confirmed
    }
    await sleep(5000);
  }
  return receipt;
}

async function ensureHubRole(hubAddress: string, organisationId: string): Promise<void> {
  if (!env.MATERIAL_REGISTRY_ADDRESS) {
    throw new Error('MATERIAL_REGISTRY_ADDRESS is not set — cannot grant HUB_ROLE');
  }

  const hasRoleResult = await thorClient.contracts.executeCall(
    env.MATERIAL_REGISTRY_ADDRESS,
    HAS_ROLE_FUNCTION,
    [HUB_ROLE, hubAddress],
  );
  const alreadyHub = hasRoleResult.result?.array?.[0] === true;
  if (alreadyHub) return;

  if (!env.DEPLOYER_PRIVATE_KEY) {
    throw new Error('DEPLOYER_PRIVATE_KEY is required to grant HUB_ROLE to org wallets');
  }

  const deployerAddress = new Wallet(env.DEPLOYER_PRIVATE_KEY).address;
  const iface = new Interface(REGISTRY_ABI);
  const callData = iface.encodeFunctionData('grantHubRole', [hubAddress]);
  const blockchainLog = await createBlockchainTransaction({
    action: 'org.grantHubRole',
    resourceType: 'organisation',
    resourceId: organisationId,
    organisationId,
    originAddress: deployerAddress,
    contractAddress: env.MATERIAL_REGISTRY_ADDRESS,
    metadata: { hubAddress },
  });

  try {
    const submitted = await submitVeChainTransaction({
      thorClient,
      originPrivateKey: env.DEPLOYER_PRIVATE_KEY,
      originAddress: deployerAddress,
      clauses: [{ to: env.MATERIAL_REGISTRY_ADDRESS, value: '0x0', data: callData }],
      fallbackGas: 200_000,
    });

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

    const receipt = await waitForReceipt(submitted.txId);
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
        blockNumber: receipt.meta.blockNumber,
        blockId: receipt.meta.blockID,
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

  if (passport.blockchainTxHash && passport.blockchainAnchoredAt) {
    logger.info({ passportId }, 'Passport already anchored, skipping');
    return;
  }

  if (!env.MATERIAL_REGISTRY_ADDRESS) {
    throw new Error('MATERIAL_REGISTRY_ADDRESS is not set — cannot anchor passport');
  }

  // Compute hash
  const jsonLd = buildCanonicalJsonLd(passport);
  const dataHashBytes = keccak256(Buffer.from(jsonLd, 'utf-8'));
  const passportIdBytes32 = uuidToBytes32(passportId);
  const metadataUri = passport.digitalLinkUri ?? `${env.API_URL}/api/v1/passports/${passportId}`;

  logger.info({ passportId, dataHashBytes }, 'Computed passport hash');

  // Encode call data
  const iface = new Interface(REGISTRY_ABI);
  const callData = iface.encodeFunctionData('registerPassport', [
    passportIdBytes32,
    dataHashBytes,
    metadataUri,
  ]);

  let orgWallet: { address: string; privateKey: string } | null = null;

  const blockchainLog = await createBlockchainTransaction({
    action: 'passport.anchor',
    resourceType: 'passport',
    resourceId: passportId,
    organisationId: passport.organisationId,
    actorId: passport.registeredBy ?? null,
    originAddress: null,
    contractAddress: env.MATERIAL_REGISTRY_ADDRESS,
    metadata: {
      certificateHash: dataHashBytes,
      metadataUri,
    },
  });

  try {
    orgWallet = await ensureOrganisationWallet(passport.organisationId);
    await ensureHubRole(orgWallet.address, passport.organisationId);

    const submitted = await submitVeChainTransaction({
      thorClient,
      originPrivateKey: orgWallet.privateKey,
      originAddress: orgWallet.address,
      clauses: [
        {
          to: env.MATERIAL_REGISTRY_ADDRESS,
          value: '0x0',
          data: callData,
        },
      ],
      fallbackGas: 500_000,
    });
    logger.info(
      {
        passportId,
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
          certificateHash: dataHashBytes,
          metadataUri,
          gasPayerSource: submitted.gasPayerSource,
          delegated: submitted.delegated,
          gasEstimate: submitted.gasEstimate,
        },
      });
    }

    const receipt = await waitForReceipt(submitted.txId);

    if (!receipt || receipt.reverted) {
      throw new Error(`Transaction ${submitted.txId} failed or was not confirmed in time`);
    }

    await db
      .update(materialPassports)
      .set({
        blockchainTxHash: submitted.txId,
        blockchainPassportHash: dataHashBytes,
        blockchainAnchoredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(materialPassports.id, passportId));

    if (blockchainLog) {
      await updateBlockchainTransaction(blockchainLog.id, {
        status: 'succeeded',
        gasUsed: receipt.gasUsed,
        gasPayerAddress: receipt.gasPayer ?? submitted.gasPayerAddress,
        vthoPaidWei: receipt.paid,
        blockNumber: receipt.meta.blockNumber,
        blockId: receipt.meta.blockID,
        confirmedAt: new Date(),
      });
    }

    await recordAuditEvent({
      actor: {
        id: passport.registeredBy ?? null,
        organisationId: passport.organisationId,
      },
      action: 'passport.anchor',
      resourceType: 'passport',
      resourceId: passportId,
      status: 'succeeded',
      metadata: {
        txHash: submitted.txId,
        certificateHash: dataHashBytes,
        originAddress: orgWallet.address,
        gasPayerAddress: receipt.gasPayer ?? submitted.gasPayerAddress,
        gasUsed: receipt.gasUsed,
        vthoPaidWei: receipt.paid,
        blockNumber: receipt.meta.blockNumber,
      },
    });

    logger.info(
      {
        passportId,
        txId: submitted.txId,
        dataHashBytes,
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
      action: 'passport.anchor',
      resourceType: 'passport',
      resourceId: passportId,
      status: 'failed',
      failureReason: err instanceof Error ? err.message : String(err),
      metadata: {
        certificateHash: dataHashBytes,
        originAddress: orgWallet?.address ?? null,
      },
    });
    logger.error({ passportId, err }, 'Failed to anchor passport');
    throw err;
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

  logger.info('Anchor passport worker started');
  return worker;
}
