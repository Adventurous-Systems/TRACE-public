/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import { ethers } from 'hardhat';

const hre: any = require('hardhat');

describe('CircularMarketplace', () => {
  let market: any;
  let admin: any;
  let hub: any;
  let buyer: any;
  let other: any;

  function randomId(): string {
    return ethers.hexlify(ethers.randomBytes(32));
  }

  async function latestTimestamp(): Promise<number> {
    const block = await hre.ethers.provider.getBlock('latest');
    return block!.timestamp;
  }

  // Creates a listing and returns { listingId, passportId }
  async function createListing(opts: { expiresAt?: number } = {}) {
    const listingId = randomId();
    const passportId = randomId();
    const expiresAt = opts.expiresAt ?? 0;
    await market
      .connect(hub)
      .createListing(listingId, passportId, 100_00, expiresAt, 'db-listing-1');
    return { listingId, passportId };
  }

  // Creates a listing + accepted offer, returns { listingId, passportId, txId }
  async function createOffer(opts: { disputeDeadline?: number } = {}) {
    const { listingId, passportId } = await createListing();
    const txId = randomId();
    const ts = await latestTimestamp();
    const disputeDeadline = opts.disputeDeadline ?? ts + 48 * 3600;
    await market
      .connect(hub)
      .recordOffer(txId, listingId, buyer.address, 100_00, disputeDeadline, 'db-tx-1');
    return { listingId, passportId, txId, disputeDeadline };
  }

  beforeEach(async () => {
    [admin, hub, buyer, other] = await hre.ethers.getSigners();

    const Factory = await hre.ethers.getContractFactory('CircularMarketplace');
    market = await Factory.deploy(admin.address);
    await market.waitForDeployment();

    await market.connect(admin).grantHubRole(hub.address);
  });

  // ─── Deployment ──────────────────────────────────────────────────────────

  describe('deployment', () => {
    it('grants admin role to deployer', async () => {
      const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ADMIN_ROLE'));
      expect(await market.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
    });

    it('reverts with zero admin address', async () => {
      const Factory = await hre.ethers.getContractFactory('CircularMarketplace');
      await expect(Factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        market,
        'InvalidAddress',
      );
    });
  });

  // ─── createListing ───────────────────────────────────────────────────────

  describe('createListing', () => {
    it('creates a listing and emits Listed', async () => {
      const listingId = randomId();
      const passportId = randomId();
      await expect(
        market.connect(hub).createListing(listingId, passportId, 50_00, 0, 'off-1'),
      ).to.emit(market, 'Listed');
      expect(await market.totalListings()).to.equal(1);
    });

    it('reverts if passport already listed', async () => {
      const { passportId } = await createListing();
      const newListingId = randomId();
      await expect(
        market.connect(hub).createListing(newListingId, passportId, 50_00, 0, 'off-2'),
      ).to.be.revertedWithCustomError(market, 'PassportAlreadyListed');
    });

    it('maps passportId to listingId', async () => {
      const { listingId, passportId } = await createListing();
      expect(await market.getPassportListing(passportId)).to.equal(listingId);
    });

    it('reverts for non-hub callers', async () => {
      await expect(market.connect(other).createListing(randomId(), randomId(), 1, 0, 'x')).to.be
        .reverted;
    });
  });

  // ─── recordOffer ─────────────────────────────────────────────────────────

  describe('recordOffer', () => {
    it('records an offer and emits OfferAccepted', async () => {
      const { listingId } = await createListing();
      const txId = randomId();
      const deadline = (await latestTimestamp()) + 3600;
      await expect(
        market.connect(hub).recordOffer(txId, listingId, buyer.address, 100_00, deadline, 'db-tx'),
      ).to.emit(market, 'OfferAccepted');
    });

    it('reverts with InvalidId if same txId used twice', async () => {
      const { listingId } = await createListing();
      const txId = randomId();
      const deadline = (await latestTimestamp()) + 3600;
      await market
        .connect(hub)
        .recordOffer(txId, listingId, buyer.address, 100_00, deadline, 'db-tx');

      // Need a fresh listing for second attempt
      const { listingId: listingId2 } = await createListing();
      await expect(
        market
          .connect(hub)
          .recordOffer(txId, listingId2, buyer.address, 100_00, deadline, 'db-tx2'),
      ).to.be.revertedWithCustomError(market, 'InvalidId');
    });

    it('reverts if listing is not active', async () => {
      const { listingId } = await createListing();
      await market.connect(hub).cancelListing(listingId);
      await expect(market.connect(hub).recordOffer(randomId(), listingId, buyer.address, 1, 0, 'x'))
        .to.be.reverted;
    });
  });

  // ─── flagDispute ─────────────────────────────────────────────────────────

  describe('flagDispute', () => {
    it('allows dispute within deadline', async () => {
      const ts = await latestTimestamp();
      const { txId } = await createOffer({ disputeDeadline: ts + 48 * 3600 });
      await market.connect(hub).confirmDelivery(txId);
      await expect(market.connect(buyer).flagDispute(txId)).to.emit(market, 'DisputeFlagged');
    });

    it('reverts with DisputeWindowClosed after deadline', async () => {
      // Set dispute deadline in the past
      const ts = await latestTimestamp();
      const { txId } = await createOffer({ disputeDeadline: ts + 1 });

      await market.connect(hub).confirmDelivery(txId);

      // Mine a block to push time past the deadline
      await hre.network.provider.send('evm_increaseTime', [10]);
      await hre.network.provider.send('evm_mine');

      await expect(market.connect(buyer).flagDispute(txId)).to.be.revertedWithCustomError(
        market,
        'DisputeWindowClosed',
      );
    });
  });

  // ─── cancelTransaction ────────────────────────────────────────────────────

  describe('cancelTransaction', () => {
    it('restores _passportListing after cancel', async () => {
      const { listingId, passportId, txId } = await createOffer();

      // Before cancel: passportListing is cleared when offer accepted (listing is Reserved)
      // Let's cancel and check it's restored
      await market.connect(hub).cancelTransaction(txId);

      expect(await market.getPassportListing(passportId)).to.equal(
        listingId,
        '_passportListing must be restored to listingId after cancel',
      );
    });

    it('reactivates listing after cancel', async () => {
      const { listingId, txId } = await createOffer();
      await market.connect(hub).cancelTransaction(txId);

      const listing = await market.getListing(listingId);
      expect(listing.status).to.equal(0); // ListingStatus.Active = 0
    });

    it('allows a new offer on restored listing after cancel', async () => {
      const { listingId, txId } = await createOffer();
      await market.connect(hub).cancelTransaction(txId);

      // Should be able to record a new offer on the same listing
      const newTxId = randomId();
      const deadline = (await latestTimestamp()) + 3600;
      await expect(
        market
          .connect(hub)
          .recordOffer(newTxId, listingId, buyer.address, 100_00, deadline, 'db-tx-2'),
      ).to.not.be.reverted;
    });

    it('reverts if called by non-participant', async () => {
      const { txId } = await createOffer();
      await expect(market.connect(other).cancelTransaction(txId)).to.be.revertedWithCustomError(
        market,
        'NotAuthorised',
      );
    });
  });

  // ─── resolveDispute ───────────────────────────────────────────────────────

  describe('resolveDispute', () => {
    async function openDispute() {
      const ts = await latestTimestamp();
      const { listingId, passportId, txId } = await createOffer({
        disputeDeadline: ts + 48 * 3600,
      });
      await market.connect(hub).confirmDelivery(txId);
      await market.connect(buyer).flagDispute(txId);
      return { listingId, passportId, txId };
    }

    it('resolveDispute(txId, true) completes the transaction (seller wins)', async () => {
      const { txId } = await openDispute();
      await expect(market.connect(admin).resolveDispute(txId, true))
        .to.emit(market, 'DisputeResolved')
        .and.to.emit(market, 'TransactionCompleted');

      const tx = await market.getTransaction(txId);
      expect(tx.status).to.equal(4); // TxStatus.Completed = 4
    });

    it('resolveDispute(txId, false) cancels the transaction (buyer wins)', async () => {
      const { txId } = await openDispute();
      await expect(market.connect(admin).resolveDispute(txId, false))
        .to.emit(market, 'DisputeResolved')
        .and.to.emit(market, 'TransactionCancelled');

      const tx = await market.getTransaction(txId);
      expect(tx.status).to.equal(5); // TxStatus.Cancelled = 5
    });

    it('resolveDispute(txId, false) restores listing and _passportListing', async () => {
      const { listingId, passportId, txId } = await openDispute();
      await market.connect(admin).resolveDispute(txId, false);

      const listing = await market.getListing(listingId);
      expect(listing.status).to.equal(0); // ListingStatus.Active = 0

      expect(await market.getPassportListing(passportId)).to.equal(listingId);
    });

    it('reverts if called by non-admin', async () => {
      const { txId } = await openDispute();
      await expect(market.connect(other).resolveDispute(txId, true)).to.be.reverted;
    });

    it('reverts if tx is not in Disputed state', async () => {
      const { txId } = await createOffer();
      await expect(market.connect(admin).resolveDispute(txId, true)).to.be.revertedWithCustomError(
        market,
        'TxNotInExpectedState',
      );
    });
  });

  // ─── pause ────────────────────────────────────────────────────────────────

  describe('pause', () => {
    it('admin can pause and unpause', async () => {
      await market.connect(admin).pause();
      await expect(market.connect(hub).createListing(randomId(), randomId(), 1, 0, 'x')).to.be
        .reverted;

      await market.connect(admin).unpause();
      await expect(market.connect(hub).createListing(randomId(), randomId(), 1, 0, 'x')).to.not.be
        .reverted;
    });
  });
});
