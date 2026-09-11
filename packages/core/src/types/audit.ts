export type AuditEventStatus = 'attempted' | 'succeeded' | 'failed';

export type BlockchainTransactionStatus = 'pending' | 'submitted' | 'succeeded' | 'failed';

export interface AuditEvent {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  actorEmail: string | null;
  organisationId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  status: AuditEventStatus;
  failureReason: string | null;
  origin: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface BlockchainTransactionLog {
  id: string;
  txHash: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  organisationId: string | null;
  actorId: string | null;
  originAddress: string | null;
  gasPayerAddress: string | null;
  contractAddress: string | null;
  status: BlockchainTransactionStatus;
  gasLimit: number | null;
  gasUsed: number | null;
  vthoPaidWei: string | null;
  blockNumber: number | null;
  blockId: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
