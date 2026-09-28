/**
 * Chain-neutral interface for everything TRACE does on a blockchain.
 *
 * WHY THIS EXISTS
 * TRACE anchors passport fingerprints on VeChainThor today (Thor Solo for the
 * demo, then testnet, then mainnet), but must be able to move to any other EVM
 * chain without rewriting the API. Only modules under lib/chain/ may import a
 * chain SDK (`@vechain/*`); everything else talks to a ChainAdapter. The
 * import-scan test in chain.test.ts enforces that boundary.
 *
 * The contracts (MaterialRegistry etc.) are plain Solidity + OpenZeppelin and
 * are already portable; what differs per chain is transaction submission, gas
 * sponsorship and how receipts/accounts are read.
 */

/** A key that signs a transaction (an organisation wallet or the deployer). */
export interface ChainSigner {
  address: string;
  privateKey: string;
}

/** What the adapter reports after broadcasting a transaction. */
export interface SubmittedChainTransaction {
  txId: string;
  originAddress: string;
  gasPayerAddress: string | null;
  gasPayerSource: string;
  delegated: boolean;
  gasLimit: number;
  gasEstimate: number | null;
}

/** A confirmed (or reverted) transaction's receipt, in chain-neutral terms. */
export interface ChainReceipt {
  reverted: boolean;
  gasUsed: number;
  gasPayer: string | null;
  /** Fee paid, in the chain's smallest fee-token unit (VTHO wei on VeChain). */
  paid: string | null;
  blockNumber: number;
  blockId: string;
  /** Address of the contract created by this transaction, if it deployed one. */
  contractAddress: string | null;
}

/** Raw chain data for the transaction explorer route. */
export interface ChainTransactionView {
  /** The chain's own transaction object, passed through for display. */
  transaction: unknown | null;
  /** The chain's own receipt object, passed through for display. */
  receipt: unknown | null;
  /** null when there is no receipt yet. */
  reverted: boolean | null;
  /** Calldata of the first clause/call, for decoding registry calls. */
  firstCallData: string | null;
}

export interface ChainAdapter {
  /** Adapter family, e.g. 'vechain'. */
  readonly kind: string;

  /**
   * Stable identifier of the connected chain, CAIP-2 style: `vechain:<genesis
   * block id>` or, for a future EVM adapter, `eip155:<chainId>`. Stored with
   * every anchor so records from different chains can coexist.
   */
  chainId(): Promise<string>;

  /** True when the node answers within the timeout. Never throws. */
  ping(timeoutMs?: number): Promise<boolean>;

  /**
   * Deploy MaterialRegistry from the bytecode bundled in lib/chain/artifacts,
   * with `admin` as its ADMIN. Wait for the receipt to learn the address.
   */
  deployMaterialRegistry(admin: ChainSigner): Promise<SubmittedChainTransaction>;

  /** MaterialRegistry.registerPassport — first anchor of a passport. */
  registerPassport(
    signer: ChainSigner,
    input: { registryAddress: string; passportId: string; dataHash: string; metadataUri: string },
  ): Promise<SubmittedChainTransaction>;

  /** MaterialRegistry.updatePassportHash — re-anchor after a data change. */
  updatePassportHash(
    signer: ChainSigner,
    input: { registryAddress: string; passportId: string; dataHash: string },
  ): Promise<SubmittedChainTransaction>;

  /** MaterialRegistry.hasRole(HUB_ROLE, address). */
  hasHubRole(registryAddress: string, address: string): Promise<boolean>;

  /** MaterialRegistry.grantHubRole — signed by an ADMIN (the deployer). */
  grantHubRole(
    admin: ChainSigner,
    input: { registryAddress: string; hubAddress: string },
  ): Promise<SubmittedChainTransaction>;

  /** Polls until the receipt exists or the timeout passes (then null). */
  waitForReceipt(txId: string, options?: { timeoutMs?: number }): Promise<ChainReceipt | null>;

  /**
   * MaterialRegistry.verifyPassport — does the chain hold this hash for this
   * passport? null when the node or contract cannot be reached (unknown,
   * never "mismatch").
   */
  verifyPassport(
    registryAddress: string,
    passportId: string,
    dataHash: string,
  ): Promise<boolean | null>;

  getTransaction(txId: string): Promise<ChainTransactionView>;

  /** Balance of the token that pays gas (VTHO on VeChain), in its smallest unit. */
  getFeeTokenBalance(address: string): Promise<bigint>;
}
