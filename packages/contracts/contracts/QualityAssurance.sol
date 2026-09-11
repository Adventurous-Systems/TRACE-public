// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title QualityAssurance
 * @notice On-chain anchoring of quality inspection reports for circular construction materials.
 *         Maps to Ostrom Principle 4: Monitoring — trusted inspectors provide verifiable
 *         condition assessments that are anchored as hashes.
 *
 * Off-chain: Full report data stored in PostgreSQL.
 * On-chain:  keccak256 hash of report JSON + inspector address + timestamp for tamper-evidence.
 */
contract QualityAssurance is AccessControl, Pausable {
    // ── Roles ──────────────────────────────────────────────────────────────────

    bytes32 public constant INSPECTOR_ROLE = keccak256("INSPECTOR_ROLE");
    bytes32 public constant HUB_ROLE = keccak256("HUB_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ── Data structures ───────────────────────────────────────────────────────

    enum ConditionGrade { A, B, C, D }

    struct Report {
        bytes32 reportHash;        // keccak256 of full report JSON-LD
        bytes32 materialId;        // Corresponds to MaterialRegistry materialId
        address inspector;
        ConditionGrade grade;
        uint256 timestamp;
        bool disputed;
        bool exists;
    }

    struct InspectorProfile {
        address inspector;
        string metadataUri;        // IPFS URI to inspector credentials
        uint256 reportCount;
        uint256 disputedCount;
        bool active;
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    // reportId (bytes32) → Report
    mapping(bytes32 => Report) private reports;

    // materialId → array of reportIds (most recent inspections)
    mapping(bytes32 => bytes32[]) private materialReports;

    // inspector address → profile
    mapping(address => InspectorProfile) private inspectors;

    // ── Events ────────────────────────────────────────────────────────────────

    event ReportAnchored(
        bytes32 indexed reportId,
        bytes32 indexed materialId,
        address indexed inspector,
        ConditionGrade grade,
        bytes32 reportHash
    );

    event ReportDisputed(
        bytes32 indexed reportId,
        address indexed disputedBy,
        uint256 timestamp
    );

    event InspectorRegistered(address indexed inspector, string metadataUri);
    event InspectorDeactivated(address indexed inspector);

    // ── Errors ────────────────────────────────────────────────────────────────

    error InvalidAddress();
    error ReportAlreadyAnchored(bytes32 reportId);
    error EmptyHash();
    error EmptyMaterialId();
    error ReportNotFound(bytes32 reportId);
    error ReportAlreadyDisputed(bytes32 reportId);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address admin) {
        if (admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    // ── Inspector management ──────────────────────────────────────────────────

    /**
     * @notice Register an inspector address. Called by hub admin or platform admin.
     * @param inspector Address of the inspector
     * @param metadataUri IPFS URI to inspector credentials / certifications
     */
    function registerInspector(
        address inspector,
        string calldata metadataUri
    ) external onlyRole(ADMIN_ROLE) {
        if (inspector == address(0)) revert InvalidAddress();

        inspectors[inspector] = InspectorProfile({
            inspector: inspector,
            metadataUri: metadataUri,
            reportCount: 0,
            disputedCount: 0,
            active: true
        });

        _grantRole(INSPECTOR_ROLE, inspector);

        emit InspectorRegistered(inspector, metadataUri);
    }

    /**
     * @notice Deactivate an inspector (does not remove historical reports).
     */
    function deactivateInspector(address inspector) external onlyRole(ADMIN_ROLE) {
        inspectors[inspector].active = false;
        _revokeRole(INSPECTOR_ROLE, inspector);

        emit InspectorDeactivated(inspector);
    }

    // ── Report anchoring ──────────────────────────────────────────────────────

    /**
     * @notice Anchor a quality report hash on-chain.
     * @param reportId    Off-chain UUID encoded as bytes32
     * @param materialId  The materialId from MaterialRegistry
     * @param reportHash  keccak256 of the full report JSON-LD
     * @param grade       Condition grade A=0, B=1, C=2, D=3
     */
    function anchorReport(
        bytes32 reportId,
        bytes32 materialId,
        bytes32 reportHash,
        ConditionGrade grade
    ) external onlyRole(INSPECTOR_ROLE) whenNotPaused {
        if (reports[reportId].exists) revert ReportAlreadyAnchored(reportId);
        if (reportHash == bytes32(0)) revert EmptyHash();
        if (materialId == bytes32(0)) revert EmptyMaterialId();

        reports[reportId] = Report({
            reportHash: reportHash,
            materialId: materialId,
            inspector: msg.sender,
            grade: grade,
            timestamp: block.timestamp,
            disputed: false,
            exists: true
        });

        materialReports[materialId].push(reportId);
        inspectors[msg.sender].reportCount += 1;

        emit ReportAnchored(reportId, materialId, msg.sender, grade, reportHash);
    }

    // ── Dispute mechanism ─────────────────────────────────────────────────────

    /**
     * @notice Flag a report as disputed. Hub admin or platform admin only.
     *         Full dispute resolution happens off-chain; this records the flag.
     */
    function flagDispute(bytes32 reportId) external onlyRole(ADMIN_ROLE) whenNotPaused {
        if (!reports[reportId].exists) revert ReportNotFound(reportId);
        if (reports[reportId].disputed) revert ReportAlreadyDisputed(reportId);

        reports[reportId].disputed = true;
        inspectors[reports[reportId].inspector].disputedCount += 1;

        emit ReportDisputed(reportId, msg.sender, block.timestamp);
    }

    // ── Read helpers ──────────────────────────────────────────────────────────

    /**
     * @notice Verify that a given report hash matches the anchored hash.
     */
    function verifyReport(bytes32 reportId, bytes32 expectedHash) external view returns (bool) {
        return reports[reportId].exists && reports[reportId].reportHash == expectedHash;
    }

    /**
     * @notice Get all report IDs for a material.
     */
    function getMaterialReports(bytes32 materialId) external view returns (bytes32[] memory) {
        return materialReports[materialId];
    }

    /**
     * @notice Get inspector reputation: (reportCount - disputedCount) / reportCount
     *         Returns 100 if no reports yet. Scaled 0–100.
     */
    function getInspectorScore(address inspector) external view returns (uint256) {
        InspectorProfile memory profile = inspectors[inspector];
        if (profile.reportCount == 0) return 100;
        if (profile.disputedCount >= profile.reportCount) return 0;
        uint256 goodReports = profile.reportCount - profile.disputedCount;
        return (goodReports * 100) / profile.reportCount;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
}
