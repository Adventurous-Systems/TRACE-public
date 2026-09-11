import { Wallet } from 'ethers';
import { ProviderInternalBaseWallet, VeChainProvider } from '@vechain/sdk-network';
import type { ThorClient } from '@vechain/sdk-network';
import type { TransactionClause } from '@vechain/sdk-core';
import { env } from '../env.js';

export interface SubmittedVeChainTransaction {
  txId: string;
  originAddress: string;
  gasPayerAddress: string | null;
  gasPayerSource: 'url' | 'private-key' | 'dev-deployer-fallback' | 'none';
  delegated: boolean;
  gasLimit: number;
  gasEstimate: number | null;
}

function privateKeyBytes(privateKey: string): Uint8Array {
  return Buffer.from(privateKey.replace(/^0x/, ''), 'hex');
}

function privateKeyAddress(privateKey: string): string {
  return new Wallet(privateKey).address;
}

function getGasPayerConfig() {
  if (env.FEE_DELEGATOR_URL) {
    return {
      options: { gasPayerServiceUrl: env.FEE_DELEGATOR_URL },
      address: null,
      source: 'url' as const,
    };
  }

  const configuredPrivateKey = env.FEE_DELEGATOR_PRIVATE_KEY;
  if (configuredPrivateKey) {
    return {
      options: { gasPayerPrivateKey: configuredPrivateKey },
      address: privateKeyAddress(configuredPrivateKey),
      source: 'private-key' as const,
    };
  }

  if (env.NODE_ENV !== 'production' && env.DEPLOYER_PRIVATE_KEY) {
    return {
      options: { gasPayerPrivateKey: env.DEPLOYER_PRIVATE_KEY },
      address: privateKeyAddress(env.DEPLOYER_PRIVATE_KEY),
      source: 'dev-deployer-fallback' as const,
    };
  }

  return null;
}

export async function submitVeChainTransaction(input: {
  thorClient: ThorClient;
  originPrivateKey: string;
  originAddress?: string;
  clauses: TransactionClause[];
  fallbackGas: number;
}): Promise<SubmittedVeChainTransaction> {
  const originAddress = input.originAddress ?? privateKeyAddress(input.originPrivateKey);
  const gasPayer = getGasPayerConfig();

  if (env.FEE_DELEGATION_REQUIRED && !gasPayer) {
    throw new Error('Fee delegation is required but no fee delegator is configured');
  }

  let gasLimit = input.fallbackGas;
  let gasEstimate: number | null = null;
  try {
    const estimate = await input.thorClient.gas.estimateGas(
      input.clauses,
      originAddress,
      gasPayer?.address ? { gasPayer: gasPayer.address, gasPadding: 0.2 } : { gasPadding: 0.2 },
    );
    if (estimate.reverted) {
      throw new Error(`Transaction simulation reverted: ${estimate.vmErrors.join(', ')}`);
    }
    gasEstimate = estimate.totalGas;
    gasLimit = Math.max(estimate.totalGas, input.fallbackGas);
  } catch (err) {
    if (env.FEE_DELEGATION_REQUIRED) throw err;
  }

  const provider = new VeChainProvider(
    input.thorClient,
    new ProviderInternalBaseWallet(
      [{ address: originAddress, privateKey: privateKeyBytes(input.originPrivateKey) }],
      gasPayer ? { gasPayer: gasPayer.options } : undefined,
    ),
    Boolean(gasPayer),
  );

  const signer = await provider.getSigner(originAddress);
  if (!signer) {
    throw new Error(`No VeChain signer available for ${originAddress}`);
  }

  const txId = await signer.sendTransaction({
    clauses: input.clauses,
    gas: gasLimit,
    ...(env.FEE_DELEGATOR_URL ? { delegationUrl: env.FEE_DELEGATOR_URL } : {}),
  });

  return {
    txId,
    originAddress,
    gasPayerAddress: gasPayer?.address ?? null,
    gasPayerSource: gasPayer?.source ?? 'none',
    delegated: Boolean(gasPayer),
    gasLimit,
    gasEstimate,
  };
}
