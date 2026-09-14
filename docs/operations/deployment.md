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
- `public_buyer_demo` is the deployed default. It allows anonymous marketplace
  reads, buyer registration/login, and buyer marketplace actions. Existing role
  checks continue to deny seller, passport, quality, and administrative actions.
- `public_showcase` remains available as the API-enforced read-only profile.
- `public_sandbox` is reserved. It currently fails closed like the showcase and
  must not be deployed until the separate sandbox design is implemented and
  reviewed.

## Components

- `deploy/compose.demo-data.yml` owns the isolated data plane. Its images are
  pinned by digest and it intentionally contains no Meilisearch service.
- `deploy/compose.app.yml` starts an API/web slot from locally named images whose
  immutable image IDs are recorded in the source-release receipt.
  An optional worker profile exists for future write-enabled deployments.
- `Dockerfile.ops` supplies migrations, deterministic synthetic seeding,
  catalogue verification, backup checks, and restore-time operations.
- `ops/release/prepare-release.sh` fetches the exact current public `main`
  SHA into a fresh detached checkout, builds the three images sequentially, and
  atomically records their IDs.
- `ops/release/verify-release.sh` revalidates the clean source, receipt, tags,
  IDs, OCI labels, and configured non-root users.
- `ops/deploy/preflight.sh` validates the exact SHA, release receipt, image IDs and revision
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
fresh from the public GitHub repository at the exact current `main` commit,
built locally without runtime secrets, and tagged with that full commit SHA. The
build records the resulting immutable image IDs in a root-owned release receipt.
Deployment preflight requires the candidate values, release-specific tags,
recorded IDs, local image IDs, and OCI revision labels all to agree, so a
retargeted local tag or altered candidate file cannot pass validation.

## Trusted host installation

Review the exact public commit before installation. Install fixed copies with
`install`; do not run an installer from the Git checkout as root. The trusted
directory is `/usr/local/libexec/trace-demo`, owned by root and not writable by
the deployment user. Install `release-lib.sh`, `prepare-release.sh`,
`verify-release.sh`, and the reviewed `ops/deploy/*.sh` primitives there with
mode 755. Record SHA-256 checksums of those installed copies in the private
deployment record.

The preparation interface accepts one argument only:

```text
sudo /usr/local/libexec/trace-demo/prepare-release.sh <40-character-main-sha>
sudo /usr/local/libexec/trace-demo/verify-release.sh <40-character-main-sha>
```

The command rejects branch names, abbreviated or uppercase SHAs, any SHA other
than the exact remote `main` tip, an existing release/tag, a secret-bearing
build environment, a dirty or ignored release source, Git remotes/hooks,
symlinks/submodules, manifest drift, confidential paths/content, label/user mismatches,
and a `main` tip that changes while images are building. Docker receives an
allowlisted empty process environment and a fresh credential-free client
configuration. A failed build removes only its temporary release and exact new
tags.

Successful preparation creates:

```text
/opt/trace-public-demo/releases/<sha>/source
/opt/trace-public-demo/releases/<sha>/images.env
```

The detached source has no remotes, hooks, credentials, ignored files, or local
modifications. The receipt is root-owned, mode 400, and records the exact local
tags and immutable image IDs. Treat a completed release directory as read-only.

## Initial installation

1. Generate unique disposable demo credentials and install the three environment
   files with owner root and mode 600.
2. Review `deploy/demo-data.env.example`, then start only
   `deploy/compose.demo-data.yml` under the `trace-demo-data` project.
3. Confirm the PostgreSQL, Redis, MinIO, and Thor health checks pass. Nothing
   except the MinIO object endpoint binds to a host port.
4. Run the installed preparation command for the exact reviewed main commit.
   It creates the immutable release directory, builds API, web, and operations
   images sequentially, records their IDs, and verifies revision/source labels
   and non-root users. Scan the resulting exact IDs before use.
5. Run migrations and the base seed, then run `demo-replenish --env demo`
   through the operations image with `--target-active 3 --yes`. Do not schedule
   `demo-restore`; run the non-destructive replenisher thereafter and
   record expected counts and hashes.
6. Populate the inactive slot file. Blue uses web/API ports 5003/5004 and green
   uses 5103/5104.
7. Run preflight, start the candidate, and verify its loopback endpoints.
   Prove invalid login returns 401, buyer registration works, and buyer role guards hold.
8. Install the nginx rate-limit zones and demo server template, provision the
   demo hostname certificate, run `nginx -t`, and reload gracefully.
9. Point the active upstream symlink at the candidate and re-run public health,
   marketplace, passport, QR, image, and responsive-browser checks.
10. Observe for at least 24 hours. Preserve the prior application slot and its
    recorded digest set throughout the window.

Starting this stack does not require a checkout change, restart, migration, or
nginx edit in any private TRACE environment.

## Release procedure

1. Test the reviewed public `main` SHA in CI and a clean-room clone.
2. Run the installed source-release preparation command. Verify the immutable
   source and local image receipt, then scan the three exact image IDs.
3. Create and validate PostgreSQL and MinIO recovery points. Restore the
   PostgreSQL backup into a disposable database; merely listing it is not a
   restore test.
4. Run only expand/contract-compatible migrations through the operations image.
5. Start the inactive slot and probe it directly on loopback.
6. Confirm public `main` still points to the exact tested SHA before deployment.
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
