import type { FastifyInstance } from 'fastify';
import { Address } from '@vechain/sdk-core';
import { ThorClient } from '@vechain/sdk-network';
import { Wallet } from 'ethers';
import { authenticate, authorize } from '../../middleware/auth.js';
import { listRecentAuditEvents, listRecentBlockchainTransactions } from '../../lib/audit.js';
import { env } from '../../env.js';

const thorClient = ThorClient.at(env.VECHAIN_NODE_URL);

function parseLimit(value: unknown): number {
  const limit = Number(value ?? 50);
  if (!Number.isFinite(limit)) return 50;
  return Math.min(Math.max(Math.trunc(limit), 1), 200);
}

function parseWei(value: string | null | undefined): bigint {
  if (!value) return 0n;
  try {
    return value.startsWith('0x') ? BigInt(value) : BigInt(value);
  } catch {
    return 0n;
  }
}

async function getGasPayerStatus() {
  const privateKey =
    env.FEE_DELEGATOR_PRIVATE_KEY ??
    (env.NODE_ENV !== 'production' ? env.DEPLOYER_PRIVATE_KEY : undefined);

  if (!privateKey) {
    return {
      address: null,
      energyWei: null,
      status: env.FEE_DELEGATOR_URL ? 'external' : 'unconfigured',
    };
  }

  const address = new Wallet(privateKey).address;
  try {
    const account = await thorClient.accounts.getAccount(Address.of(address));
    const energyWei = parseWei(account.energy);
    const critical = parseWei(env.VTHO_CRITICAL_THRESHOLD_WEI);
    const warning = parseWei(env.VTHO_WARNING_THRESHOLD_WEI);
    return {
      address,
      energyWei: energyWei.toString(),
      status: energyWei <= critical ? 'critical' : energyWei <= warning ? 'warning' : 'ok',
    };
  } catch {
    return {
      address,
      energyWei: null,
      status: 'unknown',
    };
  }
}

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/events',
    { preHandler: [authenticate, authorize('platform_admin')] },
    async (request, reply) => {
      const query = request.query as { limit?: string };
      const data = await listRecentAuditEvents(parseLimit(query.limit));
      return reply.send({ success: true, data });
    },
  );

  app.get(
    '/blockchain-transactions',
    { preHandler: [authenticate, authorize('platform_admin')] },
    async (request, reply) => {
      const query = request.query as { limit?: string };
      const items = await listRecentBlockchainTransactions(parseLimit(query.limit));
      const recentSpendWei = items
        .reduce((total, item) => total + parseWei(item.vthoPaidWei), 0n)
        .toString();
      const statusCounts = items.reduce<Record<string, number>>((acc, item) => {
        acc[item.status] = (acc[item.status] ?? 0) + 1;
        return acc;
      }, {});

      return reply.send({
        success: true,
        data: {
          items,
          summary: {
            recentSpendWei,
            statusCounts,
            gasPayer: await getGasPayerStatus(),
          },
        },
      });
    },
  );
}
