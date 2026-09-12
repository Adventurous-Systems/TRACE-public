# Deployment and migration model

This is the public, host-neutral deployment contract for TRACE. Actual SSH
users, addresses, secret values, active port slots, backup destinations, and
recovery contacts belong in a private infrastructure runbook.

## Safety properties

- The historical private checkout is never reset, rebuilt, or repointed.
- PostgreSQL, Redis, MinIO, Thor, and their volumes remain owned by the existing
  environment Compose project during application migration.
- A release identifies an exact 40-character commit SHA and immutable API and
  web image digests.
- Candidate API and web containers use unused loopback ports.
- Candidate API containers do not consume BullMQ jobs before traffic cutover.
- Nginx is the only traffic switch. The previous slot stays available until the
  observation period ends.
- A database migration must be backward-compatible with both the old and new
  application. Schema rollback is not assumed.

## Public and private layers

The repository provides:

- `deploy/compose.app.yml`: app-only API, web, and optional worker services.
- `ops/deploy/preflight.sh`: read-only validation of environment files, images,
  network, and candidate ports.
- `ops/deploy/start-candidate.sh`: starts API/web without pulling or building.
- `ops/deploy/verify-candidate.sh`: read-only direct-port checks.
- `ops/deploy/switch-nginx.sh`: atomic validated upstream switch.
- `ops/deploy/rollback-nginx.sh`: restores the recorded previous upstream.

The host must provide root-owned runtime and non-secret deployment environment
files, A/B upstream files, and `/usr/local/sbin/trace-deploy-staging` and
`/usr/local/sbin/trace-deploy-production`. Those wrappers select the inactive
slot and call these public primitives. Until they exist and repository
environment secrets are configured, GitHub deployment workflows fail closed.

`publish-images.yml` builds a reviewed SHA before authenticating to GitHub
Container Registry, then publishes commit-tagged API and web images and reports
their immutable digests. Configure both packages as public if contributors
should be able to run them without registry credentials. Deployment
configuration must use the reported `name@sha256:...` values, never the mutable
commit tag. Publishing does not deploy or alter the VPS.

## First migration

1. Freeze promotion while the release SHA is tested.
2. Record current Git SHA, image IDs, container IDs, active nginx slot, volume
   names, migration records, important row counts, and public HTTP baselines.
3. Create fresh PostgreSQL and MinIO recovery points.
4. Restore the PostgreSQL dump into an isolated disposable server and prove that
   it can be queried. Listing a dump is not a restore test.
5. Run the release migrations against the restored copy. Compare the migration
   set with the deployed set and require an explicit review for every change.
6. Start the candidate against disposable services and run the full mutating E2E
   suite.
7. Start a second candidate against the real staging network using unused
   loopback ports. Its embedded worker is disabled by Compose.
8. Run read-only checks, then controlled staging authentication, upload,
   marketplace, passport, QR, audit, and anchoring journeys.
9. Create an inactive nginx slot file from
   `deploy/nginx/upstream-slot.conf.example` and validate the complete nginx
   configuration.
10. Switch the active symlink, run `nginx -t`, and gracefully reload nginx.
11. Verify the public hostname. If any gate fails, run the nginx rollback before
    investigating.
12. Stop the old API only after the candidate serves traffic; then start the
    separate candidate worker. On rollback, reverse that worker handoff.
13. Keep the previous API/web slot for at least 24 hours on staging and for the
    agreed production observation period.

Production repeats the same sequence only after staging completes its
observation period.

## Nginx slot arrangement

The active include is a symlink, for example:

```text
/etc/nginx/trace-upstreams/staging-active.conf -> staging-blue.conf
/etc/nginx/trace-upstreams/staging-blue.conf
/etc/nginx/trace-upstreams/staging-green.conf
```

Include `staging-active.conf` inside the relevant `server` block, then use the
variables in existing locations:

```nginx
location /api/ {
    proxy_pass $trace_api_origin;
}

location /minio/ {
    rewrite ^/minio/(.*)$ /$1 break;
    proxy_pass $trace_minio_origin;
}

location / {
    proxy_pass $trace_web_origin;
}
```

Changing the symlink does nothing until `nginx -t` succeeds and nginx receives a
graceful reload. The switch script records the previous resolved file first.

## Worker handoff

The normal local stack keeps `ANCHOR_WORKER_ENABLED=true` for compatibility. The
app-only candidate forces it to `false`. Start the separate worker only during
cutover:

```bash
docker compose --env-file /path/to/candidate.deploy.env \
  -f deploy/compose.app.yml --profile worker up -d worker
```

Never leave the old embedded worker and new separate worker active by accident.
BullMQ prevents a single job from being executed concurrently in the normal
case, but overlapping versions can still process different jobs with different
application behavior.

## Required release gates

- Frozen-lockfile install, formatting, typecheck, lint, build, unit tests, and
  contract tests.
- Disposable migrations and seeds.
- Functional/mobile E2E and smoke-isolation assertion.
- API and web image builds and Compose validation.
- Secret-history scans and dependency review.
- An actual database restore drill and MinIO recovery check.
- Candidate health, invalid and valid authentication, existing JWT continuity,
  marketplace reads/writes, upload retrieval, public QR URLs, and worker queue
  behavior.
- Nginx rollback rehearsal on staging.

## Migration rules

Use expand/contract schema changes:

1. Add nullable columns, new tables, or compatible indexes.
2. Deploy code capable of reading both old and new representations.
3. Backfill separately with observable, restartable work.
4. Switch reads and writes.
5. Remove old schema only in a later release after rollback is no longer needed.

A release with a destructive migration cannot use nginx-only rollback and must
not be deployed through this procedure.

## Backup scope

PostgreSQL dumps alone are insufficient. The private infrastructure runbook must
cover PostgreSQL, MinIO objects and policies, runtime environment files, nginx
configuration, and any non-disposable Thor state. Backups need encrypted off-host
copies, failure monitoring, retention, and scheduled restore drills with recorded
recovery time and recovery point objectives.
