# Contributing to TRACE

Thank you for helping improve this research prototype.

## Before opening a change

- Open an issue first for substantial behavior, schema, or architecture changes.
- Never commit credentials, populated `.env` files, participant data, deployment notes, logs, or database backups.
- Base changes on `staging`; keep pull requests focused and explain how they were tested.
- Follow the [Code of Conduct](./CODE_OF_CONDUCT.md) and report vulnerabilities through [SECURITY.md](./SECURITY.md).

## Local checks

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

Changes that affect migrations, contracts, Docker, or browser journeys should also run their relevant package and E2E checks. Pull requests require review and passing repository checks.
