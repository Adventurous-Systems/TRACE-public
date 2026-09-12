# Maintaining the public evergreen demo

The public TRACE repository is an independently releasable research demo, not a
mirror of a private working repository. Anyone should be able to inspect, fork,
clone, test, and run it without access to private material.

## Bringing private work into public

Prefer small, self-contained commits in the private repository. Export only
commits whose code, tests, fixtures, messages, authorship metadata, and file
paths are suitable for permanent public disclosure.

For each public release:

1. Start a fresh branch from public `staging`.
2. Review the private commit with `git show --stat` and `git show` before copying
   anything.
3. Cherry-pick without committing: `git cherry-pick --no-commit <sha>`.
4. Remove private-only files and rewrite contextual documentation, fixtures, and
   commit metadata as needed.
5. Inspect the complete staged patch and scan the entire resulting public
   history. Do not assume a clean source commit is safe merely because its final
   tree looks safe.
6. Create a new public commit with a public-safe author identity. Do not preserve
   private commit hashes, signatures, branch names, PR references, or internal
   ticket links.
7. Open a PR into public `staging` and require all available checks by team
   procedure.
8. Exercise the staging evergreen demo.
9. Fast-forward public `main` to the accepted staging commit for a release.

For a multi-commit private feature, reconstruct a small reviewed public commit
series rather than automatically copying the entire range. Resolve conflicts in
the public repository; never merge private history or add the private repository
as a public remote.

## Review checklist

- No `.env`, `.local`, agent instructions, private runbooks, prompts, audits,
  proposals, contact lists, database dumps, logs, backups, or generated keys.
- No personal email addresses, attendee data, customer names, private domains,
  VPS addresses, usernames, filesystem inventory, sales leads, or account data.
- No sensitive information in commit messages, authorship emails, binary assets,
  Git LFS objects, submodules, workflow artifacts, or generated source maps.
- Development credentials are clearly synthetic and disposable.
- Public documentation explains the behavior without relying on private context.
- Database migrations are additive and backward-compatible during deployment.
- New environment variables are documented and have safe validation behavior.
- Tests cover the public configuration, not a private service dependency.
- Gitleaks and TruffleHog pass over the complete public history.

## Branch flow without enforced protection

Until repository rules are available, maintainers follow this manual invariant:

- No direct feature work on `main` or `staging`.
- Every change goes through a short-lived public branch and reviewed PR.
- `staging` receives the reviewed commit first.
- Deployment uses an exact tested SHA.
- `main` advances only to a commit already accepted on `staging`.
- Force-pushes and branch deletion are never used on the three long-lived
  branches.

Keep the private repository and its VPS checkouts under their existing name. A
name exchange can cause stale private clones to target a new public repository;
without enforced branch protection, avoiding that exchange is the safer model.

## Independence checks

Periodically prove that a new contributor can succeed using only public data:

```bash
git clone https://github.com/Adventurous-Systems/TRACE-public.git
cd TRACE-public
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm build
pnpm test
```

Run this in a clean VM or ephemeral CI environment. A passing maintainer machine
is not evidence that undocumented private files are unnecessary.
