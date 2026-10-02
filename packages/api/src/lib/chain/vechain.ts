/**
 * VeChainThor implementation of ChainAdapter (Thor Solo, testnet, mainnet).
 *
 * The calls themselves were moved here unchanged from the anchor worker,
 * passport.service, blockchain.routes and audit.routes; transaction submission
 * and fee delegation stay in vechain-transactions.ts.
 */
import { ThorClient } from '@vechain/sdk-network';
import { ABIFunction, Address } from '@vechain/sdk-core';
import { Interface, keccak256, toUtf8Bytes } from 'ethers';
import { submitVeChainTransaction } from './vechain-transactions.js';
import {
  MATERIAL_REGISTRY_ABI,
  MATERIAL_REGISTRY_BYTECODE,
} from './artifacts/material-registry.js';
import { uuidToBytes32 } from './ids.js';
import type {
  ChainAdapter,
  ChainReceipt,
  ChainSigner,
  ChainTransactionView,
  SubmittedChainTransaction,
} from './types.js';

const REGISTRY_INTERFACE = new Interface([
  'function registerPassport(bytes32 passportId, bytes32 dataHash, string calldata metadataUri) external',
  'function updatePassportHash(bytes32 passportId, bytes32 newDataHash) external',
  'function grantHubRole(address hub) external',
  'function transferPassport(bytes32 passportId, address newOwner) external',
]);

const HUB_ROLE = keccak256(toUtf8Bytes('HUB_ROLE'));
const ZERO_HASH = `0x${'0'.repeat(64)}`;

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

// Gas ceilings used when estimation fails (see submitVeChainTransaction).
// registerPassport consumes ~200k on Thor; 500k leaves headroom.
const REGISTER_FALLBACK_GAS = 500_000;
const UPDATE_FALLBACK_GAS = 300_000;
const GRANT_ROLE_FALLBACK_GAS = 200_000;
// MaterialRegistry creation is ~2.5M gas on Thor.
const DEPLOY_FALLBACK_GAS = 4_000_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VeChainAdapter implements ChainAdapter {
  readonly kind = 'vechain';
  private readonly thorClient: ThorClient;
  private chainIdPromise: Promise<string> | null = null;

  constructor(nodeUrl: string) {
    this.thorClient = ThorClient.at(nodeUrl);
  }

  chainId(): Promise<string> {
    if (!this.chainIdPromise) {
      this.chainIdPromise = this.thorClient.blocks
        .getBlockCompressed(0)
        .then((genesis) => {
          if (!genesis) throw new Error('VeChain node returned no genesis block');
          return `vechain:${genesis.id}`;
        })
        .catch((err: unknown) => {
          // Don't cache a failure: the node may simply not be up yet.
          this.chainIdPromise = null;
          throw err;
        });
    }
    return this.chainIdPromise;
  }

  async ping(timeoutMs = 1500): Promise<boolean> {
    try {
      const best = await Promise.race([
        this.thorClient.blocks.getBestBlockCompressed(),
        sleep(timeoutMs).then(() => null),
      ]);
      return Boolean(best);
    } catch {
      return false;
    }
  }

  deployMaterialRegistry(admin: ChainSigner): Promise<SubmittedChainTransaction> {
    const constructorArgs = new Interface(MATERIAL_REGISTRY_ABI).encodeDeploy([admin.address]);
    const data = MATERIAL_REGISTRY_BYTECODE + constructorArgs.slice(2);
    return submitVeChainTransaction({
      thorClient: this.thorClient,
      originPrivateKey: admin.privateKey,
      originAddress: admin.address,
      clauses: [{ to: null, value: '0x0', data }],
      fallbackGas: DEPLOY_FALLBACK_GAS,
    });
  }

  registerPassport(
    signer: ChainSigner,
    input: { registryAddress: string; passportId: string; dataHash: string; metadataUri: string },
  ): Promise<SubmittedChainTransaction> {
    const data = REGISTRY_INTERFACE.encodeFunctionData('registerPassport', [
      uuidToBytes32(input.passportId),
      input.dataHash,
      input.metadataUri,
    ]);
    return this.submit(signer, input.registryAddress, data, REGISTER_FALLBACK_GAS);
  }

  updatePassportHash(
    signer: ChainSigner,
    input: { registryAddress: string; passportId: string; dataHash: string },
  ): Promise<SubmittedChainTransaction> {
    const data = REGISTRY_INTERFACE.encodeFunctionData('updatePassportHash', [
      uuidToBytes32(input.passportId),
      input.dataHash,
    ]);
    return this.submit(signer, input.registryAddress, data, UPDATE_FALLBACK_GAS);
  }

  transferPassport(
    signer: ChainSigner,
    input: { registryAddress: string; passportId: string; newOwner: string },
  ): Promise<SubmittedChainTransaction> {
    const data = REGISTRY_INTERFACE.encodeFunctionData('transferPassport', [
      uuidToBytes32(input.passportId),
      input.newOwner,
    ]);
    return this.submit(signer, input.registryAddress, data, UPDATE_FALLBACK_GAS);
  }

  async hasHubRole(registryAddress: string, address: string): Promise<boolean> {
    const result = await this.thorClient.contracts.executeCall(registryAddress, HAS_ROLE_FUNCTION, [
      HUB_ROLE,
      address,
    ]);
    return result.result?.array?.[0] === true;
  }

  grantHubRole(
    admin: ChainSigner,
    input: { registryAddress: string; hubAddress: string },
  ): Promise<SubmittedChainTransaction> {
    const data = REGISTRY_INTERFACE.encodeFunctionData('grantHubRole', [input.hubAddress]);
    return this.submit(admin, input.registryAddress, data, GRANT_ROLE_FALLBACK_GAS);
  }

  async waitForReceipt(
    txId: string,
    options: { timeoutMs?: number } = {},
  ): Promise<ChainReceipt | null> {
    // Poll immediately and then every second: Solo packs on demand within
    // ~0.1s, testnet/mainnet within one ~10s block.
    const deadline = Date.now() + (options.timeoutMs ?? 60_000);
    for (;;) {
      const receipt = await this.thorClient.transactions
        .getTransactionReceipt(txId)
        .catch(() => null);
      if (receipt) {
        return {
          reverted: receipt.reverted,
          gasUsed: receipt.gasUsed,
          gasPayer: receipt.gasPayer ?? null,
          paid: receipt.paid ?? null,
          blockNumber: receipt.meta.blockNumber,
          blockId: receipt.meta.blockID,
          contractAddress: receipt.outputs[0]?.contractAddress ?? null,
        };
      }
      if (Date.now() >= deadline) return null;
      await sleep(1000);
    }
  }

  async getPassportAnchor(
    registryAddress: string,
    passportId: string,
  ): Promise<{ registered: boolean; dataHash: string | null; owner: string | null }> {
    // verifyPassport returns the stored record even when the hash does not
    // match, so one call with a zero hash reads the record without reverting
    // for unregistered passports (unlike getPassport).
    const result = await this.thorClient.contracts.executeCall(registryAddress, VERIFY_FUNCTION, [
      uuidToBytes32(passportId),
      ZERO_HASH,
    ]);
    if (!result.success) {
      throw new Error(`MaterialRegistry.verifyPassport call failed for ${passportId}`);
    }
    // `plain` carries the tuple with its field names; `array` is positional.
    const record = (result.result?.plain as unknown[] | undefined)?.[1] as
      | { dataHash?: string; owner?: string; registeredAt?: bigint | number | string }
      | undefined;
    const registeredAt = BigInt(record?.registeredAt ?? 0);
    if (registeredAt === 0n) return { registered: false, dataHash: null, owner: null };
    return {
      registered: true,
      dataHash: String(record?.dataHash).toLowerCase(),
      owner: record?.owner ? String(record.owner) : null,
    };
  }

  async verifyPassport(
    registryAddress: string,
    passportId: string,
    dataHash: string,
  ): Promise<boolean | null> {
    try {
      const result = await this.thorClient.contracts.executeCall(registryAddress, VERIFY_FUNCTION, [
        uuidToBytes32(passportId),
        dataHash,
      ]);
      return result.result?.array?.[0] === true;
    } catch {
      return null;
    }
  }

  async getTransaction(txId: string): Promise<ChainTransactionView> {
    const [transaction, receipt] = await Promise.all([
      this.thorClient.transactions.getTransaction(txId).catch(() => null),
      this.thorClient.transactions.getTransactionReceipt(txId).catch(() => null),
    ]);
    return {
      transaction,
      receipt,
      reverted: receipt ? receipt.reverted : null,
      firstCallData: transaction?.clauses?.[0]?.data ?? null,
    };
  }

  async getFeeTokenBalance(address: string): Promise<bigint> {
    const account = await this.thorClient.accounts.getAccount(Address.of(address));
    return BigInt(account.energy);
  }

  private submit(
    signer: ChainSigner,
    to: string,
    data: string,
    fallbackGas: number,
  ): Promise<SubmittedChainTransaction> {
    return submitVeChainTransaction({
      thorClient: this.thorClient,
      originPrivateKey: signer.privateKey,
      originAddress: signer.address,
      clauses: [{ to, value: '0x0', data }],
      fallbackGas,
    });
  }
}
