# TRACE Prototype Specification

> **Transforming Resources and Advancing Circular Economy**
> Blockchain-enabled digital marketplace for construction material reuse hubs
> Version 2.0 — February 2026
> **Document status:** This is the February 2026 product vision and target
> architecture, not implementation-status documentation. See the
> [README](./README.md) and repository source, tests, and public documentation
> for implemented behavior. Governance prototype work is maintained separately
> on the `erc20+governance` branch.

---

## 1. Project Context

**Problem:** Scotland's construction circularity rate is 1.3%. Construction accounts for ~50% of material consumption but almost nothing is reused in original form.

**Solution:** TRACE builds a blockchain-based digital marketplace connecting construction material reuse hubs, enabling EU DPP-compliant material passports, transparent quality assurance, and commons governance.

**Partners:** Robert Gordon University (Dr Michele Victoria), Heriot-Watt University (Dr Theodoros Dounas), Adventurous Systems Ltd, Stirling Reuse Hub, BE-ST.

**Funding:** Scotland Beyond Net Zero. Budget: £13,502.75. Duration: 12 months (Aug 2025–Jul 2026).

**Blockchain:** VeChainThor (EVM-compatible, Shanghai hardfork). Local dev on Thor Solo node. Testnet for staging. Mainnet for production.

---

## 2. Architecture Overview

Three layers:

```
┌─────────────────────────────────────────────────────┐
│  EXTERNAL ACTORS                                    │
│  Hub Staff · Buyer · Inspector · IoT · Hub Admin    │
│  Public (QR Scan)                                   │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│  OFF-CHAIN PLATFORM                                 │
│  Next.js Frontend (PWA) → API Gateway (Fastify)     │
│  PostgreSQL · Meilisearch · MinIO · MQTT            │
│  EU DPP Layer: JSON-LD / GS1 / W3C VC              │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│  ON-CHAIN — VeChainThor                             │
│  MaterialRegistry · CircularMarketplace · CBT       │
│  QualityAssurance · IoTOracle · TraceGovernance     │
│  HubRegistry                                        │
└─────────────────────────────────────────────────────┘
```

**Philosophy:** "Thin on-chain, rich off-chain." Full passport data in PostgreSQL. Blockchain stores: content hashes (tamper-evidence), ownership records, escrow logic, governance votes.

---

## 3. Technology Stack

| Layer               | Technology                                           | Rationale                                                        |
| ------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| **Backend**         | Node.js + TypeScript + Fastify                       | Type safety for material data integrity; Fastify for performance |
| **Frontend**        | React 18 + Next.js 14 (App Router)                   | SSR for public pages, PWA for mobile                             |
| **Styling**         | Tailwind CSS + shadcn/ui                             | Utility-first, consistent components                             |
| **Database**        | PostgreSQL 16 + JSONB                                | Structured + flexible schema, PostGIS for geo                    |
| **Search**          | Meilisearch                                          | Full-text material search with typo tolerance                    |
| **Object Storage**  | MinIO (S3-compatible)                                | Photos, PDFs, certificates                                       |
| **Cache**           | Redis                                                | Sessions, rate limiting, pub/sub                                 |
| **Blockchain**      | VeChainThor (EVM, Shanghai)                          | Enterprise-grade, fee delegation, multi-clause tx                |
| **Smart Contracts** | Solidity ^0.8.20 + Hardhat                           | Standard EVM tooling via VeChain Hardhat plugin                  |
| **Blockchain SDK**  | @vechain/sdk-js                                      | Official VeChain JS SDK for frontend/backend                     |
| **ORM**             | Drizzle ORM                                          | Type-safe, lightweight, PostgreSQL-native                        |
| **Forms**           | React Hook Form + Zod                                | Schema validation shared frontend/backend                        |
| **Maps**            | Leaflet                                              | Hub locations, delivery radius                                   |
| **QR**              | html5-qrcode + qrcode (generation)                   | Browser-native scanning, server-side generation                  |
| **Testing**         | Vitest (unit), Playwright (E2E), Hardhat (contracts) | Full coverage across layers                                      |

### VeChain-Specific Advantages

- **Fee Delegation:** Hub operators sponsor gas fees for staff/buyers. Users never need VTHO. Critical for non-crypto-native construction workers.
- **Multi-Clause Transactions:** Batch multiple contract calls in one atomic transaction. E.g., register passport hash + transfer ownership + mint CBT reward in a single tx.
- **Two-Token Model:** VET/VTHO separation means predictable gas costs independent of market volatility.
- **Thor Solo Node:** Docker-based local blockchain for development. On-demand block creation for fast iteration.

---

## 4. EU DPP Regulatory Compliance

The material passport schema is EU DPP-compliant from day one:

### 4.1 Applicable Regulations

| Regulation                  | Status            | Relevance                                                            |
| --------------------------- | ----------------- | -------------------------------------------------------------------- |
| ESPR (EU 2024/1781)         | In force Jul 2024 | Horizontal DPP framework: data formats, access controls, identifiers |
| CPR Revision (EU 2024/1305) | In force Jan 2025 | Construction-specific DPPs, CE marking integration                   |
| EPBD Recast 2024            | Adopted           | Building renovation passports                                        |
| UK Building Safety Act 2022 | In force          | Golden thread of building information                                |

### 4.2 Technical Standards Implemented

- **Identifiers:** GS1 GTIN-14 with serial-level granularity
- **Resolution:** GS1 Digital Link URIs (QR code → passport view)
- **Data Format:** JSON-LD aligned with Schema.org and GS1 Web Vocabulary
- **Certifications:** W3C Verifiable Credentials (VCDM 2.0)
- **Environmental Data:** EN 15804+A2 for EPD lifecycle assessment
- **Supply Chain Events:** EPCIS 2.0 vocabulary
- **Access Tiers:** Public → Professional → Regulatory → Hub Admin

### 4.3 The Regulatory Gap We Address

EU DPP regulations assume linear supply chains (manufacturer → market). They provide no governance model for reclaimed materials re-entering circulation through community hubs. TRACE fills this gap using Ostrom's commons governance principles implemented as smart contracts.

---

## 5. Material Passport Data Model

### 5.1 Core Schema (EU DPP Compliant — For ANY Construction Material)

```typescript
interface MaterialPassport {
  // Identity
  passportId: string; // UUID v7
  gtin: string; // GS1 GTIN-14
  serialNumber: string;
  digitalLinkUri: string; // GS1 Digital Link URI
  dataCarrierId: string; // QR code reference

  // Product
  productName: string;
  productCategory: MaterialCategory; // 10 L1, 80+ L2 categories
  materialComposition: MaterialComponent[];
  dimensions: Dimensions;
  technicalSpecs: Record<string, unknown>; // JSONB flexible

  // Manufacturer
  manufacturerName: string;
  facilityId: string; // GLN
  countryOfOrigin: string; // ISO 3166
  productionDate: Date;

  // Environmental (mandatory fields expanding 2026-2030)
  gwpTotal?: number; // kgCO2e — mandatory 2026+
  embodiedCarbon?: number; // mandatory 2030+
  epdReference?: string; // URI to EN 15804+A2 EPD
  recycledContent?: number; // percentage

  // Compliance
  ceMarking: boolean;
  declarationOfPerformance?: string; // URI
  harmonisedStandard?: string;
  conformityCertificates: VerifiableCredential[];

  // Lifecycle
  currentStatus: PassportStatus;
  currentHolderId: string;
  eventLog: EPCISEvent[];
}
```

### 5.2 Circular Economy Extension (TRACE-Specific)

```typescript
interface CircularExtension {
  // Provenance
  previousBuildingId?: string;
  deconstructionDate?: Date;
  deconstructionMethod?: 'selective' | 'mechanical' | 'manual' | 'mixed';
  reclaimedBy?: string;

  // Condition
  conditionAssessment: ConditionAssessment;
  conditionGrade: 'A' | 'B' | 'C' | 'D';
  conditionPhotos: string[]; // URIs
  conditionNotes?: string;

  // Circular Metrics
  originalAge?: number; // years
  remainingLifeEstimate?: number;
  carbonSavingsVsNew?: number; // kgCO2e
  circularityScore?: number; // 0-100
  reuseCount: number;
  reuseSuitability: string[];
  handlingRequirements?: string;
  hazardousSubstances: HazardousSubstance[];
}
```

### 5.3 Material Categories

10 Level 1 categories with 80+ Level 2 subcategories:

1. **Structural Steel** — I-beams, H-beams, channels, angles, plates, hollow sections, connections
2. **Structural Timber** — Softwood, hardwood, glulam, CLT, LVL, trusses
3. **Masonry** — Clay brick, concrete block, natural stone, engineered stone
4. **Roofing** — Slate, clay tile, concrete tile, metal sheet, membrane
5. **Cladding & Facades** — Brick slips, timber cladding, metal panels, curtain wall, rainscreen
6. **Insulation** — Mineral wool, rigid board, natural fibre, spray foam
7. **Doors & Windows** — External doors, internal doors, windows, rooflights, ironmongery
8. **Flooring** — Hardwood, engineered, tile, stone, raised access
9. **MEP Components** — Radiators, boilers, sanitaryware, electrical, pipework
10. **Fixings & Fittings** — Structural fixings, brackets, shelving, handrails, signage

---

## 6. Database Schema (PostgreSQL)

### 6.1 Core Tables

```sql
-- Multi-tenancy: every table with hub-specific data includes organisation_id
-- PostgreSQL Row Level Security enforces tenant isolation

CREATE TABLE organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('hub', 'manufacturer', 'contractor', 'certifier')),
  slug TEXT UNIQUE NOT NULL,          -- subdomain: stirling.trace.eco
  branding JSONB DEFAULT '{}',        -- logo, colours, description
  verified BOOLEAN DEFAULT false,
  blockchain_address TEXT,            -- VeChain address
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('platform_admin', 'hub_admin', 'hub_staff', 'supplier', 'buyer', 'inspector')),
  organisation_id UUID REFERENCES organisations(id),
  blockchain_address TEXT,
  notification_prefs JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE material_passports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),

  -- EU DPP Identity
  gtin TEXT,
  serial_number TEXT,
  digital_link_uri TEXT,
  qr_code_url TEXT,

  -- Product
  product_name TEXT NOT NULL,
  category_l1 TEXT NOT NULL,
  category_l2 TEXT,
  material_composition JSONB DEFAULT '[]',
  dimensions JSONB,                   -- {length, width, height, weight, unit}
  technical_specs JSONB DEFAULT '{}',

  -- Manufacturer / Source
  manufacturer_name TEXT,
  country_of_origin TEXT,
  production_date DATE,

  -- Environmental
  gwp_total NUMERIC,                  -- kgCO2e
  embodied_carbon NUMERIC,
  recycled_content NUMERIC,

  -- Compliance
  ce_marking BOOLEAN DEFAULT false,

  -- Circular Extension
  previous_building_id TEXT,
  deconstruction_date DATE,
  condition_grade TEXT CHECK (condition_grade IN ('A', 'B', 'C', 'D')),
  condition_notes TEXT,
  carbon_savings_vs_new NUMERIC,
  circularity_score INTEGER,
  reuse_count INTEGER DEFAULT 0,

  -- Flexible attributes
  custom_attributes JSONB DEFAULT '{}',

  -- Status
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'listed', 'reserved', 'sold', 'installed', 'decommissioned')),

  -- Blockchain anchoring
  blockchain_tx_hash TEXT,
  blockchain_passport_hash TEXT,
  blockchain_anchored_at TIMESTAMPTZ,

  -- Metadata
  registered_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE passport_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id UUID NOT NULL REFERENCES material_passports(id),
  event_type TEXT NOT NULL,           -- EPCIS 2.0 vocabulary
  event_data JSONB NOT NULL,
  actor_id UUID REFERENCES users(id),
  blockchain_tx_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id UUID NOT NULL REFERENCES material_passports(id),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  seller_id UUID NOT NULL REFERENCES users(id),
  price_pence INTEGER NOT NULL,       -- GBP pence
  currency TEXT DEFAULT 'GBP',
  quantity INTEGER DEFAULT 1,
  shipping_options JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'reserved', 'sold', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id),
  buyer_id UUID NOT NULL REFERENCES users(id),
  seller_id UUID NOT NULL REFERENCES users(id),
  amount_pence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'disputed', 'resolved', 'completed', 'cancelled')),
  dispute_deadline TIMESTAMPTZ,
  blockchain_tx_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE quality_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id UUID NOT NULL REFERENCES material_passports(id),
  inspector_id UUID NOT NULL REFERENCES users(id),
  structural_score INTEGER CHECK (structural_score BETWEEN 1 AND 10),
  aesthetic_score INTEGER CHECK (aesthetic_score BETWEEN 1 AND 10),
  environmental_score INTEGER CHECK (environmental_score BETWEEN 1 AND 10),
  overall_grade TEXT CHECK (overall_grade IN ('A', 'B', 'C', 'D')),
  report_notes TEXT,
  photo_urls TEXT[],
  blockchain_tx_hash TEXT,
  disputed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sensor_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id UUID REFERENCES material_passports(id),
  device_id TEXT NOT NULL,
  sensor_type TEXT NOT NULL,
  reading_value JSONB NOT NULL,
  blockchain_data_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Indexes
CREATE INDEX idx_passports_org ON material_passports(organisation_id);
CREATE INDEX idx_passports_status ON material_passports(status);
CREATE INDEX idx_passports_category ON material_passports(category_l1, category_l2);
CREATE INDEX idx_passports_gtin ON material_passports(gtin);
CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_org ON listings(organisation_id);
CREATE INDEX idx_passport_events_passport ON passport_events(passport_id);

-- Full-text search
CREATE INDEX idx_passports_search ON material_passports
  USING GIN (to_tsvector('english', product_name || ' ' || COALESCE(category_l1, '') || ' ' || COALESCE(category_l2, '') || ' ' || COALESCE(condition_notes, '')));
```

---

## 7. Smart Contract Architecture

### 7.1 Overview

Seven contracts on VeChainThor, each mapped to Ostrom's commons governance principles:

| Contract                 | Ostrom Principle         | Purpose                                            |
| ------------------------ | ------------------------ | -------------------------------------------------- |
| MaterialRegistry         | P1: Boundaries           | Passport hash anchoring, entry criteria, ownership |
| CircularMarketplace      | P2: Congruence           | Escrow, offers, fee distribution                   |
| CircularBuildToken (CBT) | P5: Sanctions            | ERC-20, staking, rewards, reputation               |
| QualityAssurance         | P4: Monitoring           | Inspector reports, reputation scoring              |
| IoTOracle                | P4: Automated            | Sensor data hashes, device registry                |
| TraceGovernance          | P3+P6: Choice/Conflict   | DAO voting, dispute arbitration                    |
| HubRegistry              | P7+P8: Rights/Federation | Hub verification, cross-hub protocols              |

### 7.2 VeChain-Specific Implementation Notes

**Solidity version:** `^0.8.20` with `evmVersion: 'shanghai'`

**Hardhat config:**

```typescript
import '@vechain/sdk-hardhat-plugin';
import { type HttpNetworkConfig } from 'hardhat/types';

const config = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'shanghai',
    },
  },
  networks: {
    vechain_solo: {
      url: 'http://localhost:8669',
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
    } satisfies HttpNetworkConfig,
    vechain_testnet: {
      url: 'https://testnet.vechain.org',
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      delegator: undefined, // Fee delegation config if needed
    } satisfies HttpNetworkConfig,
    vechain_mainnet: {
      url: 'https://mainnet.vechain.org',
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
    } satisfies HttpNetworkConfig,
  },
};
```

**Multi-clause usage:** When registering a material, use VeChain's multi-clause to batch:

1. `MaterialRegistry.registerPassport()`
2. `CircularBuildToken.mint()` (reward for registration)
3. `HubRegistry.incrementMaterialCount()`

All in one atomic transaction.

**Fee delegation:** Hub operators run a fee delegation service so staff and buyers never need VTHO wallets. The API backend handles this transparently.

### 7.3 Contract Specifications

#### MaterialRegistry.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MaterialRegistry {
    enum MaterialStatus { REGISTERED, LISTED, SOLD, INSTALLED, DECOMMISSIONED }

    struct Material {
        bytes32 passportHash;       // keccak256 of JSON-LD passport data
        address registeredBy;       // Hub that registered
        address currentHolder;      // Current custodian
        MaterialStatus status;
        uint256 timestamp;
        string digitalLinkUri;      // GS1 Digital Link
    }

    mapping(bytes32 => Material) public materials;  // materialId => Material
    mapping(address => bool) public authorisedHubs;

    event PassportRegistered(bytes32 indexed materialId, address indexed hub, bytes32 passportHash);
    event OwnershipTransferred(bytes32 indexed materialId, address indexed from, address indexed to);
    event StatusUpdated(bytes32 indexed materialId, MaterialStatus newStatus);

    function registerPassport(bytes32 materialId, bytes32 passportHash, string calldata uri) external;
    function verifyIntegrity(bytes32 materialId, bytes32 expectedHash) external view returns (bool);
    function transferOwnership(bytes32 materialId, address newHolder) external;
    function updateStatus(bytes32 materialId, MaterialStatus newStatus) external;
    function updateHash(bytes32 materialId, bytes32 newHash) external;
}
```

#### CircularMarketplace.sol

```solidity
contract CircularMarketplace {
    enum ListingStatus { ACTIVE, RESERVED, SOLD, EXPIRED, CANCELLED }
    enum TxStatus { PENDING, CONFIRMED, DISPUTED, RESOLVED, COMPLETED }

    struct Listing {
        bytes32 materialId;
        address seller;
        uint256 priceWei;
        uint256 escrowCBT;         // CBT staked as quality guarantee
        ListingStatus status;
        uint256 expiry;
    }

    struct Transaction {
        bytes32 listingId;
        address buyer;
        uint256 amount;
        TxStatus status;
        uint256 disputeDeadline;    // 48hr after delivery confirmation
    }

    function createListing(bytes32 materialId, uint256 price, uint256 expiry) external;
    function placeOffer(bytes32 listingId) external payable;
    function confirmDelivery(bytes32 txId) external;
    function releaseFunds(bytes32 txId) external;
    function flagDispute(bytes32 txId, string calldata evidence) external;
}
```

#### CircularBuildToken.sol

```solidity
// ERC-20 utility token — NOT a payment currency
contract CircularBuildToken is ERC20 {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    struct StakingPosition {
        uint256 amount;
        uint256 lockPeriod;
        bytes32 materialId;        // Quality guarantee staking
    }

    mapping(address => StakingPosition[]) public stakingPositions;

    function mint(address to, uint256 amount) external;          // Minter only
    function stakeForQuality(bytes32 materialId, uint256 amount) external;
    function slashStake(bytes32 materialId) external;            // Dispute resolution
}
```

#### QualityAssurance.sol, IoTOracle.sol, TraceGovernance.sol, HubRegistry.sol

See Phase 1 contract specifications in the full spec document. All follow the same pattern: minimal on-chain data, events for indexing, cross-contract references via materialId (bytes32).

### 7.4 Phased Smart Contract Roadmap

| Phase            | Contracts                                                                                             | Status       | Description                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------- |
| **1: Prototype** | MaterialRegistry, CircularMarketplace, CBT, QualityAssurance, IoTOracle, TraceGovernance, HubRegistry | Building now | Minimum viable on-chain layer                  |
| **2: Scale**     | BuildingNFT (ERC-721), ComponentNFT (ERC-3643), CarbonCreditNFT, MarketOracle, CarbonOracle           | Designed     | Building-level tokenisation, carbon accounting |
| **3: DeFi**      | ComponentMarketplace (AMM), ComponentLending, ComponentVault, DVTMarketplace, FractionalBuildingToken | Designed     | Materials as financial assets                  |
| **4: Vision**    | BuildDAI (stablecoin)                                                                                 | Conceptual   | Building-backed stablecoin                     |

Phase 1 contracts are designed with clean interfaces so Phase 2+ can reference materialId without modifying Phase 1.

---

## 8. API Design

### 8.1 Core Endpoints

```
# Material Passports
POST   /api/v1/passports                 # Create passport (Hub Staff+)
GET    /api/v1/passports/:id             # Get passport (tiered access)
PATCH  /api/v1/passports/:id             # Update passport (Hub Staff+)
GET    /api/v1/passports/:id/events      # EPCIS event history (Professional+)
GET    /api/v1/passports/:id/verify      # Verify hash against blockchain (Public)
POST   /api/v1/passports/:id/photos      # Upload photos (Hub Staff+)

# Marketplace
GET    /api/v1/marketplace/listings      # Search/filter (Public)
POST   /api/v1/marketplace/listings      # Create listing (Hub Staff+)
POST   /api/v1/marketplace/offers        # Submit offer (Buyer+)
PATCH  /api/v1/marketplace/transactions/:id  # Update tx status

# Hubs
GET    /api/v1/hubs                      # List active hubs (Public)
GET    /api/v1/hubs/:id/inventory        # Hub inventory (Hub Staff+)
GET    /api/v1/hubs/:id/analytics        # Metrics (Hub Admin+)

# GS1 Digital Link Resolver
GET    /resolve/01/:gtin/21/:serial      # Resolve to passport view (Public)

# Quality
POST   /api/v1/quality/reports           # Submit inspection (Inspector+)
GET    /api/v1/quality/reports/:passportId  # Get reports

# Governance
POST   /api/v1/governance/proposals      # Create proposal (CBT threshold)
POST   /api/v1/governance/votes          # Cast vote (CBT holder)
```

### 8.2 Authentication

JWT tokens with role-based access. Sessions stored in Redis. Blockchain operations use server-side key management (hub operator keys) with fee delegation for user-facing actions.

---

## 9. Frontend Specification

### 9.1 Design Principles

- **Mobile-first:** 375px viewport primary. Enhanced for tablet (768px) and desktop (1280px+).
- **Brutally simple:** One primary action per screen. Complex workflows as numbered steps.
- **Instant feedback:** Every action produces visual response within 100ms.
- **WCAG 2.1 AA:** High contrast, keyboard navigation, screen reader support.
- **Offline-resilient:** Service worker caches QR scanner, passport views, inventory list.

### 9.2 Key Views

**Public:** Material Passport View (QR scan landing), Marketplace Browse, Hub Directory.

**Hub Staff:** Dashboard (metrics, feed), Material Registration Wizard (step-by-step with auto-save), Inventory Manager (table/grid, bulk actions), Listing Manager, Order Manager.

**Buyer:** Search & Discovery (filters: type, condition, location, price, carbon savings), Material Detail, Orders & History.

**Admin:** Hub Configuration (branding, staff, billing), Analytics Dashboard (Sankey diagrams, environmental impact), Governance (proposals, voting, disputes).

### 9.3 PWA Features

Install to home screen, offline QR scanning, push notifications, background sync for offline edits, camera for photo capture, geolocation for nearest hubs.

---

## 10. Multi-Hub Architecture

Federated model: each hub semi-autonomous with local data sovereignty. Shared marketplace and material registry.

- **Tenant isolation:** PostgreSQL Row Level Security. Every table with `organisation_id` FK.
- **Subdomain routing:** `stirling.trace.eco`, `edinburgh.trace.eco`, etc.
- **Hub onboarding target:** Under 1 working day from registration to first material.

### Scaling Targets

| Stage                   | Hubs         | Users  | Materials | Infrastructure                    |
| ----------------------- | ------------ | ------ | --------- | --------------------------------- |
| Pilot (2026 Q1-Q3)      | 1 (Stirling) | 10-20  | 100-500   | Single server + Thor testnet      |
| Scottish (2026 Q4-2027) | 5-15         | 50-200 | 1k-10k    | Cloud auto-scaling + Thor mainnet |
| UK (2027-2028)          | 25-50        | 500-2k | 10k-100k  | CDN + read replicas               |
| EU (2029+)              | 100+         | 5k+    | 1M+       | Multi-region + sharding           |

---

## 11. User Roles

| Role           | Permissions                                                                |
| -------------- | -------------------------------------------------------------------------- |
| Platform Admin | All permissions. Hub approval, system config.                              |
| Hub Admin      | Hub config, staff management, all hub inventory, analytics, governance.    |
| Hub Staff      | Register materials, manage inventory, process orders, QR scanning.         |
| Supplier       | Submit materials for registration, view own submissions, receive payments. |
| Buyer          | Search marketplace, make offers, purchase, leave reviews.                  |
| Inspector      | Submit quality assessments, issue certificates, update grades.             |
| Public         | View public passport data, browse listings, register for account.          |

---

## 12. Development Strategy

### 12.1 Early Functional Prototype Approach

**Core principle:** Build a demonstrable vertical slice as fast as possible, then iterate.

**Vertical Slice 1 (Target: 2-3 weeks):**
Register a material → Store in DB → Anchor hash on VeChain → Generate QR code → Scan QR → View passport

This single flow proves: database works, blockchain anchoring works, QR bridge works, public viewing works.

**Vertical Slice 2 (Target: +2 weeks):**
List material for sale → Search/discover → Make offer → Accept → Complete transaction

**Vertical Slice 3 (Target: +2 weeks):**
Inspector submits quality report → Report anchored on-chain → Reputation updates → Visible on passport

Then iterate on UI polish, additional features, governance, analytics.

### 12.2 Sprint Plan

| Sprint | Duration | Deliverable                                                                                   |
| ------ | -------- | --------------------------------------------------------------------------------------------- |
| S0     | 1 week   | Monorepo scaffolding, Docker Compose (Thor Solo + PG + Redis), DB migrations, auth skeleton   |
| S1     | 2 weeks  | Material passport CRUD, blockchain anchoring, QR generation/scanning, passport public view    |
| S2     | 2 weeks  | Marketplace: listings, search, offers, basic transaction flow                                 |
| S3     | 2 weeks  | Quality reports, inspector workflow, condition grading                                        |
| S4     | 2 weeks  | Hub staff UI polish, material registration wizard, inventory manager. **UAT 1 with Stirling** |
| S5     | 2 weeks  | CBT token deployment, staking, rewards, governance skeleton                                   |
| S6     | 2 weeks  | Multi-hub: tenant isolation, subdomain routing, hub onboarding                                |
| S7     | 2 weeks  | Analytics dashboard, environmental impact metrics, export                                     |
| S8     | 2 weeks  | Full marketplace with escrow, dispute flow. **UAT 2 with Stirling**                           |
| S9     | 2 weeks  | IoT: MQTT broker, sensor registration, simulated data                                         |
| S10    | 2 weeks  | Governance: proposals, voting, dispute resolution                                             |
| S11    | 2 weeks  | Production hardening, security audit, performance optimisation. **UAT 3**                     |
| S12    | 2 weeks  | Mainnet deployment, documentation, training materials, launch                                 |

### 12.3 Repository Structure

```
trace/
├── packages/
│   ├── core/              # Shared types, validators, constants, material taxonomy
│   │   ├── src/
│   │   │   ├── types/     # TypeScript interfaces (passport, listing, user, etc.)
│   │   │   ├── validators/# Zod schemas (shared frontend/backend validation)
│   │   │   ├── constants/ # Material categories, status enums, config
│   │   │   └── utils/     # Common utilities
│   │   └── package.json
│   ├── db/                # Database schema, migrations, seed data
│   │   ├── drizzle/       # Drizzle ORM schema definitions
│   │   ├── migrations/    # SQL migrations
│   │   ├── seed/          # Reference data (categories, test data)
│   │   └── package.json
│   ├── api/               # Backend API (Fastify)
│   │   ├── src/
│   │   │   ├── modules/   # auth, hub, passport, marketplace, blockchain, quality, governance
│   │   │   ├── middleware/ # auth, rate-limit, tenant-isolation, error-handling
│   │   │   └── server.ts
│   │   └── package.json
│   ├── web/               # Next.js frontend (PWA)
│   │   ├── app/           # Next.js App Router pages
│   │   ├── components/    # React components
│   │   ├── lib/           # Client utilities, API client, blockchain hooks
│   │   └── package.json
│   ├── contracts/         # Solidity smart contracts (Hardhat project)
│   │   ├── contracts/     # .sol files
│   │   ├── test/          # Contract tests
│   │   ├── scripts/       # Deploy scripts
│   │   ├── hardhat.config.ts
│   │   └── package.json
│   └── sdk/               # TypeScript SDK for API consumers
│       └── package.json
├── docker/
│   ├── docker-compose.yml        # Thor Solo + PostgreSQL + Redis + MinIO + Meilisearch
│   ├── docker-compose.prod.yml
│   └── Dockerfile.api
├── SPEC.md                # This file
├── package.json           # Workspace root
├── pnpm-workspace.yaml
└── turbo.json             # Turborepo config
```

---

## 13. Testing Strategy

- **Unit:** Vitest, 80%+ coverage for business logic (passport validation, pricing, permissions, escrow state machine)
- **Integration:** Supertest + real PostgreSQL, all API endpoints
- **Smart Contracts:** Hardhat + Chai, 100% function coverage. Tests run against Thor Solo node.
- **E2E:** Playwright, critical user journeys (register material, marketplace purchase, QR scan)
- **Accessibility:** axe-core, WCAG 2.1 AA
- **UAT:** Stirling Reuse Hub at S4, S8, S11

---

## 14. Deployment

### Development

Docker Compose: Thor Solo + PostgreSQL + Redis + MinIO + Meilisearch. All on `localhost`.

### Staging

Cloud deployment (Railway/Render/Fly.io). VeChain Testnet. Synthetic data.

### Production

VeChain Mainnet. Managed PostgreSQL. Cloudflare for CDN/DNS/DDoS. Sentry for errors.

---

## 15. Ostrom Principles → TRACE Mapping

| Principle                 | Workshop Evidence                                 | TRACE Feature                            |
| ------------------------- | ------------------------------------------------- | ---------------------------------------- |
| P1: Boundaries            | Material viability hierarchies; grading standards | MaterialRegistry entry criteria          |
| P2: Congruence            | Cost-benefit mismatch; small hub burden           | CBT rewards proportional to contribution |
| P3: Collective Choice     | All groups want voice in standards                | GovernanceDAO proposal voting            |
| P4: Monitoring            | Trust as top barrier; post-Grenfell               | QualityAssurance + IoTOracle             |
| P5: Graduated Sanctions   | Accountability without exclusion                  | CBT staking/slashing                     |
| P6: Conflict Resolution   | Informal disputes need structure                  | GovernanceDAO arbitration                |
| P7: Recognition of Rights | Hubs not recognised as economic operators         | HubRegistry on-chain verification        |
| P8: Nested Enterprises    | Local independence + shared marketplace           | Federated hub architecture               |
