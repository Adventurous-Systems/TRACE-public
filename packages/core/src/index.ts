// Types
export type {
  PassportStatus,
  ConditionGrade,
  DeconstructionMethod,
  MaterialComponent,
  Dimensions,
  HazardousSubstance,
  EPCISEvent,
  MaterialPassport,
  PassportCertificateStatus,
  PassportCertificate,
} from './types/passport.js';

export type { UserRole, User, JwtPayload } from './types/user.js';

export type {
  ListingStatus,
  TransactionStatus,
  ShippingOption,
  Listing,
  Transaction,
} from './types/listing.js';

export type { OrganisationType, OrganisationBranding, Organisation } from './types/hub.js';

export type { QualityGrade, QualityReport } from './types/quality.js';

export type {
  AuditEventStatus,
  BlockchainTransactionStatus,
  AuditEvent,
  BlockchainTransactionLog,
} from './types/audit.js';

// Constants
export {
  MATERIAL_CATEGORIES,
  CATEGORY_L1_SLUGS,
  getCategoryBySlug,
  getSubcategoryBySlug,
  isValidL2ForL1,
} from './constants/categories.js';
export type { Category, Subcategory } from './constants/categories.js';

export {
  PASSPORT_STATUSES,
  CONDITION_GRADES,
  DECONSTRUCTION_METHODS,
  UNITS_OF_MEASURE,
  UNIT_OF_MEASURE_LABELS,
  unitLabel,
  USER_ROLES,
  ORGANISATION_TYPES,
  LISTING_STATUSES,
  TRANSACTION_STATUSES,
  PROTOTYPE_GS1_PREFIX,
  CBT_REWARDS,
  GOVERNANCE,
  BLOCKCHAIN,
  CONDITION_GRADE_LABELS,
} from './constants/config.js';

// Validators
export {
  CreatePassportSchema,
  UpdatePassportSchema,
  PassportStatusSchema,
  PassportQuerySchema,
} from './validators/passport.schema.js';
export type {
  CreatePassportInput,
  UpdatePassportInput,
  PassportQueryInput,
} from './validators/passport.schema.js';

export {
  LoginSchema,
  RegisterSchema,
  JwtPayloadSchema,
  CreateOrganisationSchema,
} from './validators/auth.schema.js';
export type {
  LoginInput,
  RegisterInput,
  JwtPayloadInput,
  CreateOrganisationInput,
} from './validators/auth.schema.js';

export {
  CreateListingSchema,
  UpdateListingSchema,
  MakeOfferSchema,
  MarketplaceQuerySchema,
  UpdateTransactionSchema,
} from './validators/listing.schema.js';
export type {
  CreateListingInput,
  UpdateListingInput,
  MakeOfferInput,
  MarketplaceQueryInput,
  UpdateTransactionInput,
} from './validators/listing.schema.js';

export { CreateQualityReportSchema, QualityQuerySchema } from './validators/quality.schema.js';
export type { CreateQualityReportInput, QualityQueryInput } from './validators/quality.schema.js';

export {
  AccessRequestRoleSchema,
  AccessRequestStatusSchema,
  CreateAccessRequestSchema,
  AccessRequestQuerySchema,
  UpdatePendingAccessRequestSchema,
  ApproveAccessRequestSchema,
  UpdateApprovedUserAccessSchema,
  UpdateAccessRequestOrganisationSchema,
  RejectAccessRequestSchema,
} from './validators/access-request.schema.js';
export type {
  CreateAccessRequestInput,
  AccessRequestQueryInput,
  UpdatePendingAccessRequestInput,
  ApproveAccessRequestInput,
  UpdateApprovedUserAccessInput,
  UpdateAccessRequestOrganisationInput,
  RejectAccessRequestInput,
} from './validators/access-request.schema.js';

// Logger
export { createLogger, logger } from './logger.js';
export type { Logger } from './logger.js';

// Errors
export {
  TraceError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  BlockchainError,
  InternalError,
  isTraceError,
} from './errors.js';
