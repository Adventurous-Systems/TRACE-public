# Public demo deployment

This is the host-neutral operating contract for the public TRACE research demo.
Hostnames are public; host addresses, SSH identities, secret values, private
inventories, backup locations, and recovery contacts belong in a private
operator runbook.

The public demo is independent of every private TRACE environment. It has its
own PostgreSQL, Redis, MinIO, Thor Solo, Docker network, volumes, credentials,
backups, and application slots. Never attach it to a private network or copy
private data into it.

## Deployment profiles

- `self_hosted` retains the complete application for local operators.
- `public_showcase` is the deployed default. The API permits only GET, HEAD, and
  OPTIONS; authentication and every mutation fail closed with HTTP 403. The web
  interface also hides login and mutation controls.
- `public_sandbox` is reserved. It currently fails closed like the showcase and
  must not be deployed until the separate sandbox design is implemented and
  reviewed.

## Components

- `deploy/compose.demo-data.yml` owns the isolated data plane. Its images are
  pinned by digest and it intentionally contains no Meilisearch service.
- `deploy/compose.app.yml` starts an API/web slot from locally named images whose
  immutable image IDs are recorded and checked against the transfer receipt.
  An optional worker profile exists for future write-enabled deployments.
- `Dockerfile.ops` supplies migrations, deterministic synthetic seeding,
  catalogue verification, backup checks, and restore-time operations.
- `ops/deploy/preflight.sh` validates the exact SHA, image IDs and revision
  labels, environment separation, network, resources, and unused slot ports.
- `ops/deploy/start-candidate.sh` and `verify-candidate.sh` start and probe an
  inactive slot without pulling or building.
- `ops/deploy/switch-nginx.sh` and `rollback-nginx.sh` provide the atomic,
  validated traffic switch.
- `ops/deploy/run-ops.sh` exposes only an allowlist of operations-image commands.

Repository scripts are never executed as root by an unrestricted SSH session.
A separately reviewed, root-owned wrapper must use `flock`, accept only an exact
40-character SHA plus the expected API/web/operations digests, select the
inactive slot, and invoke fixed installed copies of these primitives. Application
containers must never receive the Docker socket.

## Host-owned configuration

Install reviewed copies outside the checkout, for example under a root-owned
configuration directory:

- the app Compose file and deploy scripts;
- a mode-600 API environment file containing database, JWT, storage, and Thor
  configuration; set `MINIO_PUBLIC_READ=true` only for this isolated showcase so
  passport images can be served through its nginx object route;
- a mode-600 web environment file containing only `TRACE_ENV`,
  `TRACE_DEPLOYMENT_PROFILE`, and approved `NEXT_PUBLIC_*` values;
- a mode-600 data-plane environment file;
- blue and green non-secret deployment files;
- blue and green nginx upstream files plus one active symlink;
- deployment state recording active/previous slot, SHA, digests, migration
  state, and timestamps.

The web preflight rejects unexpected environment keys. Each release is fetched
fresh from the public GitHub repository at an exact tested commit, built locally
without runtime secrets, and tagged with that full commit SHA. The build records
the resulting immutable image IDs in a root-owned release receipt. Deployment
preflight requires both the release-specific tags and recorded IDs to match, so
a retargeted local tag cannot pass validation.

## Initial installation

1. Generate unique disposable demo credentials and install the three environment
   files with owner root and mode 600.
2. Review `deploy/demo-data.env.example`, then start only
   `deploy/compose.demo-data.yml` under the `trace-demo-data` project.
3. Confirm the PostgreSQL, Redis, MinIO, and Thor health checks pass. Nothing
   except the MinIO object endpoint binds to a host port.
4. Fetch the exact tested staging commit into a new immutable release directory.
   Build API, web, and operations images sequentially, record their IDs, scan the
   images, and verify revision labels and non-root users. Runtime secrets must
   not be present in the source checkout or Docker build environment.
5. Run migrations, the base seed, the curated-product seed, and `demo-restore`
   through the operations image, in that order. Then run `demo-verify` and
   record expected counts and hashes.
6. Populate the inactive slot file. Blue uses web/API ports 5003/5004 and green
   uses 5103/5104.
7. Run preflight, start the candidate, and verify its loopback endpoints.
   Explicitly prove login and representative mutations return 403.
8. Install the nginx rate-limit zones and demo server template, provision the
   demo hostname certificate, run `nginx -t`, and reload gracefully.
9. Point the active upstream symlink at the candidate and re-run public health,
   marketplace, passport, QR, image, and responsive-browser checks.
10. Observe for at least 24 hours. Preserve the prior application slot and its
    recorded digest set throughout the window.

Starting this stack does not require a checkout change, restart, migration, or
nginx edit in any private TRACE environment.

## Release procedure

1. Test the public `staging` SHA in CI and a clean-room clone.
2. Build all three images on GitHub-hosted runners and capture their digests.
3. Create and validate PostgreSQL and MinIO recovery points. Restore the
   PostgreSQL backup into a disposable database; merely listing it is not a
   restore test.
4. Run only expand/contract-compatible migrations through the operations image.
5. Start the inactive slot and probe it directly on loopback.
6. Fast-forward public `main` to the exact tested `staging` SHA.
7. Acquire the host deployment lock, verify SHA/digests/revision labels, switch
   nginx, gracefully reload, and run public probes.
8. Record the release state and monitor it for 24 hours before removing the old
   application slot.

CI deployment concurrency must never cancel an in-progress deployment.

The optional publishing workflow may continue to create private GHCR packages,
but the demo host neither pulls nor deploys them and stores no registry token.
The source-based demo build uses only the exact public commit fetched into its
release directory.

## Rollback

Application rollback is an nginx operation:

1. Stop the new worker if one exists.
2. Restore the recorded previous upstream with `rollback-nginx.sh`.
3. Run `nginx -t`, reload gracefully, and verify public probes.
4. Restore the previous worker only if that release used one.
5. Preserve the failed slot and logs for diagnosis.

Do not reverse a database migration during an application rollback. Every
migration must remain compatible with the previous slot. A destructive migration
is ineligible for this procedure.

## Backup and restore

Use `ops/backup_db.sh` with explicit Compose, environment, and backup paths. It
creates mode-private custom-format dumps, validates them, applies retention, and
can notify a dead-man's-switch monitor. Back up MinIO objects and configuration
at the same release boundary.

Use `ops/restore_db.sh` only against the intended isolated target. It refuses to
run without `--yes` and creates a validated safety dump in an explicit durable
directory before modifying data. After restore, run migrations and catalogue
verification through the operations image before routing traffic.

Maintain encrypted off-host PostgreSQL and MinIO copies. Schedule disposable
restore drills and record recovery point and recovery time results.

## Monitoring

Alert on uptime, API 5xx rate, container health/restarts, certificate expiry,
disk and volume usage, backup age, catalogue counts/hashes, broken image or QR
links, and deployed image-digest drift. The emergency maintenance switch in the
nginx template can return 503 without touching containers.
