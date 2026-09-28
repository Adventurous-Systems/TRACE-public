# MinIO image mirror

TRACE stores passport photos and QR codes in MinIO. In September 2026 the
MinIO project withdrew its public container images: `quay.io/minio/minio`
now refuses anonymous pulls, and the release TRACE pinned is not on Docker
Hub either.

To keep CI and deployments working, TRACE now pins a mirror of that exact
release, `RELEASE.2025-09-07T16-13-09Z`, for linux/amd64:

```
ghcr.io/adventurous-systems/minio@sha256:a1a8bd4ac40ad7881a245bab97323e18f971e4d4cba2c2007ec1bedd21cbaba2
```

The mirror's contents are unchanged from upstream. Its digest differs from the
previous pin (`quay.io/minio/minio@sha256:14cea493…`) only because the mirror
holds just the amd64 image, not the upstream multi-platform index.

## Access

The mirror package is private to the Adventurous-Systems organisation.

- **CI:** the `Browser tests`, `Build and start deployment images`, and
  image-publishing jobs log in to `ghcr.io` with the workflow's
  `GITHUB_TOKEN`. That requires `packages: read` and Actions read access for
  this repository on the package.
- **Maintainers running the local stack:** log in once with a token that has
  `read:packages`, then run `pnpm docker:up` as usual:
  ```
  gh auth token | docker login ghcr.io -u <github-user> --password-stdin
  ```
- **Contributors outside the organisation** cannot pull the mirror. Point the
  `minio` service at any S3-compatible image you trust with a Compose override
  file. TRACE uses only bucket create/exists, a public-read bucket policy,
  object upload, and anonymous object GET.

## Planned replacement

The mirror is a stopgap. It is a frozen release that receives no upstream
security fixes. The planned replacement is a small storage interface behind
`packages/api/src/lib/storage.ts`, so the backend can be swapped for a
maintained S3-compatible store or plain file storage.
