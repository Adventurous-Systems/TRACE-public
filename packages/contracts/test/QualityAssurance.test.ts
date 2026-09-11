/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { ethers } from 'hardhat';

const hre: any = require('hardhat');

describe('QualityAssurance', () => {
  let qa: any;
  let admin: any;
  let inspector: any;
  let other: any;

  function randomId(): string {
    return ethers.hexlify(ethers.randomBytes(32));
  }

  function randomHash(): string {
    return ethers.keccak256(ethers.randomBytes(32));
  }

  // ConditionGrade.A = 0
  const GRADE_A = 0;

  beforeEach(async () => {
    [admin, inspector, other] = await hre.ethers.getSigners();

    const Factory = await hre.ethers.getContractFactory('QualityAssurance');
    qa = await Factory.deploy(admin.address);
    await qa.waitForDeployment();

    // Register inspector so we can use them in report tests
    await qa.connect(admin).registerInspector(inspector.address, 'ipfs://credentials');
  });

  // ─── Deployment ──────────────────────────────────────────────────────────

  describe('deployment', () => {
    it('grants admin role to deployer', async () => {
      const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ADMIN_ROLE'));
      expect(await qa.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
    });

    it('reverts with InvalidAddress for zero admin', async () => {
      const Factory = await hre.ethers.getContractFactory('QualityAssurance');
      await expect(Factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        qa,
        'InvalidAddress',
      );
    });
  });

  // ─── registerInspector ───────────────────────────────────────────────────

  describe('registerInspector', () => {
    it('registers an inspector and emits event', async () => {
      const newInspector = other;
      await expect(qa.connect(admin).registerInspector(newInspector.address, 'ipfs://creds'))
        .to.emit(qa, 'InspectorRegistered')
        .withArgs(newInspector.address, 'ipfs://creds');
    });

    it('reverts InvalidAddress for zero address inspector', async () => {
      await expect(
        qa.connect(admin).registerInspector(ethers.ZeroAddress, 'ipfs://creds'),
      ).to.be.revertedWithCustomError(qa, 'InvalidAddress');
    });

    it('reverts if called by non-admin', async () => {
      await expect(qa.connect(other).registerInspector(other.address, 'x')).to.be.reverted;
    });
  });

  // ─── anchorReport ────────────────────────────────────────────────────────

  describe('anchorReport', () => {
    it('anchors a report and emits ReportAnchored', async () => {
      const reportId = randomId();
      const materialId = randomId();
      const reportHash = randomHash();

      await expect(qa.connect(inspector).anchorReport(reportId, materialId, reportHash, GRADE_A))
        .to.emit(qa, 'ReportAnchored')
        .withArgs(reportId, materialId, inspector.address, GRADE_A, reportHash);
    });

    it('reverts ReportAlreadyAnchored for duplicate reportId', async () => {
      const reportId = randomId();
      const materialId = randomId();
      await qa.connect(inspector).anchorReport(reportId, materialId, randomHash(), GRADE_A);

      await expect(
        qa.connect(inspector).anchorReport(reportId, randomId(), randomHash(), GRADE_A),
      ).to.be.revertedWithCustomError(qa, 'ReportAlreadyAnchored');
    });

    it('reverts EmptyHash for zero reportHash', async () => {
      await expect(
        qa.connect(inspector).anchorReport(randomId(), randomId(), ethers.ZeroHash, GRADE_A),
      ).to.be.revertedWithCustomError(qa, 'EmptyHash');
    });

    it('reverts EmptyMaterialId for zero materialId', async () => {
      await expect(
        qa.connect(inspector).anchorReport(randomId(), ethers.ZeroHash, randomHash(), GRADE_A),
      ).to.be.revertedWithCustomError(qa, 'EmptyMaterialId');
    });

    it('reverts if called by non-inspector', async () => {
      await expect(qa.connect(other).anchorReport(randomId(), randomId(), randomHash(), GRADE_A)).to
        .be.reverted;
    });
  });

  // ─── flagDispute ─────────────────────────────────────────────────────────

  describe('flagDispute', () => {
    async function anchoredReport() {
      const reportId = randomId();
      const materialId = randomId();
      await qa.connect(inspector).anchorReport(reportId, materialId, randomHash(), GRADE_A);
      return { reportId, materialId };
    }

    it('flags a report as disputed', async () => {
      const { reportId } = await anchoredReport();
      await expect(qa.connect(admin).flagDispute(reportId))
        .to.emit(qa, 'ReportDisputed')
        .withArgs(reportId, admin.address, anyValue);
    });

    it('reverts ReportNotFound for unknown reportId', async () => {
      await expect(qa.connect(admin).flagDispute(randomId())).to.be.revertedWithCustomError(
        qa,
        'ReportNotFound',
      );
    });

    it('reverts ReportAlreadyDisputed if flagged twice', async () => {
      const { reportId } = await anchoredReport();
      await qa.connect(admin).flagDispute(reportId);

      await expect(qa.connect(admin).flagDispute(reportId)).to.be.revertedWithCustomError(
        qa,
        'ReportAlreadyDisputed',
      );
    });

    it('reverts if called by non-admin', async () => {
      const { reportId } = await anchoredReport();
      await expect(qa.connect(other).flagDispute(reportId)).to.be.reverted;
    });
  });

  // ─── verifyReport ────────────────────────────────────────────────────────

  describe('verifyReport', () => {
    it('returns true for matching hash', async () => {
      const reportId = randomId();
      const hash = randomHash();
      await qa.connect(inspector).anchorReport(reportId, randomId(), hash, GRADE_A);

      expect(await qa.verifyReport(reportId, hash)).to.be.true;
    });

    it('returns false for wrong hash', async () => {
      const reportId = randomId();
      await qa.connect(inspector).anchorReport(reportId, randomId(), randomHash(), GRADE_A);

      expect(await qa.verifyReport(reportId, randomHash())).to.be.false;
    });

    it('returns false for unknown reportId', async () => {
      expect(await qa.verifyReport(randomId(), randomHash())).to.be.false;
    });
  });

  // ─── getInspectorScore ────────────────────────────────────────────────────

  describe('getInspectorScore', () => {
    it('returns 100 for inspector with no reports', async () => {
      expect(await qa.getInspectorScore(inspector.address)).to.equal(100);
    });

    it('returns 100 for inspector with reports but no disputes', async () => {
      await qa.connect(inspector).anchorReport(randomId(), randomId(), randomHash(), GRADE_A);
      expect(await qa.getInspectorScore(inspector.address)).to.equal(100);
    });

    it('returns 0 when all reports disputed (no underflow)', async () => {
      const reportId = randomId();
      await qa.connect(inspector).anchorReport(reportId, randomId(), randomHash(), GRADE_A);
      await qa.connect(admin).flagDispute(reportId);

      // disputedCount == reportCount — must return 0, not underflow
      expect(await qa.getInspectorScore(inspector.address)).to.equal(0);
    });

    it('calculates partial score correctly', async () => {
      // 2 reports, 1 disputed → score = 50
      const r1 = randomId();
      const r2 = randomId();
      await qa.connect(inspector).anchorReport(r1, randomId(), randomHash(), GRADE_A);
      await qa.connect(inspector).anchorReport(r2, randomId(), randomHash(), GRADE_A);
      await qa.connect(admin).flagDispute(r1);

      expect(await qa.getInspectorScore(inspector.address)).to.equal(50);
    });
  });

  // ─── mappings are private ─────────────────────────────────────────────────

  describe('storage visibility', () => {
    it('reports mapping is not externally accessible (private)', () => {
      // If 'reports' were public there would be a reports(bytes32) function on the contract.
      // We verify by checking the contract ABI does not expose it.
      const iface = qa.interface;
      const hasReports = iface.fragments.some(
        (f: any) => f.type === 'function' && f.name === 'reports',
      );
      expect(hasReports).to.be.false;
    });

    it('materialReports mapping is not externally accessible (private)', () => {
      const iface = qa.interface;
      const hasMaterialReports = iface.fragments.some(
        (f: any) => f.type === 'function' && f.name === 'materialReports',
      );
      expect(hasMaterialReports).to.be.false;
    });
  });

  // ─── pause ────────────────────────────────────────────────────────────────

  describe('pause', () => {
    it('admin can pause and unpause', async () => {
      await qa.connect(admin).pause();
      await expect(
        qa.connect(inspector).anchorReport(randomId(), randomId(), randomHash(), GRADE_A),
      ).to.be.reverted;

      await qa.connect(admin).unpause();
      await expect(
        qa.connect(inspector).anchorReport(randomId(), randomId(), randomHash(), GRADE_A),
      ).to.not.be.reverted;
    });
  });
});
