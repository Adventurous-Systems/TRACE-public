/**
 * Governance service — proposal creation, voting, and blockchain anchoring.
 * Maps to TraceGovernance.sol on VeChainThor.
 */

import { ethers } from 'ethers';
import { ThorClient } from '@vechain/sdk-network';
import { eq, desc, and } from 'drizzle-orm';
import { db, governanceProposals, governanceVotes, users } from '@trace/db';
import { createLogger, NotFoundError, ConflictError, ForbiddenError } from '@trace/core';
import { env } from '../../env.js';
import { getCbtBalance, getCbtTotalSupply } from '../tokens/tokens.service.js';
import type { CreateProposalInput, GovernanceQueryInput } from '@trace/core';

const logger = createLogger('governance-service');

// ── ABI fragments ──────────────────────────────────────────────────────────

const GOV_ABI = [
  'function createProposal(bytes32 proposalId, bytes32 contentHash, address creator, uint256 quorumSnapshot) external',
  'function castVote(bytes32 proposalId, address voter, bool support, uint256 weight) external',
  'function executeProposal(bytes32 proposalId) external',
  'function cancelProposal(bytes32 proposalId) external',
];

const iface = new ethers.Interface(GOV_ABI);

function getThorClient() {
  return ThorClient.at(env.VECHAIN_NODE_URL);
}

/**
 * Convert a UUID string to a bytes32 hex value (pad right with zeros).
 */
function uuidToBytes32(uuid: string): string {
  const hex = uuid.replace(/-/g, '');
  return '0x' + hex.padEnd(64, '0');
}

// ── Voting period (7 days, matching contract) ─────────────────────────────

const VOTING_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

// ── Proposal creation ──────────────────────────────────────────────────────

export async function createProposal(
  input: CreateProposalInput,
  creatorId: string,
  organisationId: string | null,
) {
  const votingEndsAt = new Date(Date.now() + VOTING_PERIOD_MS);

  // Get CBT total supply as quorum snapshot
  const quorumSnapshot = await getCbtTotalSupply();

  const [proposal] = await db
    .insert(governanceProposals)
    .values({
      creatorId,
      ...(organisationId ? { organisationId } : {}),
      title: input.title,
      description: input.description,
      votingEndsAt,
      quorumSnapshot,
    })
    .returning();

  // Fire-and-forget blockchain anchor
  anchorProposalOnChain(
    proposal!.id,
    proposal!.description,
    proposal!.creatorId,
    quorumSnapshot,
  ).catch((err) =>
    logger.error({ err, proposalId: proposal!.id }, 'Failed to anchor proposal on-chain'),
  );

  return proposal!;
}

async function anchorProposalOnChain(
  proposalId: string,
  description: string,
  creatorId: string,
  quorumSnapshot: string,
) {
  const govAddress = env.GOVERNANCE_ADDRESS;
  if (!govAddress) return;

  const privateKey = process.env['DEPLOYER_PRIVATE_KEY'];
  if (!privateKey) return;

  try {
    // Look up creator's blockchain address
    const creator = await db.query.users.findFirst({ where: eq(users.id, creatorId) });
    const creatorAddress = creator?.blockchainAddress ?? ethers.ZeroAddress;

    const proposalIdBytes32 = uuidToBytes32(proposalId);
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(description));
    const quorumSnapshotWei = BigInt(Math.floor(Number(quorumSnapshot) * 1e18));

    const callData = iface.encodeFunctionData('createProposal', [
      proposalIdBytes32,
      contentHash,
      creatorAddress,
      quorumSnapshotWei,
    ]);

    const thorClient = getThorClient();
    const wallet = new ethers.Wallet(privateKey);
    const txBody = await thorClient.transactions.buildTransactionBody(
      [{ to: govAddress, value: '0x0', data: callData }],
      0,
    );

    const rawTx = await wallet.signTransaction({
      ...txBody,
      chainId: txBody.chainTag,
    } as Parameters<typeof wallet.signTransaction>[0]);

    const { id: txId } = await thorClient.transactions.sendRawTransaction(rawTx);

    await db
      .update(governanceProposals)
      .set({ blockchainTxHash: txId, blockchainProposalId: proposalIdBytes32 } as Record<
        string,
        unknown
      >)
      .where(eq(governanceProposals.id, proposalId));

    logger.info({ proposalId, txId }, 'Proposal anchored on-chain');
  } catch (err) {
    logger.error({ err, proposalId }, 'anchorProposalOnChain failed');
  }
}

// ── List proposals ─────────────────────────────────────────────────────────

export async function listProposals(query: GovernanceQueryInput) {
  const offset = (query.page - 1) * query.limit;

  const rows = await db.query.governanceProposals.findMany({
    where: query.status ? eq(governanceProposals.status, query.status) : undefined,
    with: { creator: true, votes: true },
    orderBy: [desc(governanceProposals.createdAt)],
    limit: query.limit,
    offset,
  });

  // Count total
  const all = await db.query.governanceProposals.findMany({
    where: query.status ? eq(governanceProposals.status, query.status) : undefined,
  });

  return {
    data: rows.map(toProposalResponse),
    total: all.length,
    page: query.page,
    limit: query.limit,
  };
}

// ── Get proposal ───────────────────────────────────────────────────────────

export async function getProposalById(id: string) {
  const row = await db.query.governanceProposals.findFirst({
    where: eq(governanceProposals.id, id),
    with: { creator: true, votes: { with: { voter: true } } },
  });
  if (!row) throw new NotFoundError('Proposal not found');
  return toProposalDetailResponse(row as Record<string, unknown>);
}

// ── Cast vote ──────────────────────────────────────────────────────────────

export async function castVote(proposalId: string, voterId: string, support: boolean) {
  const proposal = await db.query.governanceProposals.findFirst({
    where: eq(governanceProposals.id, proposalId),
  });

  if (!proposal) throw new NotFoundError('Proposal not found');
  if (proposal.status !== 'active') throw new ForbiddenError('Proposal is not active');
  if (new Date() > proposal.votingEndsAt) throw new ForbiddenError('Voting period has ended');

  // Check duplicate vote
  const existing = await db.query.governanceVotes.findFirst({
    where: and(eq(governanceVotes.proposalId, proposalId), eq(governanceVotes.voterId, voterId)),
  });
  if (existing) throw new ConflictError('Already voted on this proposal');

  // Use voter's CBT balance as weight (or 1 if blockchain not configured)
  const voter = await db.query.users.findFirst({ where: eq(users.id, voterId) });
  let weight = '1';
  if (voter?.blockchainAddress) {
    const balance = await getCbtBalance(voter.blockchainAddress);
    if (balance && balance !== '0') {
      weight = balance;
    }
  }

  const [vote] = await db
    .insert(governanceVotes)
    .values({
      proposalId,
      voterId,
      support,
      weight,
    })
    .returning();

  // Update tally on proposal
  const currentFor = Number(proposal.forVotes);
  const currentAgainst = Number(proposal.againstVotes);
  const newFor = support ? String(currentFor + Number(weight)) : proposal.forVotes;
  const newAgainst = support ? proposal.againstVotes : String(currentAgainst + Number(weight));
  const totalVotes = Number(newFor) + Number(newAgainst);
  const quorumNeeded = Number(proposal.quorumSnapshot) * 0.1;
  const quorumReached = totalVotes >= quorumNeeded;

  await db
    .update(governanceProposals)
    .set({
      forVotes: newFor,
      againstVotes: newAgainst,
      quorumReached,
      updatedAt: new Date(),
    } as Record<string, unknown>)
    .where(eq(governanceProposals.id, proposalId));

  // Fire-and-forget blockchain vote
  anchorVoteOnChain(proposalId, voter?.blockchainAddress ?? null, support, weight).catch((err) =>
    logger.error({ err, proposalId, voterId }, 'Failed to anchor vote on-chain'),
  );

  return vote!;
}

async function anchorVoteOnChain(
  proposalId: string,
  voterAddress: string | null,
  support: boolean,
  weight: string,
) {
  const govAddress = env.GOVERNANCE_ADDRESS;
  if (!govAddress) return;
  const privateKey = process.env['DEPLOYER_PRIVATE_KEY'];
  if (!privateKey) return;

  try {
    const proposalIdBytes32 = uuidToBytes32(proposalId);
    const weightWei = BigInt(Math.floor(Number(weight) * 1e18));
    const voter = voterAddress ?? ethers.ZeroAddress;

    const callData = iface.encodeFunctionData('castVote', [
      proposalIdBytes32,
      voter,
      support,
      weightWei,
    ]);

    const thorClient = getThorClient();
    const wallet = new ethers.Wallet(privateKey);
    const txBody = await thorClient.transactions.buildTransactionBody(
      [{ to: govAddress, value: '0x0', data: callData }],
      0,
    );
    const rawTx = await wallet.signTransaction({
      ...txBody,
      chainId: txBody.chainTag,
    } as Parameters<typeof wallet.signTransaction>[0]);

    const { id: txId } = await thorClient.transactions.sendRawTransaction(rawTx);
    logger.info({ proposalId, txId }, 'Vote anchored on-chain');
  } catch (err) {
    logger.error({ err, proposalId }, 'anchorVoteOnChain failed');
  }
}

// ── Cancel proposal ────────────────────────────────────────────────────────

export async function cancelProposal(proposalId: string, userId: string, isAdmin: boolean) {
  const proposal = await db.query.governanceProposals.findFirst({
    where: eq(governanceProposals.id, proposalId),
  });

  if (!proposal) throw new NotFoundError('Proposal not found');
  if (proposal.status !== 'active')
    throw new ForbiddenError('Only active proposals can be cancelled');
  if (!isAdmin && proposal.creatorId !== userId) throw new ForbiddenError('Not your proposal');

  await db
    .update(governanceProposals)
    .set({ status: 'cancelled', updatedAt: new Date() } as Record<string, unknown>)
    .where(eq(governanceProposals.id, proposalId));

  return { success: true };
}

// ── Finalize proposal (after voting ends) ─────────────────────────────────

export async function finalizeProposal(proposalId: string) {
  const proposal = await db.query.governanceProposals.findFirst({
    where: eq(governanceProposals.id, proposalId),
  });

  if (!proposal) throw new NotFoundError('Proposal not found');
  if (proposal.status !== 'active') throw new ForbiddenError('Proposal is not active');
  if (new Date() <= proposal.votingEndsAt)
    throw new ForbiddenError('Voting period has not ended yet');

  const totalVotes = Number(proposal.forVotes) + Number(proposal.againstVotes);
  const quorumNeeded = Number(proposal.quorumSnapshot) * 0.1;
  const passed =
    totalVotes >= quorumNeeded && Number(proposal.forVotes) > Number(proposal.againstVotes);
  const newStatus = passed ? 'passed' : 'rejected';

  await db
    .update(governanceProposals)
    .set({ status: newStatus, updatedAt: new Date() } as Record<string, unknown>)
    .where(eq(governanceProposals.id, proposalId));

  return { status: newStatus };
}

// ── Response mappers ──────────────────────────────────────────────────────

type ProposalWithRelations = typeof governanceProposals.$inferSelect & {
  creator?: { name: string; email: string };
  votes?: unknown[];
};

function toProposalResponse(row: ProposalWithRelations) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    creatorId: row.creatorId,
    creator: row.creator ? { name: row.creator.name } : undefined,
    status: row.status,
    votingEndsAt: row.votingEndsAt,
    forVotes: row.forVotes,
    againstVotes: row.againstVotes,
    quorumReached: row.quorumReached,
    voteCount: row.votes?.length ?? 0,
    blockchainTxHash: row.blockchainTxHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toProposalDetailResponse(row: Record<string, unknown>) {
  const base = toProposalResponse(row as ProposalWithRelations);
  const votes = (row['votes'] as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    ...base,
    votes: votes.map((v) => ({
      id: v['id'] as string,
      proposalId: v['proposalId'] as string,
      voterId: v['voterId'] as string,
      voter: v['voter'] ? { name: (v['voter'] as { name: string }).name } : undefined,
      support: v['support'] as boolean,
      weight: v['weight'] as string,
      blockchainTxHash: v['blockchainTxHash'] as string | null,
      createdAt: v['createdAt'] as Date,
    })),
  };
}
