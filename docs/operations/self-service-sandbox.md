# Future persistent self-service sandbox

The first public deployment is read-only. `public_sandbox` is reserved and
currently fails closed. Do not enable `try.demo.trace.adventurous.systems` until
this design has its own implementation, threat model, tests, abuse controls, and
separate deployment approval.

The sandbox must have a distinct Compose project, network, PostgreSQL, Redis,
MinIO, secrets, backups, hostname, rate limits, and monitoring. It must never
share storage or credentials with the curated showcase or a private TRACE
environment.

A workspace is created with a cryptographically random demo ID, a user-selected
passphrase protected by Argon2id, and a one-time recovery code. Only the recovery
code hash is stored; successful recovery rotates it. Browser sessions use
Secure, HttpOnly, SameSite cookies rather than browser-stored bearer tokens.

Each workspace owns an isolated organisation and supplier account. Curated
passports remain `showcase`; workspace passports remain `private`. Public
passport and marketplace queries must exclude private workspace data. A
one-hour signed preview permits testing a private passport or QR journey without
publishing it. User-created listings do not enter the curated marketplace.

Initial quotas are 10 passports, five normalized images per passport, and 100 MB
of object storage. Uploads require type validation, metadata stripping,
re-encoding, and size limits. Creation, session, recovery, and upload routes
require rate limits. Operators need suspension and abuse-removal controls.

Workspace data persists until authenticated deletion. Deletion must remove
dependent database and object-storage records transactionally and be retryable.
The UI must warn that this is a synthetic research demo, confidential information
must not be submitted, and losing both passphrase and recovery code is
unrecoverable.
