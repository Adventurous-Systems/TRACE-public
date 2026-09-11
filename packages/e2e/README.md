# @trace/e2e — Playwright end-to-end tests

Browser-level coverage of the critical application journeys.

## Prerequisites

- The app stack running (api + web + Postgres + Redis + **MinIO** for photo upload).
- The target database seeded with `pnpm --filter @trace/db seed`.
- **`DEMO_SIMULATE_ANCHOR=true`** on the API so the trust layer is deterministic.
- Browsers installed once: `pnpm --filter @trace/e2e exec playwright install --with-deps chromium`.

## Run

```bash
# against a local stack (defaults: web :3000, api :3001)
pnpm e2e

# against the deployed domain (same origin proxies /api)
E2E_BASE_URL=https://trace.adventurous.systems \
E2E_API_URL=https://trace.adventurous.systems \
  pnpm e2e:smoke          # @smoke-tagged, read-mostly subset

pnpm e2e:ui               # interactive
pnpm e2e:update           # refresh visual snapshots (run in the Playwright container)
```

## Config

- `E2E_BASE_URL` — web origin under test (default `http://localhost:3000`).
- `E2E_API_URL` — API origin for `global-setup` session minting (default `http://localhost:3001`).

## Layout

- `tests/*.spec.ts` — desktop functional journeys.
- `tests/mobile/*.spec.ts` — 375px viewport (project `mobile-375`).
- `tests/visual/*.spec.ts` — visual-regression snapshots (project `tablet`).
- `global-setup.ts` — logs each seeded role in via the API, saves `.auth/<role>.json` storage state.
- `fixtures/` — accounts, API helpers, shared assertions.

## Notes

- Visual baselines must be generated in the pinned Playwright Docker image so they match CI rendering.
- `global-setup` will fail fast with a clear message if the seeded accounts can't log in.
