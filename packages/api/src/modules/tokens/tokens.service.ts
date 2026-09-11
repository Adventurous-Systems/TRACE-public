/**
 * Token service — CircularBuildToken (CBT) queries and minting.
 *
 * Reads balance and supply from VeChainThor by simulating calls (eth_call equivalent).
 * Minting is triggered by the API server on behalf of users as a reward
 * for ecosystem contributions (passport registration, quality reports, sales).
 */

import { ThorClient } from '@vechain/sdk-network';
import { Interface, Wallet } from 'ethers';
import { createLogger } from '@trace/core';
import { env } from '../../env.js';

const logger = createLogger('tokens-service');

// ── ABI fragments ──────────────────────────────────────────────────────────

const CBT_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function mint(address to, uint256 amount, string calldata reason) external',
];

const iface = new Interface(CBT_ABI);

function getThorClient() {
  return ThorClient.at(env.VECHAIN_NODE_URL);
}

// ── CBT reward constants (mirrored from contract for API responses) ─────────

export const CBT_REWARDS = {
  passportRegistration: '10',
  qualityReport: '5',
  marketplaceSale: '20',
};

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Simulate a read-only contract call and decode the result.
 * Uses VeChain's transaction simulation (equivalent to eth_call).
 */
async function simulateCall(
  contractAddress: string,
  callData: string,
  decodeFn: (data: string) => readonly unknown[],
): Promise<readonly unknown[] | null> {
  try {
    const thorClient = getThorClient();
    const results = await thorClient.transactions.simulateTransaction([
      { to: contractAddress, value: '0x0', data: callData },
    ]);

    const output = results[0];
    if (!output || output.reverted) return null;

    return decodeFn(output.data);
  } catch (err) {
    logger.error({ err }, 'simulateCall failed');
    return null;
  }
}

// ── Balance query ──────────────────────────────────────────────────────────

/**
 * Get CBT balance for a blockchain address.
 * Returns balance as a decimal string in whole CBT (not wei).
 */
export async function getCbtBalance(address: string): Promise<string> {
  const cbtAddress = env.CBT_ADDRESS;
  if (!cbtAddress) {
    logger.warn('CBT_ADDRESS not set — returning zero balance');
    return '0';
  }

  const callData = iface.encodeFunctionData('balanceOf', [address]);
  const decoded = await simulateCall(cbtAddress, callData, (data) =>
    iface.decodeFunctionResult('balanceOf', data),
  );

  if (!decoded) return '0';

  const balanceWei = BigInt(String(decoded[0]));
  return (Number(balanceWei) / 1e18).toFixed(4);
}

/**
 * Get CBT total supply as a decimal string.
 */
export async function getCbtTotalSupply(): Promise<string> {
  const cbtAddress = env.CBT_ADDRESS;
  if (!cbtAddress) return '0';

  const callData = iface.encodeFunctionData('totalSupply', []);
  const decoded = await simulateCall(cbtAddress, callData, (data) =>
    iface.decodeFunctionResult('totalSupply', data),
  );

  if (!decoded) return '0';

  const supplyWei = BigInt(String(decoded[0]));
  return (Number(supplyWei) / 1e18).toFixed(4);
}

// ── Minting ────────────────────────────────────────────────────────────────

export type MintReason =
  | 'PASSPORT_REGISTRATION'
  | 'QUALITY_REPORT'
  | 'MARKETPLACE_SALE'
  | 'ADMIN_GRANT';

/**
 * Mint CBT to a recipient address as a reward.
 * Called by the API server when milestone events occur.
 * Returns the VeChain transaction ID, or null if blockchain is not configured.
 */
export async function mintCbt(
  toAddress: string,
  amountCbt: number,
  reason: MintReason,
): Promise<string | null> {
  const cbtAddress = env.CBT_ADDRESS;
  if (!cbtAddress) {
    logger.warn({ toAddress, reason }, 'CBT_ADDRESS not set — skipping mint');
    return null;
  }

  const privateKey = process.env['DEPLOYER_PRIVATE_KEY'];
  if (!privateKey) {
    logger.warn({ toAddress, reason }, 'DEPLOYER_PRIVATE_KEY not set — skipping mint');
    return null;
  }

  // Convert CBT to wei (18 decimals) and encode
  const amountWei = BigInt(Math.floor(amountCbt * 1e18));
  const callData = iface.encodeFunctionData('mint', [toAddress, amountWei, reason]);

  const thorClient = getThorClient();
  const wallet = new Wallet(privateKey);

  try {
    const txBody = await thorClient.transactions.buildTransactionBody(
      [{ to: cbtAddress, value: '0x0', data: callData }],
      0,
    );

    const rawTx = await wallet.signTransaction({
      ...txBody,
      chainId: txBody.chainTag,
    } as Parameters<typeof wallet.signTransaction>[0]);

    const { id: txId } = await thorClient.transactions.sendRawTransaction(rawTx);
    logger.info({ toAddress, amountCbt, reason, txId }, 'CBT minted');
    return txId;
  } catch (err) {
    logger.error({ toAddress, amountCbt, reason, err }, 'Failed to mint CBT');
    return null;
  }
}
