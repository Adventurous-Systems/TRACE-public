// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title MaterialRegistry
 * @dev Anchors material passport integrity proofs on VeChainThor.
 * The API computes keccak256(JSON-LD passport data) off-chain and submits
 * it here. Anyone can verify a passport by hashing the JSON-LD and comparing
 * against the on-chain record.
 */
contract MaterialRegistry is AccessControl, Pausable {
    bytes32 public constant HUB_ROLE = keccak256("HUB_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    enum PassportStatus {
        Active,      // 0 - available / in inventory
        Listed,      // 1 - listed on marketplace
        Reserved,    // 2 - reserved for buyer
        Sold,        // 3 - sold and transferred
        Installed,   // 4 - installed at new site
        Decommissioned // 5 - end of life
    }

    struct PassportRecord {
        bytes32 dataHash;       // keccak256 of canonical JSON-LD
        address owner;          // hub that registered it
        PassportStatus status;
        uint64 registeredAt;    // block timestamp
        uint64 updatedAt;
        string metadataUri;     // IPFS/MinIO URI to full JSON-LD (informational)
    }

    // passportId (UUID bytes32) => record
    mapping(bytes32 => PassportRecord) private _passports;
    // dataHash => passportId (for reverse lookup)
    mapping(bytes32 => bytes32) private _hashToId;

    uint256 private _totalPassports;

    // ─── Events ─────────────────────────────────────────────────────────────

    event PassportRegistered(
        bytes32 indexed passportId,
        bytes32 indexed dataHash,
        address indexed owner,
        string metadataUri,
        uint64 timestamp
    );

    event PassportHashUpdated(
        bytes32 indexed passportId,
        bytes32 oldHash,
        bytes32 newHash,
        uint64 timestamp
    );

    event PassportStatusChanged(
        bytes32 indexed passportId,
        PassportStatus oldStatus,
        PassportStatus newStatus,
        uint64 timestamp
    );

    event PassportTransferred(
        bytes32 indexed passportId,
        address indexed from,
        address indexed to,
        uint64 timestamp
    );

    // ─── Errors ─────────────────────────────────────────────────────────────

    error PassportNotFound(bytes32 passportId);
    error PassportAlreadyExists(bytes32 passportId);
    error HashAlreadyRegistered(bytes32 dataHash);
    error NotPassportOwner(bytes32 passportId, address caller);
    error InvalidPassportId();
    error InvalidDataHash();
    error InvalidAddress();
    error ArrayLengthMismatch();
    error BatchTooLarge(uint256 size);

    uint256 public constant MAX_BATCH_SIZE = 100;

    // ─── Constructor ────────────────────────────────────────────────────────

    constructor(address admin) {
        if (admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    // ─── Hub management ─────────────────────────────────────────────────────

    function grantHubRole(address hub) external onlyRole(ADMIN_ROLE) {
        _grantRole(HUB_ROLE, hub);
    }

    function revokeHubRole(address hub) external onlyRole(ADMIN_ROLE) {
        _revokeRole(HUB_ROLE, hub);
    }

    // ─── Core operations ────────────────────────────────────────────────────

    /**
     * @notice Register a material passport on-chain.
     * @param passportId UUID v7 as bytes32 (off-chain primary key)
     * @param dataHash keccak256 of canonical JSON-LD passport data
     * @param metadataUri URI pointing to full JSON-LD (MinIO/IPFS)
     */
    function registerPassport(
        bytes32 passportId,
        bytes32 dataHash,
        string calldata metadataUri
    ) external onlyRole(HUB_ROLE) whenNotPaused {
        if (passportId == bytes32(0)) revert InvalidPassportId();
        if (dataHash == bytes32(0)) revert InvalidDataHash();
        if (_passports[passportId].registeredAt != 0) revert PassportAlreadyExists(passportId);
        if (_hashToId[dataHash] != bytes32(0)) revert HashAlreadyRegistered(dataHash);

        uint64 ts = uint64(block.timestamp);

        _passports[passportId] = PassportRecord({
            dataHash: dataHash,
            owner: msg.sender,
            status: PassportStatus.Active,
            registeredAt: ts,
            updatedAt: ts,
            metadataUri: metadataUri
        });

        _hashToId[dataHash] = passportId;
        _totalPassports++;

        emit PassportRegistered(passportId, dataHash, msg.sender, metadataUri, ts);
    }

    /**
     * @notice Batch register multiple passports in one transaction (gas efficient).
     */
    function registerPassportBatch(
        bytes32[] calldata passportIds,
        bytes32[] calldata dataHashes,
        string[] calldata metadataUris
    ) external onlyRole(HUB_ROLE) whenNotPaused {
        uint256 len = passportIds.length;
        if (len != dataHashes.length || len != metadataUris.length) revert ArrayLengthMismatch();
        if (len > MAX_BATCH_SIZE) revert BatchTooLarge(len);

        uint64 ts = uint64(block.timestamp);

        for (uint256 i = 0; i < len; i++) {
            bytes32 pid = passportIds[i];
            bytes32 hash = dataHashes[i];

            if (pid == bytes32(0)) revert InvalidPassportId();
            if (hash == bytes32(0)) revert InvalidDataHash();
            if (_passports[pid].registeredAt != 0) revert PassportAlreadyExists(pid);
            if (_hashToId[hash] != bytes32(0)) revert HashAlreadyRegistered(hash);

            _passports[pid] = PassportRecord({
                dataHash: hash,
                owner: msg.sender,
                status: PassportStatus.Active,
                registeredAt: ts,
                updatedAt: ts,
                metadataUri: metadataUris[i]
            });

            _hashToId[hash] = pid;
            _totalPassports++;

            emit PassportRegistered(pid, hash, msg.sender, metadataUris[i], ts);
        }
    }

    /**
     * @notice Update the data hash (e.g. after an approved amendment).
     */
    function updatePassportHash(
        bytes32 passportId,
        bytes32 newDataHash
    ) external whenNotPaused {
        PassportRecord storage record = _getRecord(passportId);
        if (record.owner != msg.sender && !hasRole(ADMIN_ROLE, msg.sender)) {
            revert NotPassportOwner(passportId, msg.sender);
        }
        if (newDataHash == bytes32(0)) revert InvalidDataHash();
        if (_hashToId[newDataHash] != bytes32(0)) revert HashAlreadyRegistered(newDataHash);

        bytes32 oldHash = record.dataHash;
        delete _hashToId[oldHash];

        record.dataHash = newDataHash;
        record.updatedAt = uint64(block.timestamp);
        _hashToId[newDataHash] = passportId;

        emit PassportHashUpdated(passportId, oldHash, newDataHash, record.updatedAt);
    }

    /**
     * @notice Update the lifecycle status of a passport.
     */
    function updateStatus(
        bytes32 passportId,
        PassportStatus newStatus
    ) external whenNotPaused {
        PassportRecord storage record = _getRecord(passportId);
        if (record.owner != msg.sender && !hasRole(ADMIN_ROLE, msg.sender)) {
            revert NotPassportOwner(passportId, msg.sender);
        }

        PassportStatus oldStatus = record.status;
        record.status = newStatus;
        record.updatedAt = uint64(block.timestamp);

        emit PassportStatusChanged(passportId, oldStatus, newStatus, record.updatedAt);
    }

    /**
     * @notice Transfer passport ownership to another hub.
     */
    function transferPassport(
        bytes32 passportId,
        address newOwner
    ) external whenNotPaused {
        if (newOwner == address(0)) revert InvalidAddress();
        PassportRecord storage record = _getRecord(passportId);
        if (record.owner != msg.sender && !hasRole(ADMIN_ROLE, msg.sender)) {
            revert NotPassportOwner(passportId, msg.sender);
        }

        address oldOwner = record.owner;
        record.owner = newOwner;
        record.updatedAt = uint64(block.timestamp);

        emit PassportTransferred(passportId, oldOwner, newOwner, record.updatedAt);
    }

    // ─── View functions ──────────────────────────────────────────────────────

    /**
     * @notice Verify a passport by checking its data hash on-chain.
     * @return valid true if the hash matches the registered record
     */
    function verifyPassport(
        bytes32 passportId,
        bytes32 dataHash
    ) external view returns (bool valid, PassportRecord memory record) {
        record = _passports[passportId];
        valid = (record.registeredAt != 0) && (record.dataHash == dataHash);
    }

    /**
     * @notice Get the full passport record.
     */
    function getPassport(bytes32 passportId) external view returns (PassportRecord memory) {
        if (_passports[passportId].registeredAt == 0) revert PassportNotFound(passportId);
        return _passports[passportId];
    }

    /**
     * @notice Lookup passport ID by data hash.
     */
    function getPassportByHash(bytes32 dataHash) external view returns (bytes32) {
        return _hashToId[dataHash];
    }

    /**
     * @notice Check if a passport is registered.
     */
    function isRegistered(bytes32 passportId) external view returns (bool) {
        return _passports[passportId].registeredAt != 0;
    }

    /**
     * @notice Total number of registered passports.
     */
    function totalPassports() external view returns (uint256) {
        return _totalPassports;
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    function _getRecord(bytes32 passportId) internal view returns (PassportRecord storage) {
        PassportRecord storage record = _passports[passportId];
        if (record.registeredAt == 0) revert PassportNotFound(passportId);
        return record;
    }
}
