import {
  pgTable,
  text,
  uuid,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  date,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';

// ── Organisations ────────────────────────────────────────────────────────────

export const organisations = pgTable(
  'organisations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    type: text('type').notNull(), // hub | manufacturer | contractor | certifier
    slug: text('slug').notNull(),
    branding: jsonb('branding').$type<Record<string, unknown>>().default({}),
    verified: boolean('verified').default(false).notNull(),
    blockchainAddress: text('blockchain_address'),
    blockchainPrivateKeyEnc: text('blockchain_private_key_enc'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique('organisations_slug_unique').on(table.slug)],
);

export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;

// ── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    role: text('role').notNull(), // platform_admin | hub_admin | hub_staff | supplier | buyer | inspector
    organisationId: uuid('organisation_id').references(() => organisations.id),
    blockchainAddress: text('blockchain_address'),
    notificationPrefs: jsonb('notification_prefs').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique('users_email_unique').on(table.email)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ── Beta Access Requests ────────────────────────────────────────────────────

export const betaAccessRequests = pgTable(
  'beta_access_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    requestedRole: text('requested_role').notNull(), // hub_staff | hub_admin
    organisationName: text('organisation_name'),
    targetOrganisationId: uuid('target_organisation_id').references(() => organisations.id),
    notes: text('notes'),
    reviewNotes: text('review_notes'),
    status: text('status').notNull().default('pending'), // pending | approved | rejected
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_beta_access_requests_user').on(table.userId),
    index('idx_beta_access_requests_status').on(table.status),
    index('idx_beta_access_requests_target_org').on(table.targetOrganisationId),
  ],
);

export type BetaAccessRequest = typeof betaAccessRequests.$inferSelect;
export type NewBetaAccessRequest = typeof betaAccessRequests.$inferInsert;

// ── Material Passports ───────────────────────────────────────────────────────

export const materialPassports = pgTable(
  'material_passports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),

    // EU DPP Identity
    gtin: text('gtin'),
    serialNumber: text('serial_number'),
    digitalLinkUri: text('digital_link_uri'),
    qrCodeUrl: text('qr_code_url'),

    // Product
    productName: text('product_name').notNull(),
    categoryL1: text('category_l1').notNull(),
    categoryL2: text('category_l2'),
    unitOfMeasure: text('unit_of_measure'),
    materialComposition: jsonb('material_composition')
      .$type<Array<{ material: string; percentage?: number; recycled?: boolean }>>()
      .default([]),
    dimensions: jsonb('dimensions').$type<{
      length?: number;
      width?: number;
      height?: number;
      weight?: number;
      unit: string;
      weightUnit?: string;
    }>(),
    technicalSpecs: jsonb('technical_specs').$type<Record<string, unknown>>().default({}),

    // Manufacturer / Source
    manufacturerName: text('manufacturer_name'),
    countryOfOrigin: text('country_of_origin'),
    productionDate: date('production_date', { mode: 'date' }),

    // Environmental
    gwpTotal: numeric('gwp_total'), // kgCO2e
    embodiedCarbon: numeric('embodied_carbon'),
    recycledContent: numeric('recycled_content'), // percentage
    epdReference: text('epd_reference'),

    // Compliance
    ceMarking: boolean('ce_marking').default(false),
    declarationOfPerformance: text('declaration_of_performance'),
    harmonisedStandard: text('harmonised_standard'),

    // Circular Extension
    previousBuildingId: text('previous_building_id'),
    deconstructionDate: date('deconstruction_date', { mode: 'date' }),
    deconstructionMethod: text('deconstruction_method'), // selective | mechanical | manual | mixed
    reclaimedBy: text('reclaimed_by'),
    conditionGrade: text('condition_grade'), // A | B | C | D
    conditionNotes: text('condition_notes'),
    conditionPhotos: jsonb('condition_photos').$type<string[]>().default([]),
    originalAge: integer('original_age'),
    remainingLifeEstimate: integer('remaining_life_estimate'),
    carbonSavingsVsNew: numeric('carbon_savings_vs_new'),
    circularityScore: integer('circularity_score'),
    reuseCount: integer('reuse_count').default(0).notNull(),
    reuseSuitability: jsonb('reuse_suitability').$type<string[]>().default([]),
    handlingRequirements: text('handling_requirements'),
    hazardousSubstances: jsonb('hazardous_substances')
      .$type<
        Array<{ name: string; casNumber?: string; concentration?: string; hazardClass?: string }>
      >()
      .default([]),

    // Flexible
    customAttributes: jsonb('custom_attributes').$type<Record<string, unknown>>().default({}),

    // Status
    status: text('status').notNull().default('draft'),
    // draft | active | listed | reserved | sold | installed | decommissioned

    // Blockchain anchoring
    blockchainTxHash: text('blockchain_tx_hash'),
    blockchainPassportHash: text('blockchain_passport_hash'),
    blockchainAnchoredAt: timestamp('blockchain_anchored_at', { withTimezone: true }),

    // Metadata
    registeredBy: uuid('registered_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_passports_org').on(table.organisationId),
    index('idx_passports_status').on(table.status),
    index('idx_passports_category').on(table.categoryL1, table.categoryL2),
    index('idx_passports_gtin').on(table.gtin),
    index('idx_passports_search').using(
      'gin',
      sql`to_tsvector('english', ${table.productName} || ' ' || coalesce(${table.categoryL1}, '') || ' ' || coalesce(${table.categoryL2}, '') || ' ' || coalesce(${table.conditionNotes}, ''))`,
    ),
  ],
);

export type MaterialPassport = typeof materialPassports.$inferSelect;
export type NewMaterialPassport = typeof materialPassports.$inferInsert;

// ── Passport Events (EPCIS) ──────────────────────────────────────────────────

export const passportEvents = pgTable(
  'passport_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    passportId: uuid('passport_id')
      .notNull()
      .references(() => materialPassports.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(), // EPCIS 2.0 vocabulary
    eventData: jsonb('event_data').$type<Record<string, unknown>>().notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    blockchainTxHash: text('blockchain_tx_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_passport_events_passport').on(table.passportId)],
);

export type PassportEvent = typeof passportEvents.$inferSelect;
export type NewPassportEvent = typeof passportEvents.$inferInsert;

// ── Audit Events ────────────────────────────────────────────────────────────

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id),
    actorRole: text('actor_role'),
    actorEmail: text('actor_email'),
    organisationId: uuid('organisation_id').references(() => organisations.id),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    status: text('status').notNull(),
    failureReason: text('failure_reason'),
    origin: text('origin'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_audit_events_actor').on(table.actorId),
    index('idx_audit_events_org').on(table.organisationId),
    index('idx_audit_events_action').on(table.action),
    index('idx_audit_events_resource').on(table.resourceType, table.resourceId),
    index('idx_audit_events_created').on(table.createdAt),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;

// ── Blockchain Transactions ─────────────────────────────────────────────────

export const blockchainTransactions = pgTable(
  'blockchain_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    txHash: text('tx_hash'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    organisationId: uuid('organisation_id').references(() => organisations.id),
    actorId: uuid('actor_id').references(() => users.id),
    originAddress: text('origin_address'),
    gasPayerAddress: text('gas_payer_address'),
    contractAddress: text('contract_address'),
    status: text('status').notNull().default('pending'),
    gasLimit: integer('gas_limit'),
    gasUsed: integer('gas_used'),
    vthoPaidWei: text('vtho_paid_wei'),
    blockNumber: integer('block_number'),
    blockId: text('block_id'),
    failureReason: text('failure_reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('blockchain_transactions_tx_hash_unique').on(table.txHash),
    index('idx_blockchain_transactions_org').on(table.organisationId),
    index('idx_blockchain_transactions_actor').on(table.actorId),
    index('idx_blockchain_transactions_resource').on(table.resourceType, table.resourceId),
    index('idx_blockchain_transactions_status').on(table.status),
    index('idx_blockchain_transactions_created').on(table.createdAt),
  ],
);

export type BlockchainTransaction = typeof blockchainTransactions.$inferSelect;
export type NewBlockchainTransaction = typeof blockchainTransactions.$inferInsert;

// ── Listings ─────────────────────────────────────────────────────────────────

export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    passportId: uuid('passport_id')
      .notNull()
      .references(() => materialPassports.id, { onDelete: 'cascade' }),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id),
    pricePence: integer('price_pence').notNull(),
    currency: text('currency').default('GBP').notNull(),
    quantity: integer('quantity').default(1).notNull(),
    shippingOptions: jsonb('shipping_options')
      .$type<
        Array<{
          method: string;
          deliveryRadiusMiles?: number;
          deliveryCostPence?: number;
          notes?: string;
        }>
      >()
      .default([]),
    status: text('status').default('active').notNull(),
    // active | reserved | sold | expired | cancelled
    blockchainTxHash: text('blockchain_tx_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_listings_status').on(table.status),
    index('idx_listings_org').on(table.organisationId),
    index('idx_listings_passport').on(table.passportId),
  ],
);

export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;

// ── Transactions ─────────────────────────────────────────────────────────────

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id),
    amountPence: integer('amount_pence').notNull(),
    status: text('status').default('pending').notNull(),
    // pending | confirmed | disputed | resolved | completed | cancelled
    disputeDeadline: timestamp('dispute_deadline', { withTimezone: true }),
    blockchainTxHash: text('blockchain_tx_hash'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_transactions_listing').on(table.listingId),
    index('idx_transactions_buyer').on(table.buyerId),
    index('idx_transactions_status').on(table.status),
  ],
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

// ── Quality Reports ───────────────────────────────────────────────────────────

export const qualityReports = pgTable(
  'quality_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    passportId: uuid('passport_id')
      .notNull()
      .references(() => materialPassports.id, { onDelete: 'cascade' }),
    inspectorId: uuid('inspector_id')
      .notNull()
      .references(() => users.id),
    structuralScore: integer('structural_score'), // 1–10
    aestheticScore: integer('aesthetic_score'), // 1–10
    environmentalScore: integer('environmental_score'), // 1–10
    overallGrade: text('overall_grade'), // A | B | C | D
    reportNotes: text('report_notes'),
    photoUrls: jsonb('photo_urls').$type<string[]>().default([]),
    blockchainTxHash: text('blockchain_tx_hash'),
    disputed: boolean('disputed').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_quality_reports_passport').on(table.passportId),
    index('idx_quality_reports_inspector').on(table.inspectorId),
  ],
);

export type QualityReport = typeof qualityReports.$inferSelect;
export type NewQualityReport = typeof qualityReports.$inferInsert;

// ── Sensor Readings ───────────────────────────────────────────────────────────
// NOTE: In production, partition by RANGE (created_at) monthly.
// Partitioning is handled via raw SQL migration after initial schema creation.

export const sensorReadings = pgTable(
  'sensor_readings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    passportId: uuid('passport_id').references(() => materialPassports.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    sensorType: text('sensor_type').notNull(),
    readingValue: jsonb('reading_value').$type<Record<string, unknown>>().notNull(),
    blockchainDataHash: text('blockchain_data_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_sensor_readings_passport').on(table.passportId),
    index('idx_sensor_readings_device').on(table.deviceId),
    index('idx_sensor_readings_created').on(table.createdAt),
  ],
);

export type SensorReading = typeof sensorReadings.$inferSelect;
export type NewSensorReading = typeof sensorReadings.$inferInsert;

// ── Feedback Submissions ─────────────────────────────────────────────────────

export const feedbackSubmissions = pgTable(
  'feedback_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    rating: integer('rating').notNull(), // 1–5
    category: text('category').notNull(), // bug | ux | feature | general
    message: text('message').notNull(),
    pageUrl: text('page_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_feedback_user').on(table.userId),
    index('idx_feedback_created').on(table.createdAt),
  ],
);

export type FeedbackSubmission = typeof feedbackSubmissions.$inferSelect;
export type NewFeedbackSubmission = typeof feedbackSubmissions.$inferInsert;

// ── Governance Proposals ──────────────────────────────────────────────────────

export const governanceProposals = pgTable(
  'governance_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => users.id),
    organisationId: uuid('organisation_id').references(() => organisations.id),
    title: text('title').notNull(),
    description: text('description').notNull(),
    status: text('status').notNull().default('active'),
    // active | passed | rejected | executed | cancelled
    votingEndsAt: timestamp('voting_ends_at', { withTimezone: true }).notNull(),
    forVotes: numeric('for_votes').notNull().default('0'),
    againstVotes: numeric('against_votes').notNull().default('0'),
    quorumSnapshot: numeric('quorum_snapshot').notNull().default('0'),
    quorumReached: boolean('quorum_reached').notNull().default(false),
    blockchainTxHash: text('blockchain_tx_hash'),
    blockchainProposalId: text('blockchain_proposal_id'), // bytes32 hex
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_gov_proposals_status').on(table.status),
    index('idx_gov_proposals_creator').on(table.creatorId),
  ],
);

export type GovernanceProposalRow = typeof governanceProposals.$inferSelect;
export type NewGovernanceProposal = typeof governanceProposals.$inferInsert;

// ── Governance Votes ──────────────────────────────────────────────────────────

export const governanceVotes = pgTable(
  'governance_votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => governanceProposals.id),
    voterId: uuid('voter_id')
      .notNull()
      .references(() => users.id),
    support: boolean('support').notNull(),
    weight: numeric('weight').notNull().default('1'),
    blockchainTxHash: text('blockchain_tx_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_gov_votes_proposal').on(table.proposalId),
    unique('gov_votes_unique').on(table.proposalId, table.voterId),
  ],
);

export type GovernanceVoteRow = typeof governanceVotes.$inferSelect;
export type NewGovernanceVote = typeof governanceVotes.$inferInsert;

// ── Relations ────────────────────────────────────────────────────────────────

export const organisationsRelations = relations(organisations, ({ many }) => ({
  users: many(users),
  materialPassports: many(materialPassports),
  listings: many(listings),
  auditEvents: many(auditEvents),
  blockchainTransactions: many(blockchainTransactions),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [users.organisationId],
    references: [organisations.id],
  }),
  accessRequests: many(betaAccessRequests, { relationName: 'requester' }),
  reviewedAccessRequests: many(betaAccessRequests, { relationName: 'reviewer' }),
  passportsRegistered: many(materialPassports),
  listings: many(listings),
  auditEvents: many(auditEvents),
  blockchainTransactions: many(blockchainTransactions),
  buyerTransactions: many(transactions, { relationName: 'buyer' }),
  sellerTransactions: many(transactions, { relationName: 'seller' }),
  feedbackSubmissions: many(feedbackSubmissions),
}));

export const betaAccessRequestsRelations = relations(betaAccessRequests, ({ one }) => ({
  user: one(users, {
    fields: [betaAccessRequests.userId],
    references: [users.id],
    relationName: 'requester',
  }),
  targetOrganisation: one(organisations, {
    fields: [betaAccessRequests.targetOrganisationId],
    references: [organisations.id],
  }),
  reviewer: one(users, {
    fields: [betaAccessRequests.reviewedBy],
    references: [users.id],
    relationName: 'reviewer',
  }),
}));

export const materialPassportsRelations = relations(materialPassports, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [materialPassports.organisationId],
    references: [organisations.id],
  }),
  registeredByUser: one(users, {
    fields: [materialPassports.registeredBy],
    references: [users.id],
  }),
  events: many(passportEvents),
  listings: many(listings),
  qualityReports: many(qualityReports),
  sensorReadings: many(sensorReadings),
}));

export const passportEventsRelations = relations(passportEvents, ({ one }) => ({
  passport: one(materialPassports, {
    fields: [passportEvents.passportId],
    references: [materialPassports.id],
  }),
  actor: one(users, {
    fields: [passportEvents.actorId],
    references: [users.id],
  }),
}));

export const auditEventsRelations = relations(auditEvents, ({ one }) => ({
  actor: one(users, {
    fields: [auditEvents.actorId],
    references: [users.id],
  }),
  organisation: one(organisations, {
    fields: [auditEvents.organisationId],
    references: [organisations.id],
  }),
}));

export const blockchainTransactionsRelations = relations(blockchainTransactions, ({ one }) => ({
  actor: one(users, {
    fields: [blockchainTransactions.actorId],
    references: [users.id],
  }),
  organisation: one(organisations, {
    fields: [blockchainTransactions.organisationId],
    references: [organisations.id],
  }),
}));

export const listingsRelations = relations(listings, ({ one, many }) => ({
  passport: one(materialPassports, {
    fields: [listings.passportId],
    references: [materialPassports.id],
  }),
  organisation: one(organisations, {
    fields: [listings.organisationId],
    references: [organisations.id],
  }),
  seller: one(users, {
    fields: [listings.sellerId],
    references: [users.id],
  }),
  transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  listing: one(listings, {
    fields: [transactions.listingId],
    references: [listings.id],
  }),
  buyer: one(users, {
    fields: [transactions.buyerId],
    references: [users.id],
    relationName: 'buyer',
  }),
  seller: one(users, {
    fields: [transactions.sellerId],
    references: [users.id],
    relationName: 'seller',
  }),
}));

export const qualityReportsRelations = relations(qualityReports, ({ one }) => ({
  passport: one(materialPassports, {
    fields: [qualityReports.passportId],
    references: [materialPassports.id],
  }),
  inspector: one(users, {
    fields: [qualityReports.inspectorId],
    references: [users.id],
  }),
}));

export const sensorReadingsRelations = relations(sensorReadings, ({ one }) => ({
  passport: one(materialPassports, {
    fields: [sensorReadings.passportId],
    references: [materialPassports.id],
  }),
}));

export const feedbackSubmissionsRelations = relations(feedbackSubmissions, ({ one }) => ({
  user: one(users, {
    fields: [feedbackSubmissions.userId],
    references: [users.id],
  }),
}));

export const governanceProposalsRelations = relations(governanceProposals, ({ one, many }) => ({
  creator: one(users, {
    fields: [governanceProposals.creatorId],
    references: [users.id],
  }),
  organisation: one(organisations, {
    fields: [governanceProposals.organisationId],
    references: [organisations.id],
  }),
  votes: many(governanceVotes),
}));

export const governanceVotesRelations = relations(governanceVotes, ({ one }) => ({
  proposal: one(governanceProposals, {
    fields: [governanceVotes.proposalId],
    references: [governanceProposals.id],
  }),
  voter: one(users, {
    fields: [governanceVotes.voterId],
    references: [users.id],
  }),
}));
