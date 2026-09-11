// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title CircularBuildToken (CBT)
 * @notice ERC-20 utility token for the TRACE circular economy commons.
 *         Maps to Ostrom Principle 5: Graduated Sanctions — rewards contribution,
 *         slashes staked tokens when disputes are upheld.
 *
 * CBT is NOT a payment currency. It is a reputation and incentive mechanism:
 *   - Earned by registering materials, submitting quality reports, completing sales
 *   - Staked as a quality guarantee when listing materials
 *   - Slashed if a dispute is upheld (graduated sanction)
 *   - Used for governance voting weight (TraceGovernance)
 *
 * Minting is controlled exclusively by MINTER_ROLE, held by the API server.
 * Users never interact with the blockchain directly — the API mints on their behalf.
 */
contract CircularBuildToken is ERC20, AccessControl, Pausable {
    // ── Roles ──────────────────────────────────────────────────────────────────

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ADMIN_ROLE  = keccak256("ADMIN_ROLE");

    // ── Reward amounts ────────────────────────────────────────────────────────

    uint256 public constant PASSPORT_REGISTRATION_REWARD = 10 * 10 ** 18; // 10 CBT
    uint256 public constant QUALITY_REPORT_REWARD        = 5  * 10 ** 18; // 5 CBT
    uint256 public constant MARKETPLACE_SALE_REWARD      = 20 * 10 ** 18; // 20 CBT
    uint256 public constant STAKE_LOCK_PERIOD            = 30 days;

    // ── Data structures ───────────────────────────────────────────────────────

    struct StakingPosition {
        uint256 amount;
        uint256 stakedAt;
        uint256 lockUntil;
        bool    active;
    }

    // staker address => materialId => position
    mapping(address => mapping(bytes32 => StakingPosition)) public stakingPositions;

    // materialId => aggregate staked CBT
    mapping(bytes32 => uint256) public materialTotalStake;

    // ── Events ────────────────────────────────────────────────────────────────

    event TokensMinted(address indexed to, uint256 amount, string reason);
    event Staked(address indexed staker, bytes32 indexed materialId, uint256 amount, uint256 lockUntil);
    event Unstaked(address indexed staker, bytes32 indexed materialId, uint256 amount);
    event StakeSlashed(bytes32 indexed materialId, address indexed staker, uint256 amount);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address admin) ERC20("CircularBuildToken", "CBT") {
        require(admin != address(0), "CBT: zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    // ── Minting ───────────────────────────────────────────────────────────────

    /**
     * @notice Mint CBT to a recipient. Called by the API server (MINTER_ROLE).
     * @param to     Recipient address (hub wallet on user's behalf)
     * @param amount Amount in wei (18 decimals)
     * @param reason Human-readable reason ("PASSPORT_REGISTRATION", "QUALITY_REPORT", etc.)
     */
    function mint(
        address to,
        uint256 amount,
        string calldata reason
    ) external onlyRole(MINTER_ROLE) whenNotPaused {
        require(to != address(0), "CBT: zero recipient");
        require(amount > 0, "CBT: zero amount");

        _mint(to, amount);

        emit TokensMinted(to, amount, reason);
    }

    // ── Staking ───────────────────────────────────────────────────────────────

    /**
     * @notice Stake CBT as a quality guarantee for a listed material.
     *         Locked for STAKE_LOCK_PERIOD. One active position per material per staker.
     * @param materialId  bytes32 materialId from MaterialRegistry
     * @param amount      CBT amount to stake (wei)
     */
    function stakeForQuality(
        bytes32 materialId,
        uint256 amount
    ) external whenNotPaused {
        require(materialId != bytes32(0), "CBT: invalid materialId");
        require(amount > 0, "CBT: zero stake amount");
        require(!stakingPositions[msg.sender][materialId].active, "CBT: position already active");
        require(balanceOf(msg.sender) >= amount, "CBT: insufficient balance");

        // Move tokens from staker to contract (escrow)
        _transfer(msg.sender, address(this), amount);

        uint256 lockUntil = block.timestamp + STAKE_LOCK_PERIOD;

        stakingPositions[msg.sender][materialId] = StakingPosition({
            amount:    amount,
            stakedAt:  block.timestamp,
            lockUntil: lockUntil,
            active:    true
        });

        materialTotalStake[materialId] += amount;

        emit Staked(msg.sender, materialId, amount, lockUntil);
    }

    /**
     * @notice Unstake CBT after lock period has expired.
     *         Only callable by the original staker.
     * @param materialId  The material the position is tied to
     */
    function unstake(bytes32 materialId) external whenNotPaused {
        StakingPosition storage pos = stakingPositions[msg.sender][materialId];
        require(pos.active, "CBT: no active position");
        require(block.timestamp >= pos.lockUntil, "CBT: lock period not elapsed");

        uint256 amount = pos.amount;
        pos.active = false;
        materialTotalStake[materialId] -= amount;

        _transfer(address(this), msg.sender, amount);

        emit Unstaked(msg.sender, materialId, amount);
    }

    /**
     * @notice Slash a staking position when a dispute is upheld.
     *         Slashed tokens are burned (graduated sanction).
     *         Only ADMIN_ROLE (governance/platform admin) can call.
     * @param materialId  The material the position is tied to
     * @param staker      The address whose stake is being slashed
     */
    function slashStake(
        bytes32 materialId,
        address staker
    ) external onlyRole(ADMIN_ROLE) whenNotPaused {
        StakingPosition storage pos = stakingPositions[staker][materialId];
        require(pos.active, "CBT: no active position to slash");

        uint256 amount = pos.amount;
        pos.active = false;
        materialTotalStake[materialId] -= amount;

        // Burn the slashed tokens — economic penalty
        _burn(address(this), amount);

        emit StakeSlashed(materialId, staker, amount);
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    /**
     * @notice Get the staking position for a given staker and material.
     */
    function getStakingPosition(
        address staker,
        bytes32 materialId
    ) external view returns (StakingPosition memory) {
        return stakingPositions[staker][materialId];
    }

    /**
     * @notice Total CBT staked across all positions for a material.
     */
    function getMaterialTotalStake(bytes32 materialId) external view returns (uint256) {
        return materialTotalStake[materialId];
    }

    // ── Role management ───────────────────────────────────────────────────────

    function grantMinterRole(address minter) external onlyRole(ADMIN_ROLE) {
        _grantRole(MINTER_ROLE, minter);
    }

    function revokeMinterRole(address minter) external onlyRole(ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, minter);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
}
