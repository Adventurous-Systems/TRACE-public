# TRACE — Transforming Resources and Advancing Circular Economy

[TRACE](https://trace.construction/) is a blockchain-enabled digital marketplace for construction material reuse hubs. It issues EU DPP-compliant material passports, anchors integrity proofs on VeChainThor, and governs the system through Ostrom commons principles via smart contracts.

Read [`SPEC.md`](./SPEC.md) for the February 2026 product vision,
[`docs/AccessManagement.md`](./docs/AccessManagement.md) for the public signup
and access-review flow, and [`docs/research/`](./docs/research/) for retained
research methods and diagrams. Security reports should follow
[`SECURITY.md`](./SECURITY.md); contributions should follow
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## Research Team & Partners

**Lead Researchers:**

- Dr Michele Victoria — Lecturer, Robert Gordon University, Aberdeen
- Dr Theodoros Dounas — Associate Professor, Heriot-Watt University, Edinburgh

**Partners:**

- Stirling Reuse Hub (SRH) — Operational insights and real-world testing
- [Adventurous Systems](https://adventurous.systems) — Digital marketplace, smart contract development, and prototype hosting

**Funding:** Scotland Beyond Net Zero · Budget: £13,502.75 · Duration: Aug 2025–Jul 2026

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  ACTORS: Hub Staff · Buyer · Inspector · Public     │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│  OFF-CHAIN                                          │
│  Next.js 14 PWA → Fastify API                       │
│  PostgreSQL · Redis · MinIO                         │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│  ON-CHAIN — VeChainThor                             │
│  MaterialRegistry · CircularMarketplace             │
│  QualityAssurance                                   │
└─────────────────────────────────────────────────────┘
```

**Philosophy:** Thin on-chain, rich off-chain. Full passport data in PostgreSQL. Blockchain stores content hashes, ownership records, and governance state.

---

## Monorepo Structure

```
packages/core/        → Shared types, Zod validators, constants, enums
packages/db/          → Drizzle ORM schema, migrations, seed data
packages/api/         → Fastify backend (modules: auth, passport, marketplace, quality)
packages/web/         → Next.js 14 App Router frontend (PWA)
packages/contracts/   → Solidity smart contracts + Hardhat (VeChain plugin)
packages/sdk/         → TypeScript SDK for external consumers
```

---

## Build Status

| Sprint   | Focus                                                                 | Status      |
| -------- | --------------------------------------------------------------------- | ----------- |
| Sprint 0 | Infrastructure, DB schema, API skeleton                               | ✅ Complete |
| Sprint 1 | Material passport CRUD · blockchain anchor · QR code · public view    | ✅ Complete |
| Sprint 2 | Marketplace listings · transactions · CircularMarketplace.sol         | ✅ Complete |
| Sprint 3 | Quality reports · inspector workflow · access management · PWA polish | ✅ Complete |
| Sprint 4 | Governance · CBT token · DAO voting                                   | 🗓 Planned  |
| Sprint 5 | IoT sensor oracle · automated grading                                 | 🗓 Planned  |
| Sprint 6 | Analytics dashboard · environmental metrics                           | 🗓 Planned  |

### What's Working (Sprints 0–3)

**Infrastructure**

- Docker Compose: Thor Solo (VeChain), PostgreSQL, Redis, MinIO
  (a Meilisearch container is also provisioned but **unused** — no application
  code queries it; marketplace search is Postgres full-text. Slated for removal.)
- Full monorepo: pnpm workspaces, TypeScript strict mode throughout

**Smart Contracts (VeChainThor)**

- `MaterialRegistry.sol` — Passport hash anchoring, ownership tracking, batch ops
- `CircularMarketplace.sol` — Listing and transaction records on-chain

**API (Fastify — port 3001)**

- `POST/GET/PATCH /api/v1/passports` — Material passport CRUD
- `GET /api/v1/passports/:id/verify` — Blockchain hash verification
- `GET/POST /api/v1/marketplace/listings` — Public browse + hub listing management
- `POST /api/v1/marketplace/offers` — Buyer offer submission
- `GET/PATCH /api/v1/marketplace/transactions` — Order lifecycle management
- `POST /api/v1/auth/register` — Public buyer signup
- `POST /api/v1/access-requests` — Buyer request for seller or beta access
- `GET/PATCH /api/v1/access-requests` — Platform-admin review and management flow
- Background worker: BullMQ → VeChain anchor on passport creation

**Frontend (Next.js — port 3000)**

- `/` — Public homepage
- `/marketplace` — Public material browse with search/filter
- `/passport/[id]` — Public passport view (QR scan landing)
- `/scan` — Camera QR scanner
- `/login` — JWT authentication
- `/register` — Public buyer signup
- `/access-request` — Buyer request flow for seller or beta access
- `/dashboard` — Hub staff overview
- `/admin/access-requests` — Platform admin access management
- `/passports` — Inventory management
- `/passports/new` — 5-step material registration wizard
- `/passports/[id]` — Passport detail with blockchain status
- `/listings` — Hub listing management
- `/listings/new` — Create listing form
- `/transactions` — Order management

### Sprint 3 Delivered

- **Quality API:** `POST /api/v1/quality/reports`, `GET /api/v1/quality/reports/:passportId`
- **Access management:** Public signup → access request → platform admin review/approve/revoke
- **Feedback widget:** Floating button on all dashboard pages; platform admin review at `/admin/feedback`
- **Blockchain simulation:** `DEMO_SIMULATE_ANCHOR=true` — tamper-evident fingerprint (keccak256) + `GET /passports/:id/verify-integrity` recompute-and-compare
- **PWA:** Real logo, manifest, service worker, mobile-first
- **E2E suite:** Playwright functional, visual-regression, smoke, and a11y crawls

---

## Quick Start

Prerequisites: Docker with Compose, Node.js 20 or newer, and pnpm 9 or newer.

```bash
# Create a local environment file. This sets COMPOSE_PROJECT_NAME=trace-dev so
# a development checkout cannot collide with a deployed TRACE Compose project.
cp .env.example .env

# Start infrastructure
docker compose up -d

# Install exactly the locked dependency set, then migrate and seed
pnpm install --frozen-lockfile
pnpm --filter @trace/db migrate
pnpm --filter @trace/db seed

# Dev servers
pnpm --filter @trace/api dev   # http://localhost:3001
pnpm --filter @trace/web dev   # http://localhost:3000
```

**Test credentials (local dev seed):**

| Role           | Email                    | Password source                |
| -------------- | ------------------------ | ------------------------------ |
| Platform Admin | platform@trace.eco       | `DEMO_PLATFORM_ADMIN_PASSWORD` |
| Hub Admin      | admin@stirlingreuse.com  | `DEMO_HUB_ADMIN_PASSWORD`      |
| Hub Staff      | staff@stirlingreuse.com  | `DEMO_HUB_STAFF_PASSWORD`      |
| Inspector      | inspector@trace.eco      | `DEMO_INSPECTOR_PASSWORD`      |
| Buyer          | buyer@example.com        | `DEMO_BUYER_PASSWORD`          |
| Supplier       | ada.lovelace@example.com | `DEMO_SUPPLIER_PASSWORD`       |
| Supplier (2nd) | demo.supplier2@trace.eco | `DEMO_SUPPLIER2_PASSWORD`      |
| Applicant      | demo.applicant@trace.eco | `DEMO_APPLICANT_PASSWORD`      |

These are disposable development fixtures defined by
`packages/core/src/constants/demo-personas.ts`; they are not production
accounts or reusable credentials. Passwords are supplied through `.env` and
must be unique outside local development. Never commit a populated `.env`.

**Public auth notes:**

- `/register` creates a public `buyer` account only.
- Buyers can submit `/access-request` to request `hub_staff` or `hub_admin` access.
- `platform_admin` reviews requests at `/admin/access-requests`.
- Pending requests can be edited, approved, or rejected without hard delete.
- Approved users can be reassigned between `hub_staff` and `hub_admin`, moved between organisations, or revoked back to `buyer`.
- Revoked or rejected buyers can start the request flow again from the beginning.
- Elevated roles are approved internally and assigned with an organisation; they are not self-service.

---

## Key Design Decisions

1. **VeChainThor** over Base/Optimism — enterprise focus, fee delegation (users need no crypto), multi-clause batch transactions, sustainability alignment
2. **Fastify** over Express — 2-3x faster, built-in schema validation, TypeScript-first
3. **Drizzle** over Prisma — lighter, SQL-first, better for JSONB
4. **Modular monolith** — single deployable, clean module boundaries, extractable to microservices later
5. **PWA** over native apps — single codebase, no app store friction, camera + offline via browser
6. **Material passport schema is universal** — designed for any EU DPP construction material; circular metadata is an extension layer

## Operations and releases

- [Deployment and migration model](docs/operations/deployment.md) describes the
  app-only blue-green process and rollback contract.
- [Maintaining the public evergreen demo](docs/maintainers/public-release.md)
  describes how reviewed work can move from a private development repository
  without copying private history or internal material.
