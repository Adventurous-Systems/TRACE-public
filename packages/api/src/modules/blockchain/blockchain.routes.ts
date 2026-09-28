import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { Interface } from 'ethers';
import { blockchainTransactions, db } from '@trace/db';
import { NotFoundError } from '@trace/core';
import { bytes32ToUuid, getChainAdapter } from '../../lib/chain/index.js';

const registryInterface = new Interface([
  'function registerPassport(bytes32 passportId, bytes32 dataHash, string metadataUri)',
  'function updatePassportHash(bytes32 passportId, bytes32 newDataHash)',
  'function grantHubRole(address hub)',
]);

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
    if (parsed.name === 'updatePassportHash') {
      const passportId = String(parsed.args[0]);
      return {
        method: parsed.name,
        passportId: bytes32ToUuid(passportId),
        passportIdBytes32: passportId,
        certificateHash: String(parsed.args[1]),
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
    const [chainTx, localLog] = await Promise.all([
      getChainAdapter().getTransaction(txHash),
      db.query.blockchainTransactions.findFirst({
        where: eq(blockchainTransactions.txHash, txHash),
      }),
    ]);

    if (!chainTx.transaction && !chainTx.receipt && !localLog) {
      throw new NotFoundError(`Blockchain transaction ${txHash} not found`);
    }

    const decoded = chainTx.firstCallData ? decodeClause(chainTx.firstCallData) : null;

    return reply.send({
      success: true,
      data: {
        id: txHash,
        status: chainTx.reverted === null ? 'pending' : chainTx.reverted ? 'failed' : 'confirmed',
        transaction: chainTx.transaction,
        receipt: chainTx.receipt,
        decoded,
        localLog,
      },
    });
  });
}
