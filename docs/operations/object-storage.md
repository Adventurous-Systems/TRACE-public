# Object storage

TRACE stores passport photos, QR codes and catalogue images as plain files
under one directory, `STORAGE_DIR`. It used MinIO until R4 (October 2026):
MinIO's community edition is archived and no longer gets fixes, and TRACE
needs only four things from a store: write a file, read it, serve it
publicly, and back it up.

## How it works

- **Layout:** `<STORAGE_DIR>/<bucket>/<key>`, e.g.
  `passports/passports/<passport-id>/photos/<time>-<id>.jpg`. Catalogue
  images are stored once by content hash, `passports/catalogue/<sha256>.jpg`,
  however many demo lots use them.
- **URLs:** `<STORAGE_PUBLIC_URL>/<bucket>/<key>`. The path keeps MinIO's
  `/minio/` prefix so URLs stored before R4 still resolve.
  `STORAGE_PUBLIC_URL` falls back to `MINIO_PUBLIC_URL`, then `<WEB_URL>/minio`.
- **Write-once:** a stored key is never overwritten (writing the same bytes
  again is accepted). Partly written files sit in `<STORAGE_DIR>/.incoming`
  until they are complete. This is what makes hard-link snapshots safe.
- **Serving:** a deployment's nginx serves `/minio/` straight from the
  directory, read-only, and refuses hidden paths. Without nginx (the local
  stack, e2e), `STORAGE_SERVE=true` makes the API serve the same paths.
- **Ledger:** `stored_objects` records every file, its size and kind
  (`photo`, `qr` or `catalogue`). Only photos count towards a quota.

The code is `packages/db/src/object-store.ts` (shared by the API and the
operations scripts) and `packages/api/src/lib/storage.ts`.

## Limits

Set per deployment in the API environment. Defaults (owner, 2026-10-07):

| Setting                   | Default                           | When it is hit                             |
| ------------------------- | --------------------------------- | ------------------------------------------ |
| `UPLOAD_MAX_BYTES`        | 10 MB                             | 413 `PHOTO_TOO_LARGE`                      |
| `PASSPORT_PHOTOS_MAX`     | 8                                 | 409                                        |
| `ORG_STORAGE_QUOTA_BYTES` | 100 MB of photos per organisation | 413 `STORAGE_QUOTA_EXCEEDED`               |
| `STORAGE_MIN_FREE_BYTES`  | 5 GB free on the store's disk     | 507 `STORAGE_FULL`; the site keeps serving |

Uploads are re-encoded to JPEG of at most 2000 px, so a stored photo is
far smaller than the upload limit. Keep nginx's `client_max_body_size` a
little above `UPLOAD_MAX_BYTES` (the demo uses `11m`). The web app checks the
defaults before sending; if a deployment raises them, raise
`packages/core/src/constants/uploads.ts` too.

## Backups

`ops/backup_objects.sh <objects-dir> <backup-dir>` takes a snapshot of hard
links (`deploy/systemd/trace-demo-backup-objects.{service,timer}` run it
nightly), kept for `TRACE_BACKUP_RETENTION_DAYS` (14). A snapshot costs no
disk for files still in the store; a deleted file's space is held until the
last snapshot holding it expires. Snapshots must be on the same filesystem
as the store (the script refuses otherwise), so they do not protect against
losing the disk. Off-host copies are a separate, deferred decision.

## Moving a deployment off MinIO

1. Create the store directory, owned by uid 1000 (the images' `node` user),
   and mount it as `compose.app.yml` and `ops/deploy/run-ops.sh` expect.
2. Serve `/minio/` from it with a fallback to MinIO (see
   `deploy/nginx/demo.conf.example`). The previous release, the rollback
   target, still writes to MinIO; the fallback keeps its files visible.
3. Deploy, then copy the files the database refers to and record them:
   `run-ops.sh <env> storage-import --env <name> --dry-run`, then `--yes`.
   It fetches each file through its own URL, so nginx's fallback supplies it
   from MinIO; it is safe to run again, e.g. after a rollback window.
4. Once the release is stable and no rollback target uses MinIO, remove the
   fallback and the MinIO service.

The `minio` service in `docker-compose.yml` is kept only for
`pnpm stack upgrade`, where the previous release still stores in MinIO. It
runs `pgsty/minio`, the maintained community fork, from Docker Hub.
