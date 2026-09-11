import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const hre = await import('hardhat');
  const signers = await hre.ethers.getSigners();
  const deployer = signers[0];
  if (!deployer) throw new Error('No deployer account found');

  console.log('Deploying contracts with account:', deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log('Account balance:', ethers.formatEther(balance), 'VET');

  // ── MaterialRegistry ──────────────────────────────────────────────────────
  console.log('\nDeploying MaterialRegistry...');
  const MaterialRegistry = await hre.ethers.getContractFactory('MaterialRegistry');
  const registry = await MaterialRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log('MaterialRegistry deployed to:', registryAddress);

  // Grant HUB_ROLE to deployer (API wallet)
  const HUB_ROLE = ethers.keccak256(ethers.toUtf8Bytes('HUB_ROLE'));
  const hubRoleTx = await registry.getFunction('grantRole')(HUB_ROLE, deployer.address);
  await hubRoleTx.wait();
  console.log('HUB_ROLE granted to deployer');

  // ── CircularMarketplace ───────────────────────────────────────────────────
  console.log('\nDeploying CircularMarketplace...');
  const CircularMarketplace = await hre.ethers.getContractFactory('CircularMarketplace');
  const marketplace = await CircularMarketplace.deploy(deployer.address);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log('CircularMarketplace deployed to:', marketplaceAddress);

  // ── QualityAssurance ──────────────────────────────────────────────────────
  console.log('\nDeploying QualityAssurance...');
  const QualityAssurance = await hre.ethers.getContractFactory('QualityAssurance');
  const qualityAssurance = await QualityAssurance.deploy(deployer.address);
  await qualityAssurance.waitForDeployment();
  const qualityAssuranceAddress = await qualityAssurance.getAddress();
  console.log('QualityAssurance deployed to:', qualityAssuranceAddress);

  // ── Write deployments ─────────────────────────────────────────────────────
  const addresses = {
    MaterialRegistry: registryAddress,
    CircularMarketplace: marketplaceAddress,
    QualityAssurance: qualityAssuranceAddress,
    network: process.env['HARDHAT_NETWORK'] ?? 'vechain_solo',
    deployedAt: new Date().toISOString(),
    deployedBy: deployer.address,
  };

  const outPath = path.join(__dirname, '..', 'deployments.json');
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log('\nAddresses written to', outPath);

  console.log('\n─── Add these to your .env ──────────────────────────────');
  console.log(`MATERIAL_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`MARKETPLACE_ADDRESS=${marketplaceAddress}`);
  console.log(`QUALITY_ASSURANCE_ADDRESS=${qualityAssuranceAddress}`);
  console.log('─────────────────────────────────────────────────────────');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
