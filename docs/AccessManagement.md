# TRACE Access Management

This document describes the current public signup and internal access-management flow used in staging and production.

## Overview

TRACE keeps public registration simple:

- anyone can create a public `buyer` account
- buyers can request elevated access for seller or beta workflows
- `platform_admin` reviews and manages those requests internally

There is no public role picker for elevated roles.

## Public Signup

Public users create accounts at `/register`.

Rules:

- self-signup always creates role `buyer`
- callers cannot choose their own role
- callers cannot assign their own `organisationId`
- successful signup returns the same auth payload as login: `token` plus `user`

## Buyer Access Request Flow

Signed-in buyers can open `/access-request` and submit:

- requested access level: `hub_staff` or `hub_admin`
- organisation or hub name
- beta context or notes

Behavior:

- only buyers can submit access requests
- only one `pending` request is allowed at a time
- a reviewed request remains in history
- if a buyer is rejected or later revoked back to `buyer`, they can start again with a fresh request

Buyer page states:

- `pending` request: shows the active request and blocks duplicate submission
- reviewed history only: shows the previous request summary and reopens the form
- no history: shows the form directly

## Admin Review Flow

`platform_admin` manages requests at `/admin/access-requests`.

The admin page has three views.

### 1. Pending Requests

Admins can:

- edit requested role
- edit organisation name
- edit request notes
- add or update review notes
- approve the request
- reject the request

Reject is non-destructive:

- the request status becomes `rejected`
- the request remains in history

### 2. Approved Access

Admins can manage already-approved users by:

- changing role between `hub_staff` and `hub_admin`
- moving the user to an existing organisation
- entering a custom organisation name to create or reuse a hub organisation
- revoking access back to `buyer`

Revocation behavior:

- user role becomes `buyer`
- `organisationId` is cleared
- approval history is preserved
- the buyer can later request access again from the start

### 3. Organisations

Admins can update organisations by:

- renaming the organisation
- toggling `verified`

Not supported in v1:

- hard delete
- archive flow
- broader organisation metadata management

## Organisation Handling

When an admin approves or reassigns elevated access, they can either:

- select an existing organisation, or
- provide a custom organisation name

If a custom organisation name is used and no matching organisation exists:

- TRACE creates a new `hub` organisation
- a unique slug is generated automatically
- the user is attached to that organisation

Organisation rename updates:

- change the stored display name
- keep the existing slug stable in v1

## API Surface

Relevant routes:

- `POST /api/v1/auth/register`
- `POST /api/v1/access-requests`
- `GET /api/v1/access-requests/mine`
- `GET /api/v1/access-requests`
- `PATCH /api/v1/access-requests/:id`
- `POST /api/v1/access-requests/:id/approve`
- `POST /api/v1/access-requests/:id/reject`
- `PATCH /api/v1/access-requests/:id/approved-user`
- `GET /api/v1/access-requests/organisations`
- `PATCH /api/v1/access-requests/organisations/:id`

Permissions:

- buyer routes require authenticated `buyer`
- admin management routes require authenticated `platform_admin`

## Operational Notes

For staging QA, validate these cases:

1. public buyer signup works
2. buyer can submit seller access request
3. admin can edit and approve a pending request
4. admin can reassign approved access to a different organisation
5. admin can revoke access back to `buyer`
6. revoked buyer can submit a fresh request again
7. organisation rename and verified toggle work from the admin page

## Current Constraints

These are intentional in the current version:

- no buyer self-edit or self-withdraw for requests
- no hard delete for requests or organisations
- no public self-service seller role selection
- no email verification or invite flow yet

This keeps the model simple while preserving a clear path for future organisation onboarding and invite-based flows.
