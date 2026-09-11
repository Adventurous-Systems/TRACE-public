/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import { ethers } from 'hardhat';

const hre: any = require('hardhat');

describe('CircularBuildToken', () => {
  let cbt: any;
  let admin: any;
  let minter: any;
  let user1: any;
  let user2: any;

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('MINTER_ROLE'));
  const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ADMIN_ROLE'));

  function randomMaterialId(): string {
    return ethers.hexlify(ethers.randomBytes(32));
  }

  beforeEach(async () => {
    [admin, minter, user1, user2] = await hre.ethers.getSigners();

    const CBTFactory = await hre.ethers.getContractFactory('CircularBuildToken');
    cbt = await CBTFactory.deploy(admin.address);
    await cbt.waitForDeployment();

    // Grant minter role to minter account
    await cbt.connect(admin).grantMinterRole(minter.address);
  });

  // ── Deployment ──────────────────────────────────────────────────────────────

  describe('deployment', () => {
    it('has correct name and symbol', async () => {
      expect(await cbt.name()).to.equal('CircularBuildToken');
      expect(await cbt.symbol()).to.equal('CBT');
    });

    it('has 18 decimals', async () => {
      expect(await cbt.decimals()).to.equal(18);
    });

    it('starts with zero total supply', async () => {
      expect(await cbt.totalSupply()).to.equal(0n);
    });

    it('grants DEFAULT_ADMIN_ROLE and ADMIN_ROLE to deployer', async () => {
      expect(await cbt.hasRole(ethers.ZeroHash, admin.address)).to.be.true;
      expect(await cbt.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
    });

    it('reverts with zero admin address', async () => {
      const Factory = await hre.ethers.getContractFactory('CircularBuildToken');
      await expect(Factory.deploy(ethers.ZeroAddress)).to.be.revertedWith('CBT: zero admin');
    });

    it('exposes correct reward constants', async () => {
      expect(await cbt.PASSPORT_REGISTRATION_REWARD()).to.equal(ethers.parseEther('10'));
      expect(await cbt.QUALITY_REPORT_REWARD()).to.equal(ethers.parseEther('5'));
      expect(await cbt.MARKETPLACE_SALE_REWARD()).to.equal(ethers.parseEther('20'));
    });
  });

  // ── Minting ─────────────────────────────────────────────────────────────────

  describe('mint', () => {
    it('minter can mint tokens', async () => {
      await cbt
        .connect(minter)
        .mint(user1.address, ethers.parseEther('10'), 'PASSPORT_REGISTRATION');
      expect(await cbt.balanceOf(user1.address)).to.equal(ethers.parseEther('10'));
    });

    it('emits TokensMinted event', async () => {
      await expect(
        cbt.connect(minter).mint(user1.address, ethers.parseEther('10'), 'PASSPORT_REGISTRATION'),
      )
        .to.emit(cbt, 'TokensMinted')
        .withArgs(user1.address, ethers.parseEther('10'), 'PASSPORT_REGISTRATION');
    });

    it('non-minter cannot mint', async () => {
      await expect(cbt.connect(user1).mint(user2.address, ethers.parseEther('10'), 'test')).to.be
        .reverted;
    });

    it('reverts for zero recipient', async () => {
      await expect(
        cbt.connect(minter).mint(ethers.ZeroAddress, ethers.parseEther('10'), 'test'),
      ).to.be.revertedWith('CBT: zero recipient');
    });

    it('reverts for zero amount', async () => {
      await expect(cbt.connect(minter).mint(user1.address, 0n, 'test')).to.be.revertedWith(
        'CBT: zero amount',
      );
    });

    it('increments total supply', async () => {
      await cbt.connect(minter).mint(user1.address, ethers.parseEther('100'), 'test');
      await cbt.connect(minter).mint(user2.address, ethers.parseEther('50'), 'test');
      expect(await cbt.totalSupply()).to.equal(ethers.parseEther('150'));
    });
  });

  // ── Staking ─────────────────────────────────────────────────────────────────

  describe('stakeForQuality', () => {
    const stakeAmount = ethers.parseEther('50');

    beforeEach(async () => {
      // Give user1 some CBT to stake
      await cbt.connect(minter).mint(user1.address, ethers.parseEther('100'), 'test');
    });

    it('creates a staking position', async () => {
      const matId = randomMaterialId();
      await cbt.connect(user1).stakeForQuality(matId, stakeAmount);

      const pos = await cbt.getStakingPosition(user1.address, matId);
      expect(pos.active).to.be.true;
      expect(pos.amount).to.equal(stakeAmount);
    });

    it('transfers tokens to contract', async () => {
      const matId = randomMaterialId();
      const before = await cbt.balanceOf(user1.address);
      await cbt.connect(user1).stakeForQuality(matId, stakeAmount);
      expect(await cbt.balanceOf(user1.address)).to.equal(before - stakeAmount);
      expect(await cbt.balanceOf(await cbt.getAddress())).to.equal(stakeAmount);
    });

    it('increments materialTotalStake', async () => {
      const matId = randomMaterialId();
      await cbt.connect(user1).stakeForQuality(matId, stakeAmount);
      expect(await cbt.getMaterialTotalStake(matId)).to.equal(stakeAmount);
    });

    it('emits Staked event', async () => {
      const matId = randomMaterialId();
      await expect(cbt.connect(user1).stakeForQuality(matId, stakeAmount)).to.emit(cbt, 'Staked');
    });

    it('reverts if already staked for same material', async () => {
      const matId = randomMaterialId();
      await cbt.connect(user1).stakeForQuality(matId, stakeAmount);
      await expect(cbt.connect(user1).stakeForQuality(matId, stakeAmount)).to.be.revertedWith(
        'CBT: position already active',
      );
    });

    it('reverts with zero materialId', async () => {
      await expect(
        cbt.connect(user1).stakeForQuality(ethers.ZeroHash, stakeAmount),
      ).to.be.revertedWith('CBT: invalid materialId');
    });

    it('reverts with insufficient balance', async () => {
      const matId = randomMaterialId();
      await expect(
        cbt.connect(user2).stakeForQuality(matId, stakeAmount), // user2 has no CBT
      ).to.be.revertedWith('CBT: insufficient balance');
    });
  });

  // ── Unstaking ───────────────────────────────────────────────────────────────

  describe('unstake', () => {
    it('reverts before lock period', async () => {
      const matId = randomMaterialId();
      await cbt.connect(minter).mint(user1.address, ethers.parseEther('100'), 'test');
      await cbt.connect(user1).stakeForQuality(matId, ethers.parseEther('50'));

      await expect(cbt.connect(user1).unstake(matId)).to.be.revertedWith(
        'CBT: lock period not elapsed',
      );
    });

    it('reverts when no active position', async () => {
      const matId = randomMaterialId();
      await expect(cbt.connect(user1).unstake(matId)).to.be.revertedWith('CBT: no active position');
    });
  });

  // ── Slashing ────────────────────────────────────────────────────────────────

  describe('slashStake', () => {
    const stakeAmount = ethers.parseEther('50');

    beforeEach(async () => {
      await cbt.connect(minter).mint(user1.address, ethers.parseEther('100'), 'test');
    });

    it('admin can slash an active stake', async () => {
      const matId = randomMaterialId();
      await cbt.connect(user1).stakeForQuality(matId, stakeAmount);

      const supplyBefore = await cbt.totalSupply();
      await cbt.connect(admin).slashStake(matId, user1.address);

      // Tokens are burned
      expect(await cbt.totalSupply()).to.equal(supplyBefore - stakeAmount);
      expect(await cbt.getMaterialTotalStake(matId)).to.equal(0n);
    });

    it('emits StakeSlashed event', async () => {
      const matId = randomMaterialId();
      await cbt.connect(user1).stakeForQuality(matId, stakeAmount);

      await expect(cbt.connect(admin).slashStake(matId, user1.address))
        .to.emit(cbt, 'StakeSlashed')
        .withArgs(matId, user1.address, stakeAmount);
    });

    it('non-admin cannot slash', async () => {
      const matId = randomMaterialId();
      await cbt.connect(user1).stakeForQuality(matId, stakeAmount);

      await expect(cbt.connect(user2).slashStake(matId, user1.address)).to.be.reverted;
    });

    it('reverts when no active position', async () => {
      const matId = randomMaterialId();
      await expect(cbt.connect(admin).slashStake(matId, user1.address)).to.be.revertedWith(
        'CBT: no active position to slash',
      );
    });

    it('deactivates position after slash', async () => {
      const matId = randomMaterialId();
      await cbt.connect(user1).stakeForQuality(matId, stakeAmount);
      await cbt.connect(admin).slashStake(matId, user1.address);

      const pos = await cbt.getStakingPosition(user1.address, matId);
      expect(pos.active).to.be.false;
    });
  });

  // ── Role management ─────────────────────────────────────────────────────────

  describe('role management', () => {
    it('admin can grant minter role', async () => {
      await cbt.connect(admin).grantMinterRole(user1.address);
      expect(await cbt.hasRole(MINTER_ROLE, user1.address)).to.be.true;
    });

    it('admin can revoke minter role', async () => {
      await cbt.connect(admin).revokeMinterRole(minter.address);
      expect(await cbt.hasRole(MINTER_ROLE, minter.address)).to.be.false;
    });

    it('non-admin cannot grant minter role', async () => {
      await expect(cbt.connect(user1).grantMinterRole(user2.address)).to.be.reverted;
    });
  });

  // ── Pausable ─────────────────────────────────────────────────────────────────

  describe('pausable', () => {
    it('admin can pause and unpause', async () => {
      await cbt.connect(admin).pause();
      await expect(cbt.connect(minter).mint(user1.address, ethers.parseEther('1'), 'test')).to.be
        .reverted;

      await cbt.connect(admin).unpause();
      await expect(cbt.connect(minter).mint(user1.address, ethers.parseEther('1'), 'test')).not.to
        .be.reverted;
    });
  });
});
