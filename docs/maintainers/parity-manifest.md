# Public functional parity manifest

This manifest defines the user-facing behavior retained from TRACE's validated research staging baseline. It intentionally does not identify or link private repositories, commits, deployments, accounts, or infrastructure.

| Area                 | Public source capability                                           | Evergreen showcase exposure                  |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| Authentication       | Registration, login, current-user session                          | Disabled by `public_showcase`                |
| Access management    | Buyer request and administrator review                             | Disabled by `public_showcase`                |
| Material passports   | Create, edit, photograph, view, verify, certificate, EPCIS history | Public reads only                            |
| Marketplace          | Search, listings, offers, transactions, lifecycle                  | Public listing reads only                    |
| Quality              | Reports and inspector workflow                                     | Public passport-linked reads only            |
| Audit and blockchain | Audited mutations, transaction status, explorer views              | Public non-sensitive reads only              |
| Trust layer          | VeChain integration and deterministic simulated fingerprints       | Simulated fingerprints for synthetic content |
| Data                 | SQL migrations and deterministic synthetic catalogue               | Dedicated disposable demo services           |

## Compatibility invariants

- `self_hosted` retains the complete source capability set.
- `public_showcase` rejects every unsafe HTTP method at the API boundary.
- `public_sandbox` remains fail-closed until its isolated workspace implementation is released.
- Public demo data comes only from repository fixtures; private databases and object stores are never copied.
- Governance/token prototypes remain isolated on their existing feature branch.

## Review evidence

A release review compares route registrations, web routes, SQL migrations, contract sources, environment keys, synthetic catalogue identifiers, and E2E journeys. Differences must be classified as public sanitization, security hardening, deployment support, or an intentional exposure restriction.
