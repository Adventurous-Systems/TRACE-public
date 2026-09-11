export type PassportStatus =
  | 'draft'
  | 'active'
  | 'listed'
  | 'reserved'
  | 'sold'
  | 'installed'
  | 'decommissioned';

export type ConditionGrade = 'A' | 'B' | 'C' | 'D';

export type DeconstructionMethod = 'selective' | 'mechanical' | 'manual' | 'mixed';

export interface MaterialComponent {
  material: string;
  percentage?: number;
  recycled?: boolean;
}

export interface Dimensions {
  length?: number;
  width?: number;
  height?: number;
  weight?: number;
  unit: 'mm' | 'cm' | 'm';
  weightUnit?: 'kg' | 'tonne';
}

export interface HazardousSubstance {
  name: string;
  casNumber?: string;
  concentration?: string;
  hazardClass?: string;
}

export interface EPCISEvent {
  id: string;
  passportId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  actorId?: string;
  blockchainTxHash?: string;
  createdAt: Date;
}

export interface MaterialPassport {
  // Identity
  id: string;
  organisationId: string;
  gtin?: string;
  serialNumber?: string;
  digitalLinkUri?: string;
  qrCodeUrl?: string;

  // Product
  productName: string;
  categoryL1: string;
  categoryL2?: string;
  unitOfMeasure?: string;
  materialComposition?: MaterialComponent[];
  dimensions?: Dimensions;
  technicalSpecs?: Record<string, unknown>;

  // Manufacturer / Source
  manufacturerName?: string;
  countryOfOrigin?: string;
  productionDate?: Date;

  // Environmental
  gwpTotal?: string;
  embodiedCarbon?: string;
  recycledContent?: string;
  epdReference?: string;

  // Compliance
  ceMarking?: boolean;
  declarationOfPerformance?: string;
  harmonisedStandard?: string;

  // Circular Extension
  previousBuildingId?: string;
  deconstructionDate?: Date;
  deconstructionMethod?: DeconstructionMethod;
  reclaimedBy?: string;
  conditionGrade?: ConditionGrade;
  conditionNotes?: string;
  conditionPhotos?: string[];
  originalAge?: number;
  remainingLifeEstimate?: number;
  carbonSavingsVsNew?: string;
  circularityScore?: number;
  reuseCount?: number;
  reuseSuitability?: string[];
  handlingRequirements?: string;
  hazardousSubstances?: HazardousSubstance[];

  // Flexible
  customAttributes?: Record<string, unknown>;

  // Status
  status: PassportStatus;

  // Blockchain anchoring
  blockchainTxHash?: string;
  blockchainPassportHash?: string;
  blockchainAnchoredAt?: Date;

  // Metadata
  registeredBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type PassportCertificateStatus = 'pending' | 'verified' | 'failed';

export interface PassportCertificate {
  passportId: string;
  status: PassportCertificateStatus;
  certificateHash: string | null;
  certificateId: string | null;
  txHash: string | null;
  registeredAt: Date | null;
  blockNumber: number | null;
  blockId: string | null;
  hub: {
    name: string;
    address: string | null;
  } | null;
  onchainVerified: boolean | null;
  failureReason: string | null;
  lastAttemptAt: Date | null;
}
