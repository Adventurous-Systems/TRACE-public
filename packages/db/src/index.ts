export { db } from './client.js';
export type { Db } from './client.js';

export {
  organisations,
  users,
  betaAccessRequests,
  materialPassports,
  passportEvents,
  auditEvents,
  blockchainTransactions,
  listings,
  transactions,
  qualityReports,
  sensorReadings,
  feedbackSubmissions,
} from '../drizzle/schema.js';

export type {
  Organisation,
  NewOrganisation,
  User,
  NewUser,
  BetaAccessRequest,
  NewBetaAccessRequest,
  MaterialPassport,
  NewMaterialPassport,
  PassportEvent,
  NewPassportEvent,
  AuditEvent,
  NewAuditEvent,
  BlockchainTransaction,
  NewBlockchainTransaction,
  Listing,
  NewListing,
  Transaction,
  NewTransaction,
  QualityReport,
  NewQualityReport,
  SensorReading,
  NewSensorReading,
  FeedbackSubmission,
  NewFeedbackSubmission,
} from '../drizzle/schema.js';

// Canonical passport fingerprinting — shared by the API (anchoring + the public
// verify-integrity endpoint) and the seed/restore scripts, so the two can never
// drift apart. See ./passport-hash.ts before changing the document shape.
export { buildCanonicalJsonLd, computePassportHash } from './passport-hash.js';
