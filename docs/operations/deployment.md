# Public demo deployment

This is the host-neutral operating contract for the public TRACE research demo.
Hostnames are public; host addresses, SSH identities, secret values, private
inventories, backup locations, and recovery contacts belong in a private
operator runbook.

The public demo is independent of every private TRACE environment. It has its
own PostgreSQL, Redis, MinIO, Thor Solo, Docker network, bind-mounted data directories, credentials,
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

The retained-account policy, buyer-role boundary, catalogue replenishment, and
nightly timer are defined in [Public buyer demo operations](public-buyer-demo.md).

## Components

- `deploy/compose.demo-data.yml` owns the isolated data plane. Its images are
  pinned by digest and it intentionally contains no Meilisearch service.
- `deploy/compose.app.yml` starts an API/web slot from locally named images whose
  immutable image IDs are recorded in the source-release receipt.
  An optional worker profile exists for future write-enabled deployments.
- `Dockerfile.ops` supplies migrations, deterministic synthetic seeding,
  catalogue verification, backup checks, and restore-time operations.
- `ops/release/prepare-release.sh` fetches the exact current public `main`
  SHA into a fresh detached checkout, builds the three images sequentially, scans each exact ID with checksum-verified Trivy v0.74.0, produces CycloneDX SBOMs and JSON reports, and atomically records their IDs and evidence hashes.
- `ops/release/verify-release.sh` revalidates the clean source, receipt, tags, IDs, OCI labels, configured non-root users, and the hash-bound SBOM and scan reports.
- `ops/deploy/preflight.sh` validates the exact SHA, release receipt, image IDs and revision
  labels, environment separation, network, resources, and unused slot ports.
- `ops/deploy/start-candidate.sh` and `verify-candidate.sh` start and probe an
  inactive slot without pulling or building.
- `ops/deploy/switch-nginx.sh` and `rollback-nginx.sh` provide the atomic,
  validated traffic switch.
- `ops/deploy/run-ops.sh` exposes only an allowlist of operations-image commands.

Repository scripts are never executed as root by an unrestricted SSH session.
A separately reviewed, root-owned wrapper (`ops/deploy/deploy-main.sh`, installed
as `deploy-main.sh`) holds the deployment `flock`, resolves the exact current
public `main` tip itself, selects the inactive slot, and invokes fixed installed
copies of these primitives. It takes no arguments: letting it resolve the SHA
itself, rather than accepting one as an argument, is what lets the sudoers grant
that runs it be pinned to that exact command with zero arguments — the tightest
possible grant, and no weaker a check than an argument would give, since
`prepare-release.sh`/`verify-release.sh` independently refuse any SHA that is not
the exact current public `main` tip regardless of how they were invoked.
Application containers must never receive the Docker socket.

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
- blue and green nginx upstream files plus one active symlink under `/var/lib/trace-demo/config/nginx`;
- release-specific root-only environment files plus `/var/lib/trace-demo/config/active.env`;
- `/var/lib/trace-demo/state` recording the paired active/previous upstream and environment, SHA, digests, migration state, and timestamps.

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
the deployment user. Install `release-lib.sh`, `prepare-release.sh`, `verify-release.sh`, `scan-image.sh`, and the reviewed `ops/deploy/*.sh` primitives there with mode 755. Record SHA-256 checksums of those installed copies in the private
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
modifications. The receipt is root-owned, mode 400, and records the exact local tags, immutable image IDs, Trivy version/database timestamp, and SHA-256 hashes of each SBOM and scan report. Any HIGH or CRITICAL runtime finding, fixed or unfixed, rejects the release. Treat a completed release directory as read-only.

## Initial installation

1. Generate unique disposable demo credentials and install the three environment
   files with owner root and mode 600.
2. Review `deploy/demo-data.env.example`, then start only
   `deploy/compose.demo-data.yml` under the `trace-demo-data` project.
3. Confirm the PostgreSQL, Redis, MinIO, and Thor health checks pass. Nothing
   except the MinIO object endpoint binds to a host port.
4. Run the installed preparation command for the exact reviewed main commit.
   It creates the immutable release directory, builds API, web, and operations images sequentially, rejects all HIGH/CRITICAL runtime findings, and binds image IDs, SBOMs, reports, scanner version, and vulnerability-database timestamp into the receipt.
5. Run migrations and the base seed, then run `demo-replenish --env demo`
   through the operations image with `--target-active 1 --yes`. Do not schedule
   `demo-restore`; run the non-destructive replenisher thereafter and
   record expected counts and hashes.
6. Populate the inactive slot file. Blue uses web/API ports 5003/5004 and green
   uses 5103/5104.
7. Run preflight, start the candidate, and verify its loopback endpoints.
   Prove invalid login returns 401, buyer registration works, and buyer role guards hold.
8. Install the HTTP-only `deploy/nginx/demo-acme.conf.example` through
   `etcedit`, validate and reload nginx, and issue the separate demo hostname
   certificate with Certbot webroot mode using
   `/var/lib/trace-demo/config/nginx/acme-webroot`. Replace the temporary vhost
   with `demo.conf.example` through `etcedit`, validate and reload again. The
   permanent HTTP vhost preserves the ACME challenge path so renewal continues
   to work. Install `maintenance.html` under
   `/var/lib/trace-demo/config/nginx` before enabling the HTTPS vhost.
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
7. Acquire the host deployment lock, verify SHA/digests/revision labels and scan evidence, then switch the nginx upstream and active environment pair together, gracefully reload, and run public probes.
8. Record the release state and monitor it for 24 hours before removing the old
   application slot.

CI deployment concurrency must never cancel an in-progress deployment.

The optional publishing workflow may continue to create private GHCR packages,
but the demo host neither pulls nor deploys them and stores no registry token.
The source-based demo build uses only the exact public commit fetched into its
release directory.

## Automated deployment

A merge to public `main` deploys itself. `.github/workflows/deploy-demo.yml` runs
on a self-hosted GitHub Actions runner registered on the demo host, scoped only to
this repository. It triggers after `CI` completes on `main`, additionally requires
`Security` to have reported success for that exact commit (`workflow_run` only
reports the workflow that triggered it, so the sibling is checked explicitly via
the GitHub API), and then runs `sudo -n deploy-main.sh` with no arguments. The job
never checks out repository code onto the runner; `deploy-main.sh` performs its
own clean fetch of the exact public `main` tip, so the blast radius of a
compromised workflow file is exactly the one sudoers grant below, nothing else on
the host.

`deploy-main.sh` runs the same sequence as the manual release procedure above,
end to end, holding the same deployment lock:

1. Resolve the exact current public `main` tip and compare it to the release the
   active slot is currently serving. If they match, exit; nothing to do.
2. Diff the two commits' changed paths against an ignore list
   (`docs/**`, `**/*.md`, `LICENSE`, `.github/**`, `PUBLIC_MANIFEST.txt`,
   `.gitignore`, `.prettierignore`, `.gitleaks.toml`). If every changed path is on
   that list, exit; a documentation-only merge does not redeploy. Anything not on
   the list is treated as code, and if the diff cannot be computed the default is
   to deploy, never to silently skip.
3. Prepare (or, if already prepared, verify) the immutable source release, free
   the inactive slot of any older generation's containers, and write its
   candidate environment file.
4. Preflight, migrate, and run `demo-verify`. A catalogue integrity failure here
   aborts before anything starts or switches; the live slot is never touched, and
   this always needs a human (investigate and run `demo-replenish` manually —
   never `demo-restore` against the buyer demo, see
   [Public buyer demo operations](public-buyer-demo.md)).
5. Start the candidate slot, verify its loopback endpoints, and switch the nginx
   upstream and active environment pair together.
6. Probe the public hostname. If the probes fail, roll back immediately and exit
   non-zero; a failed deployment run is a red run in the Actions tab with the full
   host log, and the demo keeps serving the previous release throughout.
7. Record the deployment in `/var/lib/trace-demo/state/deployments.log` and prune
   old releases, always keeping the active release, every release a recorded
   rollback pointer or a running container still references, and the two most
   recently prepared releases regardless.

The sudoers grant for the runner's service account is exactly
`ALL=(root) NOPASSWD: /usr/local/libexec/trace-demo/deploy-main.sh ""` — that
account has no other sudo rights and is not in the `docker` group, so it cannot
reach anything else on the host through this path. `workflow_dispatch` on the
same workflow re-runs the identical wrapper by hand as a break-glass path;
`concurrency: cancel-in-progress: false` means a second trigger queues rather
than cancelling a deployment in progress, per the release procedure above.

To pause automated deployment without touching the application, stop the
runner's service (`systemctl stop actions.runner.Adventurous-Systems-TRACE-public.*`)
or use the nginx emergency maintenance switch; neither affects the currently
serving slot.

## Rollback

Application rollback is an nginx operation:

1. Stop the new worker if one exists.
2. Restore the recorded previous upstream and active environment pair with `rollback-nginx.sh`.
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
nginx template can return 503 without touching containers. For an initial launch,
retain the dedicated demo vhost and certificate and use this maintenance switch
rather than removing the vhost; this prevents the hostname falling through to an
unrelated AS site.
