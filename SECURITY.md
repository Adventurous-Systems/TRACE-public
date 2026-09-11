# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or exposed
credential. Use GitHub's private vulnerability reporting feature on the
repository Security tab. If that feature is unavailable, contact the repository
owner privately through their GitHub profile.

Include the affected component, reproduction steps, likely impact, and any
suggested mitigation. Do not access data that is not yours, disrupt a deployed
service, or publish exploit details before remediation is coordinated.

## Supported versions

TRACE is a research prototype. Only the current `main` branch receives security
updates; older commits, tags, branches, and demonstration deployments are not
supported.

## Secrets and demonstration accounts

No credential in source code, documentation, examples, commit history, or test
fixtures should be treated as valid. Demonstration and workshop passwords must
be supplied at runtime, be unique per environment, and be rotated after use.
