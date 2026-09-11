export type ProposalStatus = 'active' | 'passed' | 'rejected' | 'executed' | 'cancelled';

export interface GovernanceProposal {
  id: string;
  title: string;
  description: string;
  creatorId: string;
  status: ProposalStatus;
  votingEndsAt: Date;
  forVotes: string; // numeric as string (CBT wei total)
  againstVotes: string; // numeric as string
  quorumReached: boolean;
  blockchainTxHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GovernanceVote {
  id: string;
  proposalId: string;
  voterId: string;
  support: boolean; // true = for, false = against
  weight: string; // CBT balance at vote time (as string)
  blockchainTxHash: string | null;
  createdAt: Date;
}
