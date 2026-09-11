// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title CircularMarketplace
 * @dev On-chain record of marketplace listings and transaction state changes.
 *
 * This contract does NOT handle actual payment (fiat/GBP is off-chain).
 * It records:
 *   - When a material is listed for sale (linked to MaterialRegistry passportId)
 *   - When an offer is accepted (transaction created)
 *   - Delivery confirmation and dispute events
 *
 * The off-chain API handles fiat payments; on-chain anchoring provides
 * tamper-evident audit trail for EU DPP chain-of-custody requirements.
 *
 * Ostrom Principle 2 (Congruence): fee distribution and escrow logic
 * proportional to contribution are tracked here.
 */
contract CircularMarketplace is AccessControl, Pausable {
    bytes32 public constant HUB_ROLE = keccak256("HUB_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ─── Enums ───────────────────────────────────────────────────────────────

    enum ListingStatus { Active, Reserved, Sold, Expired, Cancelled }
    enum TxStatus { Pending, Confirmed, Disputed, Resolved, Completed, Cancelled }

    // ─── Structs ─────────────────────────────────────────────────────────────

    struct Listing {
        bytes32 passportId;     // MaterialRegistry passportId
        address seller;         // Hub address that listed
        uint256 pricePence;     // GBP pence (informational — fiat is off-chain)
        ListingStatus status;
        uint64 createdAt;
        uint64 expiresAt;       // 0 = no expiry
        string offChainId;      // DB UUID for reference
    }

    struct MarketTx {
        bytes32 listingId;
        address buyer;
        address seller;
        uint256 amountPence;    // Agreed price in GBP pence
        TxStatus status;
        uint64 createdAt;
        uint64 disputeDeadline; // Buyer must dispute before this timestamp
        string offChainId;      // DB transaction UUID
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    mapping(bytes32 => Listing) private _listings;
    mapping(bytes32 => MarketTx) private _transactions;

    // passportId => active listingId (0 if none)
    mapping(bytes32 => bytes32) private _passportListing;

    uint256 private _totalListings;
    uint256 private _totalTransactions;

    // ─── Events ──────────────────────────────────────────────────────────────

    event Listed(
        bytes32 indexed listingId,
        bytes32 indexed passportId,
        address indexed seller,
        uint256 pricePence,
        uint64 expiresAt,
        string offChainId
    );

    event ListingCancelled(
        bytes32 indexed listingId,
        address indexed by,
        uint64 timestamp
    );

    event ListingExpired(
        bytes32 indexed listingId,
        uint64 timestamp
    );

    event OfferAccepted(
        bytes32 indexed txId,
        bytes32 indexed listingId,
        address indexed buyer,
        uint256 amountPence,
        uint64 disputeDeadline,
        string offChainId
    );

    event DeliveryConfirmed(
        bytes32 indexed txId,
        address indexed buyer,
        uint64 timestamp
    );

    event DisputeFlagged(
        bytes32 indexed txId,
        address indexed buyer,
        uint64 timestamp
    );

    event DisputeResolved(
        bytes32 indexed txId,
        address indexed resolvedBy,
        uint64 timestamp
    );

    event TransactionCompleted(
        bytes32 indexed txId,
        bytes32 indexed passportId,
        address indexed buyer,
        uint64 timestamp
    );

    event TransactionCancelled(
        bytes32 indexed txId,
        address indexed by,
        uint64 timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────

    error ListingNotFound(bytes32 listingId);
    error TxNotFound(bytes32 txId);
    error ListingNotActive(bytes32 listingId, ListingStatus current);
    error TxNotInExpectedState(bytes32 txId, TxStatus current);
    error PassportAlreadyListed(bytes32 passportId);
    error NotAuthorised(address caller);
    error InvalidId();
    error InvalidAddress();
    error DisputeWindowClosed(bytes32 txId);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address admin) {
        if (admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    // ─── Hub management ──────────────────────────────────────────────────────

    function grantHubRole(address hub) external onlyRole(ADMIN_ROLE) {
        _grantRole(HUB_ROLE, hub);
    }

    function revokeHubRole(address hub) external onlyRole(ADMIN_ROLE) {
        _revokeRole(HUB_ROLE, hub);
    }

    // ─── Listings ────────────────────────────────────────────────────────────

    /**
     * @notice Record a new marketplace listing.
     * @param listingId  Off-chain DB UUID as bytes32
     * @param passportId MaterialRegistry passportId
     * @param pricePence Asking price in GBP pence
     * @param expiresAt  Unix timestamp; 0 for no expiry
     * @param offChainId DB UUID string for cross-reference
     */
    function createListing(
        bytes32 listingId,
        bytes32 passportId,
        uint256 pricePence,
        uint64 expiresAt,
        string calldata offChainId
    ) external onlyRole(HUB_ROLE) whenNotPaused {
        if (listingId == bytes32(0) || passportId == bytes32(0)) revert InvalidId();
        if (_listings[listingId].createdAt != 0) revert InvalidId(); // already exists
        if (_passportListing[passportId] != bytes32(0)) revert PassportAlreadyListed(passportId);

        uint64 ts = uint64(block.timestamp);

        _listings[listingId] = Listing({
            passportId: passportId,
            seller: msg.sender,
            pricePence: pricePence,
            status: ListingStatus.Active,
            createdAt: ts,
            expiresAt: expiresAt,
            offChainId: offChainId
        });

        _passportListing[passportId] = listingId;
        _totalListings++;

        emit Listed(listingId, passportId, msg.sender, pricePence, expiresAt, offChainId);
    }

    /**
     * @notice Cancel an active listing (seller or admin).
     */
    function cancelListing(bytes32 listingId) external whenNotPaused {
        Listing storage listing = _getListing(listingId);

        if (listing.seller != msg.sender && !hasRole(ADMIN_ROLE, msg.sender)) {
            revert NotAuthorised(msg.sender);
        }
        if (listing.status != ListingStatus.Active && listing.status != ListingStatus.Reserved) {
            revert ListingNotActive(listingId, listing.status);
        }

        listing.status = ListingStatus.Cancelled;
        delete _passportListing[listing.passportId];

        emit ListingCancelled(listingId, msg.sender, uint64(block.timestamp));
    }

    // ─── Transactions ─────────────────────────────────────────────────────────

    /**
     * @notice Record that a buyer's offer has been accepted.
     * @param txId          Off-chain DB UUID as bytes32
     * @param listingId     The listing being purchased
     * @param buyer         Buyer's address (may be zero if buyer has no wallet)
     * @param amountPence   Agreed price in GBP pence
     * @param disputeDeadline Unix timestamp — buyer must dispute before this
     * @param offChainId    DB transaction UUID string
     */
    function recordOffer(
        bytes32 txId,
        bytes32 listingId,
        address buyer,
        uint256 amountPence,
        uint64 disputeDeadline,
        string calldata offChainId
    ) external onlyRole(HUB_ROLE) whenNotPaused {
        if (txId == bytes32(0)) revert InvalidId();
        if (_transactions[txId].createdAt != 0) revert InvalidId();

        Listing storage listing = _getListing(listingId);
        if (listing.status != ListingStatus.Active) {
            revert ListingNotActive(listingId, listing.status);
        }

        // Check expiry
        if (listing.expiresAt != 0 && block.timestamp > listing.expiresAt) {
            listing.status = ListingStatus.Expired;
            delete _passportListing[listing.passportId];
            emit ListingExpired(listingId, uint64(block.timestamp));
            revert ListingNotActive(listingId, ListingStatus.Expired);
        }

        uint64 ts = uint64(block.timestamp);

        _transactions[txId] = MarketTx({
            listingId: listingId,
            buyer: buyer,
            seller: listing.seller,
            amountPence: amountPence,
            status: TxStatus.Pending,
            createdAt: ts,
            disputeDeadline: disputeDeadline,
            offChainId: offChainId
        });

        listing.status = ListingStatus.Reserved;
        _totalTransactions++;

        emit OfferAccepted(txId, listingId, buyer, amountPence, disputeDeadline, offChainId);
    }

    /**
     * @notice Buyer confirms delivery — starts the dispute window.
     */
    function confirmDelivery(bytes32 txId) external whenNotPaused {
        MarketTx storage tx_ = _getTx(txId);

        // Allow hub (on behalf of buyer with no wallet) or buyer directly
        if (tx_.buyer != address(0) && tx_.buyer != msg.sender && !hasRole(HUB_ROLE, msg.sender)) {
            revert NotAuthorised(msg.sender);
        }
        if (tx_.status != TxStatus.Pending) {
            revert TxNotInExpectedState(txId, tx_.status);
        }

        tx_.status = TxStatus.Confirmed;

        emit DeliveryConfirmed(txId, msg.sender, uint64(block.timestamp));

        // Auto-complete if past dispute deadline
        if (block.timestamp >= tx_.disputeDeadline) {
            _completeTx(txId, tx_);
        }
    }

    /**
     * @notice Buyer flags a dispute before the dispute deadline.
     */
    function flagDispute(bytes32 txId) external whenNotPaused {
        MarketTx storage tx_ = _getTx(txId);

        if (block.timestamp > tx_.disputeDeadline) revert DisputeWindowClosed(txId);

        if (tx_.buyer != address(0) && tx_.buyer != msg.sender && !hasRole(HUB_ROLE, msg.sender)) {
            revert NotAuthorised(msg.sender);
        }
        if (tx_.status != TxStatus.Pending && tx_.status != TxStatus.Confirmed) {
            revert TxNotInExpectedState(txId, tx_.status);
        }

        tx_.status = TxStatus.Disputed;

        emit DisputeFlagged(txId, msg.sender, uint64(block.timestamp));
    }

    /**
     * @notice Admin resolves a dispute.
     * @param completeFavourSeller true → complete the transaction (seller wins);
     *                             false → cancel and restore listing (buyer wins).
     */
    function resolveDispute(bytes32 txId, bool completeFavourSeller)
        external onlyRole(ADMIN_ROLE) whenNotPaused
    {
        MarketTx storage tx_ = _getTx(txId);

        if (tx_.status != TxStatus.Disputed) {
            revert TxNotInExpectedState(txId, tx_.status);
        }

        tx_.status = TxStatus.Resolved;

        emit DisputeResolved(txId, msg.sender, uint64(block.timestamp));

        if (completeFavourSeller) {
            _completeTx(txId, tx_);
        } else {
            tx_.status = TxStatus.Cancelled;
            Listing storage listing = _listings[tx_.listingId];
            listing.status = ListingStatus.Active;
            _passportListing[listing.passportId] = tx_.listingId;
            emit TransactionCancelled(txId, msg.sender, uint64(block.timestamp));
        }
    }

    /**
     * @notice Cancel a pending transaction (buyer or seller or admin).
     */
    function cancelTransaction(bytes32 txId) external whenNotPaused {
        MarketTx storage tx_ = _getTx(txId);

        if (
            tx_.buyer != msg.sender &&
            tx_.seller != msg.sender &&
            !hasRole(ADMIN_ROLE, msg.sender)
        ) {
            revert NotAuthorised(msg.sender);
        }
        if (tx_.status != TxStatus.Pending && tx_.status != TxStatus.Confirmed) {
            revert TxNotInExpectedState(txId, tx_.status);
        }

        tx_.status = TxStatus.Cancelled;

        // Reactivate listing and restore passport→listing mapping
        Listing storage listing = _listings[tx_.listingId];
        listing.status = ListingStatus.Active;
        _passportListing[listing.passportId] = tx_.listingId;

        emit TransactionCancelled(txId, msg.sender, uint64(block.timestamp));
    }

    // ─── View functions ───────────────────────────────────────────────────────

    function getListing(bytes32 listingId) external view returns (Listing memory) {
        if (_listings[listingId].createdAt == 0) revert ListingNotFound(listingId);
        return _listings[listingId];
    }

    function getTransaction(bytes32 txId) external view returns (MarketTx memory) {
        if (_transactions[txId].createdAt == 0) revert TxNotFound(txId);
        return _transactions[txId];
    }

    function getPassportListing(bytes32 passportId) external view returns (bytes32) {
        return _passportListing[passportId];
    }

    function totalListings() external view returns (uint256) {
        return _totalListings;
    }

    function totalTransactions() external view returns (uint256) {
        return _totalTransactions;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _getListing(bytes32 listingId) internal view returns (Listing storage) {
        Listing storage l = _listings[listingId];
        if (l.createdAt == 0) revert ListingNotFound(listingId);
        return l;
    }

    function _getTx(bytes32 txId) internal view returns (MarketTx storage) {
        MarketTx storage t = _transactions[txId];
        if (t.createdAt == 0) revert TxNotFound(txId);
        return t;
    }

    function _completeTx(bytes32 txId, MarketTx storage tx_) internal {
        tx_.status = TxStatus.Completed;

        Listing storage listing = _listings[tx_.listingId];
        listing.status = ListingStatus.Sold;
        delete _passportListing[listing.passportId];

        emit TransactionCompleted(txId, listing.passportId, tx_.buyer, uint64(block.timestamp));
    }
}
