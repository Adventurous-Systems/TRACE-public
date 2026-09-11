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

  // ── MaterialRegistry ───────────────────────────────────────────────────────

  console.log('\nDeploying MaterialRegistry...');
  const MaterialRegistry = await hre.ethers.getContractFactory('MaterialRegistry');
  const registry = await MaterialRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log('MaterialRegistry deployed to:', registryAddress);

  // Grant HUB_ROLE to the deployer (API wallet) for Solo dev
  const HUB_ROLE = ethers.keccak256(ethers.toUtf8Bytes('HUB_ROLE'));
  const tx1 = await registry.getFunction('grantRole')(HUB_ROLE, deployer.address);
  await tx1.wait();
  console.log('HUB_ROLE granted to deployer for dev');

  // ── CircularBuildToken (CBT) ───────────────────────────────────────────────

  console.log('\nDeploying CircularBuildToken...');
  const CBTFactory = await hre.ethers.getContractFactory('CircularBuildToken');
  const cbt = await CBTFactory.deploy(deployer.address);
  await cbt.waitForDeployment();
  const cbtAddress = await cbt.getAddress();
  console.log('CircularBuildToken deployed to:', cbtAddress);

  // Grant MINTER_ROLE to deployer (API server wallet) for dev
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('MINTER_ROLE'));
  const tx2 = await cbt.getFunction('grantRole')(MINTER_ROLE, deployer.address);
  await tx2.wait();
  console.log('MINTER_ROLE granted to deployer for dev');

  // ── TRACE Governance ──────────────────────────────────────────────────────

  console.log('\nDeploying TraceGovernance...');
  const GovernanceFactory = await hre.ethers.getContractFactory('TraceGovernance');
  const governance = await GovernanceFactory.deploy(deployer.address);
  await governance.waitForDeployment();
  const governanceAddress = await governance.getAddress();
  console.log('TraceGovernance deployed to:', governanceAddress);

  // ── CircularMarketplace ────────────────────────────────────────────────────

  console.log('\nDeploying CircularMarketplace...');
  const MarketplaceFactory = await hre.ethers.getContractFactory('CircularMarketplace');
  const marketplace = await MarketplaceFactory.deploy(deployer.address);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log('CircularMarketplace deployed to:', marketplaceAddress);

  // Grant HUB_ROLE to deployer for dev
  const tx3 = await marketplace.getFunction('grantRole')(HUB_ROLE, deployer.address);
  await tx3.wait();
  console.log('HUB_ROLE granted to deployer on CircularMarketplace');

  // ── QualityAssurance ───────────────────────────────────────────────────────

  console.log('\nDeploying QualityAssurance...');
  const QAFactory = await hre.ethers.getContractFactory('QualityAssurance');
  const qa = await QAFactory.deploy(deployer.address);
  await qa.waitForDeployment();
  const qaAddress = await qa.getAddress();
  console.log('QualityAssurance deployed to:', qaAddress);

  // ── Write outputs ──────────────────────────────────────────────────────────

  const addresses = {
    MaterialRegistry: registryAddress,
    CircularBuildToken: cbtAddress,
    TraceGovernance: governanceAddress,
    CircularMarketplace: marketplaceAddress,
    QualityAssurance: qaAddress,
    network: process.env['HARDHAT_NETWORK'] ?? 'vechain_solo',
    deployedAt: new Date().toISOString(),
    deployedBy: deployer.address,
  };

  const outPath = path.join(__dirname, '..', 'deployments.json');
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log('\nAddresses written to', outPath);

  console.log('\n─── Add these to your .env ───────────────────────');
  console.log(`MATERIAL_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`CBT_ADDRESS=${cbtAddress}`);
  console.log(`GOVERNANCE_ADDRESS=${governanceAddress}`);
  console.log(`MARKETPLACE_ADDRESS=${marketplaceAddress}`);
  console.log(`QUALITY_ASSURANCE_ADDRESS=${qaAddress}`);
  console.log('──────────────────────────────────────────────────');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
