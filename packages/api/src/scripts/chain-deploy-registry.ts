/**
 * Deploy MaterialRegistry to the configured chain, with the deployer as ADMIN.
 *
 *   node dist/scripts/chain-deploy-registry.js [--force]
 *
 * Reads the chain and deployer from the API environment (CHAIN_KIND,
 * VECHAIN_NODE_URL, DEPLOYER_PRIVATE_KEY) and deploys the bytecode bundled in
 * lib/chain/artifacts. Prints the new address as a
 * MATERIAL_REGISTRY_ADDRESS=... line for the API environment file.
 *
 * Refuses when MATERIAL_REGISTRY_ADDRESS is already set: a second registry
 * does not carry over the first one's anchors. Pass --force only when that is
 * intended (e.g. after resetting the chain).
 */
import { Wallet } from 'ethers';
import { env } from '../env.js';
import { getChainAdapter } from '../lib/chain/index.js';

function fail(message: string): never {
  process.stderr.write(`chain-deploy-registry: ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  if (args.some((arg) => arg !== '--force')) fail('usage: chain-deploy-registry [--force]');

  const privateKey = env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) fail('DEPLOYER_PRIVATE_KEY is not set');
  if (env.MATERIAL_REGISTRY_ADDRESS && !force) {
    fail(
      `MATERIAL_REGISTRY_ADDRESS is already ${env.MATERIAL_REGISTRY_ADDRESS}; ` +
        'a new registry would not contain its anchors. Pass --force if that is intended.',
    );
  }

  const chain = getChainAdapter();
  const chainId = await chain.chainId();
  const admin = { address: new Wallet(privateKey).address, privateKey };

  process.stdout.write(`Chain:    ${chainId}\nDeployer: ${admin.address}\n`);
  const submitted = await chain.deployMaterialRegistry(admin);
  process.stdout.write(`Tx:       ${submitted.txId}\n`);

  const receipt = await chain.waitForReceipt(submitted.txId, { timeoutMs: 120_000 });
  if (!receipt) fail(`transaction ${submitted.txId} was not confirmed within 120s`);
  if (receipt.reverted) fail(`transaction ${submitted.txId} reverted`);
  if (!receipt.contractAddress) fail(`transaction ${submitted.txId} created no contract`);

  // The new contract must answer as a registry before anyone relies on it.
  await chain.hasHubRole(receipt.contractAddress, admin.address);

  process.stdout.write(
    `Block:    ${receipt.blockNumber}\n\nMATERIAL_REGISTRY_ADDRESS=${receipt.contractAddress}\n`,
  );
}

main().then(
  () => process.exit(0),
  (err: unknown) => fail(err instanceof Error ? err.message : String(err)),
);
