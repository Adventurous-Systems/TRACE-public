// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title TraceGovernance
 * @notice DAO governance for the TRACE circular economy commons.
 *         Maps to Ostrom Principle 3 (Collective Choice) and
 *         Principle 6 (Conflict Resolution).
 *
 * Philosophy: "Thin on-chain, rich off-chain."
 *   - Full proposal text and vote reasoning stored in PostgreSQL.
 *   - On-chain: proposal hashes, vote tallies, and execution records
 *     for tamper-evident auditability.
 *
 * The API server holds ADMIN_ROLE and submits proposals/votes on
 * behalf of users. Users never interact with the blockchain directly.
 */
contract TraceGovernance is AccessControl, Pausable {
    // ── Roles ──────────────────────────────────────────────────────────────────

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ── Constants ─────────────────────────────────────────────────────────────

    uint256 public constant MIN_CBT_TO_PROPOSE = 100 * 10 ** 18; // 100 CBT
    uint256 public constant VOTING_PERIOD      = 7 days;
    uint256 public constant QUORUM_PERCENT     = 10;              // 10% of supply

    // ── Data structures ───────────────────────────────────────────────────────

    enum ProposalStatus { Active, Passed, Rejected, Executed, Cancelled }

    struct Proposal {
        bytes32  proposalId;      // Off-chain UUID as bytes32
        bytes32  contentHash;     // keccak256 of proposal JSON
        address  creator;
        uint256  votingEndsAt;
        uint256  forVotes;        // Cumulative CBT weight (wei)
        uint256  againstVotes;    // Cumulative CBT weight (wei)
        uint256  quorumSnapshot;  // Total CBT supply at proposal creation
        ProposalStatus status;
        bool     exists;
    }

    struct Vote {
        address  voter;
        uint256  weight;          // CBT balance at vote time (wei)
        bool     support;         // true = for, false = against
        uint256  timestamp;
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    mapping(bytes32 => Proposal)               public proposals;
    mapping(bytes32 => Vote[])                 public proposalVotes;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    bytes32[] public proposalIds;

    // ── Events ────────────────────────────────────────────────────────────────

    event ProposalCreated(
        bytes32 indexed proposalId,
        address indexed creator,
        bytes32 contentHash,
        uint256 votingEndsAt,
        uint256 quorumSnapshot
    );

    event VoteCast(
        bytes32 indexed proposalId,
        address indexed voter,
        bool    support,
        uint256 weight
    );

    event ProposalExecuted(bytes32 indexed proposalId, address indexed executor);
    event ProposalCancelled(bytes32 indexed proposalId, address indexed cancelledBy);

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(address admin) {
        require(admin != address(0), "Gov: zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    // ── Proposal creation ─────────────────────────────────────────────────────

    /**
     * @notice Record a new governance proposal on-chain.
     * @param proposalId    Off-chain UUID encoded as bytes32
     * @param contentHash   keccak256 of the full proposal JSON
     * @param creator       Address of the proposer (their hub wallet)
     * @param quorumSnapshot Total CBT supply at creation time (wei) — passed by API
     */
    function createProposal(
        bytes32 proposalId,
        bytes32 contentHash,
        address creator,
        uint256 quorumSnapshot
    ) external onlyRole(ADMIN_ROLE) whenNotPaused {
        require(!proposals[proposalId].exists, "Gov: proposal already exists");
        require(contentHash != bytes32(0), "Gov: empty content hash");
        require(creator != address(0), "Gov: zero creator");

        uint256 votingEndsAt = block.timestamp + VOTING_PERIOD;

        proposals[proposalId] = Proposal({
            proposalId:      proposalId,
            contentHash:     contentHash,
            creator:         creator,
            votingEndsAt:    votingEndsAt,
            forVotes:        0,
            againstVotes:    0,
            quorumSnapshot:  quorumSnapshot,
            status:          ProposalStatus.Active,
            exists:          true
        });

        proposalIds.push(proposalId);

        emit ProposalCreated(proposalId, creator, contentHash, votingEndsAt, quorumSnapshot);
    }

    // ── Voting ────────────────────────────────────────────────────────────────

    /**
     * @notice Record a vote on a proposal.
     *         Weight is the voter's CBT balance at vote time (passed by API server).
     * @param proposalId  The proposal being voted on
     * @param voter       The voter's blockchain address
     * @param support     true = in favour, false = against
     * @param weight      CBT balance at vote time (wei) — verified off-chain by API
     */
    function castVote(
        bytes32 proposalId,
        address voter,
        bool    support,
        uint256 weight
    ) external onlyRole(ADMIN_ROLE) whenNotPaused {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.exists, "Gov: proposal not found");
        require(proposal.status == ProposalStatus.Active, "Gov: proposal not active");
        require(block.timestamp <= proposal.votingEndsAt, "Gov: voting period ended");
        require(!hasVoted[proposalId][voter], "Gov: already voted");
        require(weight > 0, "Gov: zero voting weight");

        hasVoted[proposalId][voter] = true;

        if (support) {
            proposal.forVotes += weight;
        } else {
            proposal.againstVotes += weight;
        }

        proposalVotes[proposalId].push(Vote({
            voter:     voter,
            weight:    weight,
            support:   support,
            timestamp: block.timestamp
        }));

        emit VoteCast(proposalId, voter, support, weight);
    }

    // ── Execution ─────────────────────────────────────────────────────────────

    /**
     * @notice Mark a passed proposal as executed.
     *         Quorum and majority checks are enforced here.
     */
    function executeProposal(bytes32 proposalId) external onlyRole(ADMIN_ROLE) whenNotPaused {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.exists, "Gov: proposal not found");
        require(proposal.status == ProposalStatus.Active, "Gov: proposal not active");
        require(block.timestamp > proposal.votingEndsAt, "Gov: voting still open");

        uint256 totalVotes  = proposal.forVotes + proposal.againstVotes;
        uint256 quorumNeeded = (proposal.quorumSnapshot * QUORUM_PERCENT) / 100;

        if (totalVotes >= quorumNeeded && proposal.forVotes > proposal.againstVotes) {
            proposal.status = ProposalStatus.Executed;
            emit ProposalExecuted(proposalId, msg.sender);
        } else {
            proposal.status = ProposalStatus.Rejected;
        }
    }

    /**
     * @notice Cancel an active proposal (admin or creator via API).
     */
    function cancelProposal(bytes32 proposalId) external onlyRole(ADMIN_ROLE) whenNotPaused {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.exists, "Gov: proposal not found");
        require(proposal.status == ProposalStatus.Active, "Gov: cannot cancel non-active proposal");

        proposal.status = ProposalStatus.Cancelled;

        emit ProposalCancelled(proposalId, msg.sender);
    }

    // ── Read helpers ──────────────────────────────────────────────────────────

    function getProposal(bytes32 proposalId) external view returns (Proposal memory) {
        require(proposals[proposalId].exists, "Gov: proposal not found");
        return proposals[proposalId];
    }

    function getVoteCount(bytes32 proposalId) external view returns (uint256) {
        return proposalVotes[proposalId].length;
    }

    function getVotes(bytes32 proposalId) external view returns (Vote[] memory) {
        return proposalVotes[proposalId];
    }

    function getProposalCount() external view returns (uint256) {
        return proposalIds.length;
    }

    /**
     * @notice Check if quorum is reached for a proposal.
     */
    function isQuorumReached(bytes32 proposalId) external view returns (bool) {
        Proposal memory p = proposals[proposalId];
        if (!p.exists || p.quorumSnapshot == 0) return false;
        uint256 totalVotes  = p.forVotes + p.againstVotes;
        uint256 quorumNeeded = (p.quorumSnapshot * QUORUM_PERCENT) / 100;
        return totalVotes >= quorumNeeded;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
}
