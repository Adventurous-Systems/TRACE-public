/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { ethers } from 'hardhat';

// Hardhat's ethers is augmented at runtime but TS doesn't know the full type.
// Cast to any for getSigners/provider — this is standard hardhat test pattern.
const hre: any = require('hardhat');

describe('MaterialRegistry', () => {
  let registry: any;
  let admin: any;
  let hub: any;
  let other: any;

  // Helpers
  function randomId(): string {
    return ethers.hexlify(ethers.randomBytes(32));
  }

  function hashPassport(data: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(data));
  }

  beforeEach(async () => {
    [admin, hub, other] = await hre.ethers.getSigners();

    const MaterialRegistryFactory = await hre.ethers.getContractFactory('MaterialRegistry');
    registry = await MaterialRegistryFactory.deploy(admin.address);
    await registry.waitForDeployment();

    await registry.connect(admin).grantHubRole(hub.address);
  });

  // ─── Deployment ──────────────────────────────────────────────────────────

  describe('deployment', () => {
    it('grants admin roles to deployer', async () => {
      expect(await registry.hasRole(ethers.ZeroHash, admin.address)).to.be.true;
    });

    it('initialises total passports to 0', async () => {
      expect(await registry.totalPassports()).to.equal(0);
    });

    it('reverts with zero admin address', async () => {
      const Factory = await hre.ethers.getContractFactory('MaterialRegistry');
      await expect(Factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        registry,
        'InvalidAddress',
      );
    });
  });

  // ─── registerPassport ─────────────────────────────────────────────────────

  describe('registerPassport', () => {
    it('registers a passport and emits event', async () => {
      const pid = randomId();
      const hash = hashPassport('{"id":"test"}');
      const uri = 'https://storage/passport.json';

      await expect(registry.connect(hub).registerPassport(pid, hash, uri))
        .to.emit(registry, 'PassportRegistered')
        .withArgs(pid, hash, hub.address, uri, anyValue);

      expect(await registry.totalPassports()).to.equal(1);
    });

    it('stores record correctly', async () => {
      const pid = randomId();
      const hash = hashPassport('{"id":"test2"}');
      await registry.connect(hub).registerPassport(pid, hash, 'uri');

      const record = await registry.getPassport(pid);
      expect(record.dataHash).to.equal(hash);
      expect(record.owner).to.equal(hub.address);
      expect(record.status).to.equal(0); // Active
    });

    it('reverts if passport already registered', async () => {
      const pid = randomId();
      const hash = hashPassport('data');
      await registry.connect(hub).registerPassport(pid, hash, 'uri');

      await expect(
        registry.connect(hub).registerPassport(pid, hashPassport('other'), 'uri'),
      ).to.be.revertedWithCustomError(registry, 'PassportAlreadyExists');
    });

    it('reverts if hash already used by another passport', async () => {
      const hash = hashPassport('duplicate');
      await registry.connect(hub).registerPassport(randomId(), hash, 'uri');

      await expect(
        registry.connect(hub).registerPassport(randomId(), hash, 'uri'),
      ).to.be.revertedWithCustomError(registry, 'HashAlreadyRegistered');
    });

    it('reverts if called by non-hub', async () => {
      await expect(registry.connect(other).registerPassport(randomId(), hashPassport('x'), 'uri'))
        .to.be.reverted;
    });

    it('reverts with zero passportId', async () => {
      await expect(
        registry.connect(hub).registerPassport(ethers.ZeroHash, hashPassport('x'), 'uri'),
      ).to.be.revertedWithCustomError(registry, 'InvalidPassportId');
    });
  });

  // ─── registerPassportBatch ────────────────────────────────────────────────

  describe('registerPassportBatch', () => {
    it('registers multiple passports in one tx', async () => {
      const ids = [randomId(), randomId(), randomId()];
      const hashes = ids.map((_, i) => hashPassport(`passport-${i}`));
      const uris = ids.map((_, i) => `uri-${i}`);

      await registry.connect(hub).registerPassportBatch(ids, hashes, uris);
      expect(await registry.totalPassports()).to.equal(3);
    });

    it('reverts ArrayLengthMismatch when hashes array is shorter', async () => {
      const ids = [randomId(), randomId()];
      const hashes = [hashPassport('only-one')]; // length mismatch
      const uris = ['uri-0', 'uri-1'];

      await expect(
        registry.connect(hub).registerPassportBatch(ids, hashes, uris),
      ).to.be.revertedWithCustomError(registry, 'ArrayLengthMismatch');
    });

    it('reverts ArrayLengthMismatch when uris array is shorter', async () => {
      const ids = [randomId(), randomId()];
      const hashes = ids.map((_, i) => hashPassport(`h-${i}`));
      const uris = ['only-one']; // length mismatch

      await expect(
        registry.connect(hub).registerPassportBatch(ids, hashes, uris),
      ).to.be.revertedWithCustomError(registry, 'ArrayLengthMismatch');
    });

    it('reverts BatchTooLarge when more than MAX_BATCH_SIZE items', async () => {
      const count = 101;
      const ids = Array.from({ length: count }, () => randomId());
      const hashes = ids.map((_, i) => hashPassport(`h-${i}`));
      const uris = ids.map((_, i) => `uri-${i}`);

      await expect(
        registry.connect(hub).registerPassportBatch(ids, hashes, uris),
      ).to.be.revertedWithCustomError(registry, 'BatchTooLarge');
    });
  });

  // ─── verifyPassport ───────────────────────────────────────────────────────

  describe('verifyPassport', () => {
    it('returns valid=true for correct hash', async () => {
      const pid = randomId();
      const hash = hashPassport('canon');
      await registry.connect(hub).registerPassport(pid, hash, 'uri');

      const [valid] = await registry.verifyPassport(pid, hash);
      expect(valid).to.be.true;
    });

    it('returns valid=false for wrong hash', async () => {
      const pid = randomId();
      await registry.connect(hub).registerPassport(pid, hashPassport('real'), 'uri');

      const [valid] = await registry.verifyPassport(pid, hashPassport('tampered'));
      expect(valid).to.be.false;
    });

    it('returns valid=false for unknown passport', async () => {
      const [valid] = await registry.verifyPassport(randomId(), hashPassport('x'));
      expect(valid).to.be.false;
    });
  });

  // ─── updateStatus ─────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('owner can update status', async () => {
      const pid = randomId();
      await registry.connect(hub).registerPassport(pid, hashPassport('s'), 'uri');

      await expect(registry.connect(hub).updateStatus(pid, 1))
        .to.emit(registry, 'PassportStatusChanged')
        .withArgs(pid, 0, 1, anyValue);

      const record = await registry.getPassport(pid);
      expect(record.status).to.equal(1);
    });

    it('non-owner cannot update status', async () => {
      const pid = randomId();
      await registry.connect(hub).registerPassport(pid, hashPassport('s2'), 'uri');

      await expect(registry.connect(other).updateStatus(pid, 1)).to.be.revertedWithCustomError(
        registry,
        'NotPassportOwner',
      );
    });

    it('admin can update any status', async () => {
      const pid = randomId();
      await registry.connect(hub).registerPassport(pid, hashPassport('s3'), 'uri');
      await expect(registry.connect(admin).updateStatus(pid, 5)).to.not.be.reverted;
    });
  });

  // ─── updatePassportHash ───────────────────────────────────────────────────

  describe('updatePassportHash', () => {
    it('owner can update hash after amendment', async () => {
      const pid = randomId();
      const oldHash = hashPassport('v1');
      const newHash = hashPassport('v2');
      await registry.connect(hub).registerPassport(pid, oldHash, 'uri');

      await expect(registry.connect(hub).updatePassportHash(pid, newHash))
        .to.emit(registry, 'PassportHashUpdated')
        .withArgs(pid, oldHash, newHash, anyValue);

      const [valid] = await registry.verifyPassport(pid, newHash);
      expect(valid).to.be.true;

      expect(await registry.getPassportByHash(oldHash)).to.equal(ethers.ZeroHash);
    });
  });

  // ─── transferPassport ─────────────────────────────────────────────────────

  describe('transferPassport', () => {
    it('owner can transfer to another hub', async () => {
      const pid = randomId();
      await registry.connect(hub).registerPassport(pid, hashPassport('t'), 'uri');

      await expect(registry.connect(hub).transferPassport(pid, other.address))
        .to.emit(registry, 'PassportTransferred')
        .withArgs(pid, hub.address, other.address, anyValue);

      const record = await registry.getPassport(pid);
      expect(record.owner).to.equal(other.address);
    });

    it('non-owner cannot transfer', async () => {
      const pid = randomId();
      await registry.connect(hub).registerPassport(pid, hashPassport('t2'), 'uri');

      await expect(
        registry.connect(other).transferPassport(pid, other.address),
      ).to.be.revertedWithCustomError(registry, 'NotPassportOwner');
    });
  });

  // ─── pause ────────────────────────────────────────────────────────────────

  describe('pause', () => {
    it('admin can pause and unpause', async () => {
      await registry.connect(admin).pause();
      await expect(registry.connect(hub).registerPassport(randomId(), hashPassport('p'), 'uri')).to
        .be.reverted;

      await registry.connect(admin).unpause();
      await expect(registry.connect(hub).registerPassport(randomId(), hashPassport('p2'), 'uri')).to
        .not.be.reverted;
    });
  });
});
