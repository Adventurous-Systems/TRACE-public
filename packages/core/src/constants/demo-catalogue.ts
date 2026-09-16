/**
 * The tag that scopes the curated demo catalogue.
 *
 * Lives here, not in packages/db/scripts/lib/catalogue.ts, because the API
 * needs it too (to distinguish curated marketplace browse from visitor-created
 * listings) and @trace/db exports only its build output and drizzle schema,
 * not its scripts. This constant is demo-only, so it is reached through the
 * `@trace/core/constants/demo-catalogue` subpath rather than the package's
 * main barrel — it must never end up in the web client bundle.
 *
 * SEED_TAG stamps every curated passport's customAttributes.seedSource.
 * Anything not carrying this tag is treated as visitor-created.
 */
export const SEED_TAG = 'workshop-curated-2026-06';
