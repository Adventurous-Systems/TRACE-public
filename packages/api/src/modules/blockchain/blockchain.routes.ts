import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { Interface } from 'ethers';
import { blockchainTransactions, db } from '@trace/db';
import { ThorClient } from '@vechain/sdk-network';
import { NotFoundError } from '@trace/core';
import { env } from '../../env.js';

const thorClient = ThorClient.at(env.VECHAIN_NODE_URL);
const registryInterface = new Interface([
  'function registerPassport(bytes32 passportId, bytes32 dataHash, string metadataUri)',
  'function grantHubRole(address hub)',
]);

function bytes32ToUuid(value: string): string {
  const hex = value.replace(/^0x/, '').slice(-32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function decodeClause(data: string) {
  try {
    const parsed = registryInterface.parseTransaction({ data });
    if (!parsed) return null;
    if (parsed.name === 'registerPassport') {
      const passportId = String(parsed.args[0]);
      return {
        method: parsed.name,
        passportId: bytes32ToUuid(passportId),
        passportIdBytes32: passportId,
        certificateHash: String(parsed.args[1]),
        metadataUri: String(parsed.args[2]),
      };
    }
    if (parsed.name === 'grantHubRole') {
      return {
        method: parsed.name,
        hubAddress: String(parsed.args[0]),
      };
    }
    return { method: parsed.name };
  } catch {
    return null;
  }
}

export async function blockchainRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { txHash: string } }>('/transactions/:txHash', async (request, reply) => {
    const txHash = request.params.txHash;
    const [tx, receipt, localLog] = await Promise.all([
      thorClient.transactions.getTransaction(txHash).catch(() => null),
      thorClient.transactions.getTransactionReceipt(txHash).catch(() => null),
      db.query.blockchainTransactions.findFirst({
        where: eq(blockchainTransactions.txHash, txHash),
      }),
    ]);

    if (!tx && !receipt && !localLog) {
      throw new NotFoundError(`Blockchain transaction ${txHash} not found`);
    }

    const firstClause = tx?.clauses?.[0];
    const decoded = firstClause?.data ? decodeClause(firstClause.data) : null;

    return reply.send({
      success: true,
      data: {
        id: txHash,
        status: receipt ? (receipt.reverted ? 'failed' : 'confirmed') : 'pending',
        transaction: tx,
        receipt,
        decoded,
        localLog,
      },
    });
  });
}
