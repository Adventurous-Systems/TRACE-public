/**
 * Restore the demo environment to a known-good, presentable state.
 *
 * WHY THIS EXISTS
 * Demos degrade. An offer flips a curated product to `reserved` and it vanishes
 * from the marketplace; a prospect leaves a test listing behind; a listing
 * expires; someone edits a price. Before this script the only options were
 * `reset:marketplace` (truncates everything, including the curated catalogue
 * and any real user's data) or `seed:products` (all-or-nothing: it no-ops if
 * ANY curated passport exists, so it cannot repair a partial set, and a
 * --unseed/re-seed round trip mints new UUIDs and invalidates printed QR codes).
 *
 * This fills the gap between them: convergent, tag-scoped, and UUID-preserving.
 * Run it before a demo, or after one.
 *
 * WHAT IT CONVERGES (anything tagged customAttributes.seedSource = SEED_TAG)
 *   - passport fields back to the catalogue values (a fiddled price or grade
 *     is undone);
 *   - passport fingerprints recomputed, so verify-integrity passes;
 *   - exactly one active, never-expiring listing per curated passport;
 *   - curated transactions: in-flight ones (including disputed) cancelled,
 *     then ALL historical transactions on curated listings are removed —
 *     J-09, so a demo buyer's Orders screen doesn't fill up with old test
 *     orders across sessions. Scope is exactly the curated listing set;
 *     a real attendee's order on their own listing is never touched;
 *   - demo personas declared `organisation: 'none'` (platform admin,
 *     inspector, the demo buyer, the applicant): any organisation they have
 *     drifted onto is cleared — J-01 / D-23. Approving the applicant during
 *     a demo is therefore reversible by this script, same as everything else.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH
 *   - it NEVER deletes a user or an organisation, and never modifies an account
 *     that is not in DEMO_PERSONAS. Non-demo account lifecycle is a separate,
 *     explicitly reviewed operation. It DOES converge the platform-owned demo personas
 *     (creating them if absent, correcting a drifted role or password), because
 *     the demo and its readiness check both depend on those existing.
 *   - non-curated passports. Visitors' own passports stay; only their
 *     *listings* are swept (with --sweep), which is enough to keep the
 *     marketplace presentable.
 *   - anchored passports (blockchain_tx_hash set): rehashing one would
 *     de-sync it from the chain. It reports them instead.
 *
 * LIMITATION: it converges curated passports that EXIST. It does not re-create
 * a curated passport that has been deleted outright, because that needs the
 * MinIO photo upload path in seed-products.ts. It detects and reports that
 * case with the exact command to fix it.
 *
 * Usage:
 *   pnpm --filter @trace/db demo:verify  -- --env demo-production
 *   pnpm --filter @trace/db demo:restore -- --env demo-production --dry-run
 *   pnpm --filter @trace/db demo:restore -- --env demo-production --yes [--sweep]
 *
 * --sweep additionally cancels non-curated listings older than
 * DEMO_LISTING_TTL_HOURS (default 24), so a prospect's own listing survives
 * their session but is gone before the next demo.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, inArray, lt, notInArray, sql as dsql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import {
  DEMO_PERSONA_LIST,
  HUB_ORG_SLUG,
  demoPersonaPassword,
} from '@trace/core/constants/demo-personas';
import * as schema from '../drizzle/schema.js';
import { computePassportHash } from '../src/passport-hash.js';
import { resolveTarget } from './lib/guard.js';
import { CATALOG, SEED_TAG } from './lib/catalogue.js';
import { DEMO_QUALITY_REPORT, DEMO_ACCESS_REQUEST, DEMO_FEEDBACK } from './lib/demo-content.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(SCRIPT_DIR, '../../../.env') });

const LISTING_TTL_HOURS = Number(process.env['DEMO_LISTING_TTL_HOURS'] ?? 24);
const HOUR = 60 * 60 * 1000;

interface Problem {
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Fields the catalogue derives from `Date.now()` at import time, so their value
 * differs on every run. Converging them would rewrite the row (and therefore
 * the fingerprint) every single time, and demo:verify could never report a
 * clean environment. They are seeded once and then left alone.
 */
const RELATIVE_DATE_FIELDS = new Set(['deconstructionDate', 'productionDate']);

/**
 * Postgres JSONB does not preserve key insertion order, so a round-tripped
 * object compares unequal under JSON.stringify even when nothing changed.
 * Sort keys recursively before comparing.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const verifyOnly = argv.includes('--verify');
  const dryRun = argv.includes('--dry-run') || verifyOnly;
  const confirmed = argv.includes('--yes');
  const sweep = argv.includes('--sweep');
  // Furniture is on by default; --no-furniture opts out for a bare catalogue.
  const furniture = !argv.includes('--no-furniture');
  const targetActiveIndex = argv.indexOf('--target-active');
  // Default matches the demo's converged catalogue depth (one active lot per
  // product, see demo-trim-active.ts / 7d80393). A stale '3' here makes
  // demo:verify report every catalogue product as an error once the live
  // catalogue has been trimmed to 1, because expectedPerProduct below falls
  // back to this default whenever a curated passport carries catalogueKey.
  const targetActiveRaw = targetActiveIndex >= 0 ? argv[targetActiveIndex + 1] : '1';
  const targetActive = Number(targetActiveRaw);
  if (!Number.isInteger(targetActive) || targetActive < 1 || targetActive > 10) {
    throw new Error('--target-active must be an integer from 1 to 10');
  }

  const target = resolveTarget(argv);

  if (!dryRun && !confirmed) {
    console.error('\nRefusing to write without --yes. Re-run with --dry-run to preview.');
    process.exit(1);
  }

  const mode = verifyOnly
    ? 'VERIFY (read-only)'
    : dryRun
      ? 'DRY-RUN (no writes)'
      : 'LIVE (writes enabled)';
  console.log(
    `\nDemo ${verifyOnly ? 'verify' : 'restore'} — ${mode}\n  target: ${target.description}\n`,
  );

  const client = postgres(target.databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });
  const curatedFilter = dsql`${schema.materialPassports.customAttributes}->>'seedSource' = ${SEED_TAG}`;
  const problems: Problem[] = [];

  try {
    // ── 0. Demo personas: create if absent, correct if drifted ───────────────
    // Scoped strictly to DEMO_PERSONAS. Any other account is left untouched.
    console.log('Demo personas:');
    const personaIds = new Map<string, string>();
    const hubOrg = await db.query.organisations.findFirst({
      where: eq(schema.organisations.slug, HUB_ORG_SLUG),
    });
    if (!hubOrg) {
      problems.push({
        severity: 'error',
        message:
          `the seeded hub organisation ("${HUB_ORG_SLUG}") is missing — run ` +
          '`pnpm --filter @trace/db seed` first',
      });
    }

    for (const persona of DEMO_PERSONA_LIST) {
      const personaPassword = demoPersonaPassword(persona, process.env);
      const existing = await db.query.users.findFirst({
        where: eq(schema.users.email, persona.email),
      });

      // Resolve the organisation this persona should belong to, as a tri-state
      // rather than a bare `string | null` — null used to mean both "resolved
      // to no organisation" (organisation: 'none') and "could not resolve one
      // yet" ('own' under --verify, before its org row exists). Those needed
      // different treatment: 'none' must be asserted and cleared if drifted;
      // 'unresolved' must be skipped, not mistaken for 'none'. J-01 / D-23.
      type OrgResolution = { kind: 'id'; id: string } | { kind: 'none' } | { kind: 'unresolved' };
      let orgResolution: OrgResolution;
      if (persona.organisation === 'hub') {
        orgResolution = hubOrg ? { kind: 'id', id: hubOrg.id } : { kind: 'unresolved' };
      } else if (persona.organisation === 'own') {
        const slug = `demo-${persona.key.toLowerCase()}`;
        let own = await db.query.organisations.findFirst({
          where: eq(schema.organisations.slug, slug),
        });
        if (!own && existing?.organisationId) {
          // Persona already has an organisation — keep it.
          orgResolution = { kind: 'id', id: existing.organisationId };
        } else if (!own) {
          if (!dryRun) {
            const [created] = await db
              .insert(schema.organisations)
              .values({
                name: `${persona.name} (Demo)`,
                type: 'contractor',
                slug,
                verified: true,
              })
              .returning();
            own = created;
          }
          orgResolution = own ? { kind: 'id', id: own.id } : { kind: 'unresolved' };
        } else {
          orgResolution = { kind: 'id', id: own.id };
        }
      } else {
        // persona.organisation === 'none' — this persona must have NO organisation.
        orgResolution = { kind: 'none' };
      }

      if (!existing) {
        if (!dryRun) {
          const [made] = await db
            .insert(schema.users)
            .values({
              email: persona.email,
              passwordHash: await bcrypt.hash(personaPassword, 10),
              name: persona.name,
              role: persona.role,
              organisationId: orgResolution.kind === 'id' ? orgResolution.id : null,
            })
            .returning();
          // Furniture below is scoped by persona id, so a just-created persona
          // must land in the map too — otherwise the first restore on a fresh
          // environment reports its own furniture as missing.
          if (made) personaIds.set(persona.key, made.id);
        } else {
          // A missing persona is precisely what made the production smoke
          // workflow fail for months: global-setup logs in as every persona
          // before any test runs. verify must not call that "ready".
          problems.push({
            severity: 'error',
            message: `demo persona missing: ${persona.email} (${persona.role}) — logins will fail`,
          });
        }
        console.log(
          `  ${dryRun ? 'would create' : 'created    '} ${persona.email} (${persona.role})`,
        );
        continue;
      }

      // Converge rather than skip, so a drifted role is corrected. (Staging had
      // buyer@example.com sitting as hub_staff, which would fail buyer tests.)
      personaIds.set(persona.key, existing.id);
      const roleDrifted = existing.role !== persona.role;
      // J-01: a 'none' persona drifts if it carries ANY organisation; an 'id'
      // persona drifts if it carries a DIFFERENT one; 'unresolved' is never
      // asserted — we don't yet know what it should be.
      const orgDrifted =
        orgResolution.kind === 'id'
          ? existing.organisationId !== orgResolution.id
          : orgResolution.kind === 'none'
            ? existing.organisationId !== null
            : false;
      const passwordOk = await bcrypt.compare(personaPassword, existing.passwordHash);

      if (!roleDrifted && !orgDrifted && passwordOk) {
        console.log(`  ok          ${persona.email}`);
        continue;
      }

      let orgFixLabel: string | null = null;
      if (orgDrifted) {
        if (orgResolution.kind === 'none') {
          const strandedOrg = existing.organisationId
            ? await db.query.organisations.findFirst({
                where: eq(schema.organisations.id, existing.organisationId),
              })
            : undefined;
          orgFixLabel = `organisation: should have none, has "${strandedOrg?.name ?? existing.organisationId}"`;
        } else {
          orgFixLabel = 'organisation';
        }
      }

      const fixes = [
        roleDrifted ? `role ${existing.role}->${persona.role}` : null,
        orgFixLabel,
        passwordOk ? null : 'password',
      ].filter(Boolean);

      if (!dryRun) {
        await db
          .update(schema.users)
          .set({
            role: persona.role,
            ...(orgResolution.kind === 'id'
              ? { organisationId: orgResolution.id }
              : orgResolution.kind === 'none'
                ? { organisationId: null }
                : {}),
            ...(passwordOk ? {} : { passwordHash: await bcrypt.hash(personaPassword, 10) }),
          })
          .where(eq(schema.users.id, existing.id));
      } else {
        problems.push({
          severity: 'error',
          message: `demo persona drifted: ${persona.email} [${fixes.join(', ')}]`,
        });
      }
      console.log(
        `  ${dryRun ? 'would fix   ' : 'fixed       '}${persona.email}  [${fixes.join(', ')}]`,
      );
    }
    console.log('');

    // ── 1. Curated passports: converge to the catalogue, then rehash ─────────
    const curated = await db.select().from(schema.materialPassports).where(curatedFilter);
    const catalogueByKey = new Map(CATALOG.map((product) => [product.key, product]));
    const catalogueKeyFor = (passport: (typeof curated)[number]): string | undefined => {
      const metadata = passport.customAttributes ?? {};
      const key = metadata['catalogueKey'];
      if (typeof key === 'string' && catalogueByKey.has(key)) return key;
      return CATALOG.find((product) => product.passport.productName === passport.productName)?.key;
    };
    const byName = new Map(curated.map((p) => [p.productName, p]));

    // demo-replenish.ts appends a "— Demo Lot NNN" suffix to every lot it
    // creates beyond the original (demo-replenish.ts's displayName()), and
    // production's history shows even a product's original passport can end
    // up replaced by a suffixed lot 001 — but the bare, un-suffixed name
    // seed-products.ts gives a freshly-seeded original is just as valid.
    // byName's keys are whatever productName each row actually has, so it
    // can find the bare original but never a suffixed lot, and cannot answer
    // "does a passport exist for catalogue product X" reliably. byCatalogueKey
    // answers that correctly via catalogueKeyFor, picking the lowest-numbered
    // lot as the representative passport when more than one exists (matching
    // demo-trim-active's own "lowest-numbered lot survives" convention). A
    // row with no demoLotNumber only ever resolves a key via catalogueKeyFor's
    // bare-name fallback, which requires an exact match to the catalogue's
    // canonical name — i.e. it can only be the original, un-replenished
    // passport, so it is lot 1 by definition (matching demo-replenish.ts's
    // own lotNumber() fallback), never lower-priority than a numbered lot.
    const lotNumber = (passport: (typeof curated)[number]): number => {
      const value = (passport.customAttributes as Record<string, unknown> | null)?.[
        'demoLotNumber'
      ];
      return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
    };
    const byCatalogueKey = new Map<string, (typeof curated)[number]>();
    for (const p of curated) {
      const key = catalogueKeyFor(p);
      if (!key) continue;
      const existing = byCatalogueKey.get(key);
      if (!existing || lotNumber(p) < lotNumber(existing)) byCatalogueKey.set(key, p);
    }

    console.log(`Curated catalogue (${curated.length}/${CATALOG.length} present):`);

    // Rows wearing the curated tag that the catalogue does not define. They are
    // never converged (the loop iterates CATALOG), so they drift silently and
    // will render "Mismatch" on the public passport page.
    for (const extra of curated.filter((p) => !catalogueKeyFor(p))) {
      problems.push({
        severity: 'error',
        message:
          `"${extra.productName}" carries the curated tag but is not in the catalogue — ` +
          'it is never converged and may show "Mismatch" publicly. Remove it, or add it ' +
          'to scripts/lib/catalogue.ts.',
      });
    }

    // Two rows with the same product name make the catalogue lookup ambiguous
    // (the map keeps one of them), which previously surfaced as a misleading
    // "has no listing" error against a product that clearly had one.
    const nameCounts = new Map<string, number>();
    for (const p of curated)
      nameCounts.set(p.productName, (nameCounts.get(p.productName) ?? 0) + 1);
    for (const [name, count] of nameCounts) {
      if (count > 1) {
        problems.push({
          severity: 'error',
          message: `${count} curated passports share the name "${name}" — ambiguous; remove the duplicate`,
        });
      }
    }

    const missing = CATALOG.filter((c) => !byCatalogueKey.has(c.key));
    for (const m of missing) {
      problems.push({
        severity: 'error',
        message:
          `curated passport missing: "${m.passport.productName}" — this script cannot ` +
          're-create it (needs the MinIO photo upload). Fix with:\n' +
          '       pnpm --filter @trace/db seed:products -- --unseed --yes && ' +
          'pnpm --filter @trace/db seed:products\n' +
          '       (note: that re-mints UUIDs, invalidating any printed QR codes)',
      });
    }

    for (const product of CATALOG) {
      const existing = byName.get(product.passport.productName!);
      if (!existing) continue;

      // Converge the catalogue-owned fields. status is set to 'listed' because
      // that is what an actively-listed curated product should be; it is no
      // longer part of the fingerprint, so this cannot break verify-integrity.
      const desired = {
        ...product.passport,
        status: 'listed' as const,
        customAttributes: { seedSource: SEED_TAG },
      };

      const drifted = (Object.keys(desired) as (keyof typeof desired)[]).filter((key) => {
        if (RELATIVE_DATE_FIELDS.has(key as string)) return false;
        const want = desired[key];
        const have = (existing as Record<string, unknown>)[key as string];
        if (want instanceof Date && have instanceof Date) return want.getTime() !== have.getTime();
        return stableStringify(want) !== stableStringify(have);
      });

      // Never write a relative date back — see RELATIVE_DATE_FIELDS.
      for (const field of RELATIVE_DATE_FIELDS) {
        delete (desired as Record<string, unknown>)[field];
      }

      if (drifted.length > 0 && !dryRun) {
        await db
          .update(schema.materialPassports)
          .set({ ...desired, updatedAt: new Date() })
          .where(eq(schema.materialPassports.id, existing.id));
      }

      // Recompute the fingerprint from the PERSISTED row, never from an
      // in-memory merge of catalogue values. The canonical document is built
      // with JSON.stringify, and Postgres JSONB normalises key order — so a
      // catalogue-authored object and its stored form serialise differently
      // and hash differently, even though they are the same data. Hashing the
      // merge produced fingerprints that failed the very check this script
      // makes. Never touch a passport that is anchored on chain.
      const fresh =
        drifted.length > 0 && !dryRun
          ? (await db.query.materialPassports.findFirst({
              where: eq(schema.materialPassports.id, existing.id),
            }))!
          : existing;

      const wantHash = computePassportHash(fresh as typeof existing);
      const hashDrifted = fresh.blockchainPassportHash !== wantHash;

      if (hashDrifted && fresh.blockchainTxHash) {
        problems.push({
          severity: 'warning',
          message:
            `"${product.passport.productName}" is anchored on chain (${fresh.blockchainTxHash}) ` +
            'but its fingerprint no longer matches — needs a re-anchor, not a rehash. Skipped.',
        });
      } else if (hashDrifted && !dryRun) {
        await db
          .update(schema.materialPassports)
          .set({
            blockchainPassportHash: wantHash,
            blockchainAnchoredAt: fresh.blockchainAnchoredAt ?? new Date(),
            blockchainTxHash: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.materialPassports.id, existing.id));
      } else if (hashDrifted && dryRun) {
        problems.push({
          severity: 'error',
          message: `"${product.passport.productName}" fingerprint mismatch — verify-integrity would fail`,
        });
      }

      const changes = [
        drifted.length > 0 ? `${drifted.length} field(s): ${drifted.join(', ')}` : null,
        hashDrifted ? 'fingerprint' : null,
      ].filter(Boolean);

      console.log(
        `  ${changes.length ? (dryRun ? 'would fix' : 'fixed   ') : 'ok      '} ${product.passport.productName}` +
          (changes.length ? `  [${changes.join('; ')}]` : ''),
      );
    }

    const curatedIds = curated.map((p) => p.id);

    // ── 2. Curated listings: exactly one, active, never expiring ─────────────
    if (curatedIds.length > 0) {
      const listings = await db
        .select()
        .from(schema.listings)
        .where(inArray(schema.listings.passportId, curatedIds));

      const byPassport = new Map<string, typeof listings>();
      for (const l of listings) {
        byPassport.set(l.passportId, [...(byPassport.get(l.passportId) ?? []), l]);
      }

      let listingFixes = 0;
      let duplicatesCancelled = 0;

      for (const product of CATALOG) {
        const passport = byName.get(product.passport.productName!);
        if (!passport) continue;
        const own = (byPassport.get(passport.id) ?? []).sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );

        if (own.length === 0) {
          problems.push({
            severity: 'error',
            message: `"${product.passport.productName}" has no listing — it will not appear on the marketplace`,
          });
          continue;
        }

        const [keep, ...extras] = own;
        const needsFix =
          keep!.status !== 'active' ||
          keep!.expiresAt !== null ||
          keep!.pricePence !== product.listing.pricePence ||
          keep!.quantity !== product.listing.quantity;

        if (needsFix) {
          listingFixes += 1;
          if (!dryRun) {
            await db
              .update(schema.listings)
              .set({
                status: 'active',
                expiresAt: null,
                pricePence: product.listing.pricePence,
                quantity: product.listing.quantity,
              })
              .where(eq(schema.listings.id, keep!.id));
          }
        }

        for (const extra of extras) {
          if (extra.status === 'cancelled') continue;
          duplicatesCancelled += 1;
          if (!dryRun) {
            await db
              .update(schema.listings)
              .set({ status: 'cancelled' })
              .where(eq(schema.listings.id, extra.id));
          }
        }
      }

      console.log(
        `\nCurated listings: ${dryRun ? 'would fix' : 'fixed'} ${listingFixes}` +
          `, ${dryRun ? 'would cancel' : 'cancelled'} ${duplicatesCancelled} duplicate(s)`,
      );

      // ── 3. Clear curated in-flight transactions ───────────────────────────
      // J-09: 'disputed' and 'resolved' are non-terminal from a demo's point of
      // view too — D-31 means nothing in the product can ever move a disputed
      // transaction on, so without this it is permanent. Note this cancel step
      // does NOT recover the listing itself: section 2 above already forces the
      // kept listing back to status:'active' unconditionally, independent of
      // any transaction — verified by reading it, not assumed.
      const curatedListingIds = listings.map((l) => l.id);
      if (curatedListingIds.length > 0) {
        const stale = await db
          .select({ id: schema.transactions.id })
          .from(schema.transactions)
          .where(
            and(
              inArray(schema.transactions.listingId, curatedListingIds),
              inArray(schema.transactions.status, ['pending', 'confirmed', 'disputed', 'resolved']),
            ),
          );
        if (stale.length > 0 && !dryRun) {
          await db
            .update(schema.transactions)
            .set({ status: 'cancelled' })
            .where(
              inArray(
                schema.transactions.id,
                stale.map((s) => s.id),
              ),
            );
        }
        console.log(
          `Curated transactions: ${dryRun ? 'would clear' : 'cleared'} ${stale.length} in-flight`,
        );

        // ── 3a. Remove historical transactions on curated listings ────────────
        // J-09: cancelling alone leaves the exact clutter the finding complains
        // about — a buyer's Orders screen full of old cancelled/disputed rows
        // from past demo sessions. Scope is intentionally narrow: only
        // transactions whose listing is on a curated (seedSource-tagged)
        // passport are ever touched, so a real attendee's order history on a
        // non-curated listing is never in range. `transactions` has no
        // incoming foreign keys (verified via pg_constraint before writing
        // this), so removing rows cannot orphan anything.
        const historical = await db
          .select({ id: schema.transactions.id })
          .from(schema.transactions)
          .where(inArray(schema.transactions.listingId, curatedListingIds));
        if (historical.length > 0 && !dryRun) {
          await db.delete(schema.transactions).where(
            inArray(
              schema.transactions.id,
              historical.map((h) => h.id),
            ),
          );
        }
        console.log(
          `Curated transactions: ${dryRun ? 'would remove' : 'removed'} ${historical.length} historical`,
        );
      }
    }

    // ── 3b. Demo furniture: the non-marketplace demo beats ───────────────────
    // Scoped by demo-owned identity (see lib/demo-content.ts) rather than the
    // seedSource tag, because these three tables have no customAttributes
    // column. Bounded just as tightly: only rows belonging to a platform-owned
    // persona are ever touched. Visitor feedback is never deleted.
    if (furniture) {
      console.log('\nDemo furniture:');
      const inspectorId = personaIds.get('inspector');
      const applicantId = personaIds.get('applicant');

      // Quality report — gives the inspector journey and the passport detail
      // page something real to show. Looked up by catalogueKey, not byName —
      // see the comment above byCatalogueKey's definition.
      const qualityReportKey = CATALOG.find(
        (c) => c.passport.productName === DEMO_QUALITY_REPORT.productName,
      )?.key;
      const target = qualityReportKey ? byCatalogueKey.get(qualityReportKey) : undefined;
      if (!inspectorId || !target) {
        problems.push({
          severity: 'error',
          message: `cannot seed the demo quality report — ${!inspectorId ? 'inspector persona' : `"${DEMO_QUALITY_REPORT.productName}"`} is missing`,
        });
      } else {
        const existingReports = await db
          .select()
          .from(schema.qualityReports)
          .where(
            and(
              eq(schema.qualityReports.inspectorId, inspectorId),
              eq(schema.qualityReports.passportId, target.id),
            ),
          );

        if (existingReports.length === 0) {
          if (!dryRun) {
            await db.insert(schema.qualityReports).values({
              passportId: target.id,
              inspectorId,
              structuralScore: DEMO_QUALITY_REPORT.structuralScore,
              aestheticScore: DEMO_QUALITY_REPORT.aestheticScore,
              environmentalScore: DEMO_QUALITY_REPORT.environmentalScore,
              overallGrade: DEMO_QUALITY_REPORT.overallGrade,
              reportNotes: DEMO_QUALITY_REPORT.reportNotes,
              photoUrls: target.conditionPhotos ?? [],
              createdAt: new Date(Date.now() - DEMO_QUALITY_REPORT.ageDays * 24 * HOUR),
            });
          } else {
            problems.push({
              severity: 'error',
              message:
                'demo quality report missing — the inspector journey demos onto an empty screen',
            });
          }
          console.log(
            `  ${dryRun ? 'would create' : 'created    '} quality report on "${DEMO_QUALITY_REPORT.productName}"`,
          );
        } else {
          // Converge the newest; remove any extras this inspector left on it.
          const [keep, ...extras] = existingReports.sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
          const drifted =
            keep!.overallGrade !== DEMO_QUALITY_REPORT.overallGrade ||
            keep!.reportNotes !== DEMO_QUALITY_REPORT.reportNotes ||
            keep!.disputed;
          if (drifted && !dryRun) {
            await db
              .update(schema.qualityReports)
              .set({
                structuralScore: DEMO_QUALITY_REPORT.structuralScore,
                aestheticScore: DEMO_QUALITY_REPORT.aestheticScore,
                environmentalScore: DEMO_QUALITY_REPORT.environmentalScore,
                overallGrade: DEMO_QUALITY_REPORT.overallGrade,
                reportNotes: DEMO_QUALITY_REPORT.reportNotes,
                disputed: false,
              })
              .where(eq(schema.qualityReports.id, keep!.id));
          } else if (drifted && dryRun) {
            // J-08: this was a silent verify blind spot — a re-graded, reworded
            // or disputed demo report passed with no problem pushed.
            problems.push({
              severity: 'error',
              message: 'demo quality report has drifted (re-graded, reworded, or disputed)',
            });
          }
          if (extras.length > 0 && !dryRun) {
            await db.delete(schema.qualityReports).where(
              inArray(
                schema.qualityReports.id,
                extras.map((e) => e.id),
              ),
            );
          } else if (extras.length > 0 && dryRun) {
            problems.push({
              severity: 'error',
              message: `${extras.length} duplicate demo quality report(s) beyond the one kept`,
            });
          }
          console.log(
            `  ${drifted || extras.length ? (dryRun ? 'would fix   ' : 'fixed       ') : 'ok          '}quality report` +
              (extras.length ? ` (${extras.length} extra removed)` : ''),
          );
        }
      }

      // Pending access request — the governance queue.
      if (!applicantId) {
        problems.push({
          severity: 'error',
          message: 'applicant persona missing — governance queue is empty',
        });
      } else {
        const reqs = await db
          .select()
          .from(schema.betaAccessRequests)
          .where(eq(schema.betaAccessRequests.userId, applicantId));

        if (reqs.length === 0) {
          if (!dryRun) {
            await db.insert(schema.betaAccessRequests).values({
              userId: applicantId,
              requestedRole: DEMO_ACCESS_REQUEST.requestedRole,
              organisationName: DEMO_ACCESS_REQUEST.organisationName,
              notes: DEMO_ACCESS_REQUEST.notes,
              status: 'pending',
              createdAt: new Date(Date.now() - DEMO_ACCESS_REQUEST.ageDays * 24 * HOUR),
            });
          } else {
            problems.push({
              severity: 'error',
              message:
                'demo access request missing — the governance walkthrough has nothing to review',
            });
          }
          console.log(`  ${dryRun ? 'would create' : 'created    '} pending access request`);
        } else {
          // Reset it to pending — a facilitator approving it live is expected.
          const [keep, ...extras] = reqs.sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
          );
          const wasReviewed = keep!.status !== 'pending';
          if (wasReviewed && !dryRun) {
            await db
              .update(schema.betaAccessRequests)
              .set({
                status: 'pending',
                reviewedBy: null,
                reviewedAt: null,
                reviewNotes: null,
                targetOrganisationId: null,
                updatedAt: new Date(),
              })
              .where(eq(schema.betaAccessRequests.id, keep!.id));
          }
          if (extras.length > 0 && !dryRun) {
            await db.delete(schema.betaAccessRequests).where(
              inArray(
                schema.betaAccessRequests.id,
                extras.map((e) => e.id),
              ),
            );
          } else if (extras.length > 0 && dryRun) {
            // J-08: another silent verify blind spot — a duplicate pending
            // request from the applicant persona itself passed with no problem.
            problems.push({
              severity: 'error',
              message: `${extras.length} duplicate demo access request(s) beyond the one kept`,
            });
          }
          if (wasReviewed && dryRun) {
            problems.push({
              severity: 'error',
              message: `demo access request is "${keep!.status}", not pending — nothing to review`,
            });
          }
          console.log(
            `  ${wasReviewed || extras.length ? (dryRun ? 'would fix   ' : 'fixed       ') : 'ok          '}access request` +
              (wasReviewed ? ` (was ${keep!.status})` : ''),
          );
        }
      }

      // Feedback — ensured present, never deleted (real visitor feedback is a
      // feature of the demo, not noise).
      for (const fb of DEMO_FEEDBACK) {
        const seen = await db
          .select({ id: schema.feedbackSubmissions.id })
          .from(schema.feedbackSubmissions)
          .where(eq(schema.feedbackSubmissions.message, fb.message));
        if (seen.length === 0) {
          if (!dryRun) {
            await db.insert(schema.feedbackSubmissions).values({
              userId: applicantId ?? null,
              rating: fb.rating,
              category: fb.category,
              message: fb.message,
              pageUrl: fb.pageUrl,
              createdAt: new Date(Date.now() - fb.ageDays * 24 * HOUR),
            });
          }
          console.log(`  ${dryRun ? 'would create' : 'created    '} feedback (${fb.rating}★)`);
        } else {
          console.log('  ok          feedback');
        }
      }
    }

    // ── 4. Sweep visitor-created listings (opt-in) ───────────────────────────
    if (sweep) {
      const cutoff = new Date(Date.now() - LISTING_TTL_HOURS * HOUR);
      const strays = await db
        .select({ id: schema.listings.id, name: schema.materialPassports.productName })
        .from(schema.listings)
        .innerJoin(
          schema.materialPassports,
          eq(schema.listings.passportId, schema.materialPassports.id),
        )
        .where(
          and(
            eq(schema.listings.status, 'active'),
            lt(schema.listings.createdAt, cutoff),
            // No exclusion needed when nothing is curated. The previous
            // sentinel (ne(id, '')) crashed with `invalid input syntax for
            // type uuid: ""`; drizzle's and() simply drops undefined.
            curatedIds.length > 0 ? notInArray(schema.listings.passportId, curatedIds) : undefined,
          ),
        );

      if (strays.length > 0 && !dryRun) {
        await db
          .update(schema.listings)
          .set({ status: 'cancelled' })
          .where(
            inArray(
              schema.listings.id,
              strays.map((s) => s.id),
            ),
          );
      }
      console.log(
        `\nSweep: ${dryRun ? 'would cancel' : 'cancelled'} ${strays.length} visitor listing(s) ` +
          `older than ${LISTING_TTL_HOURS}h (passports and accounts untouched)`,
      );
      for (const s of strays) console.log(`  - ${s.name}`);
    }

    // Demo verifier invariants.
    const finalListings = await db
      .select({ id: schema.listings.id, passportId: schema.listings.passportId })
      .from(schema.listings)
      .innerJoin(
        schema.materialPassports,
        eq(schema.listings.passportId, schema.materialPassports.id),
      )
      .where(and(eq(schema.listings.status, 'active'), curatedFilter));

    const finalCurated = await db.select().from(schema.materialPassports).where(curatedFilter);
    const finalCuratedById = new Map(finalCurated.map((passport) => [passport.id, passport]));
    const badHashes = finalCurated.filter(
      (p) => p.blockchainPassportHash !== computePassportHash(p),
    );

    // Replenished lots use catalogueKey, not their display name. The legacy
    // catalogue verifies one active listing per product; the public demo
    // verifies its configured active target per product.
    const activeByCatalogueKey = new Map<string, number>();
    for (const listing of finalListings) {
      const passport = finalCuratedById.get(listing.passportId);
      const key = passport ? catalogueKeyFor(passport) : undefined;
      if (key) activeByCatalogueKey.set(key, (activeByCatalogueKey.get(key) ?? 0) + 1);
    }
    const replenishedLots = finalCurated.some(
      (passport) => typeof (passport.customAttributes ?? {})['catalogueKey'] === 'string',
    );
    const expectedPerProduct = replenishedLots ? targetActive : 1;
    for (const product of CATALOG) {
      const actual = activeByCatalogueKey.get(product.key) ?? 0;
      if (actual !== expectedPerProduct) {
        problems.push({
          severity: 'error',
          message:
            `${product.key}: expected ${expectedPerProduct} active catalogue listing(s), found ${actual}` +
            (dryRun ? ' - run demo:replenish to fix' : ''),
        });
      }
    }
    // Runs in every mode. Previously this was !dryRun-only, so a curated-tagged
    // passport that is NOT in the catalogue (a duplicate, or a hand-tagged row)
    // never reached the per-product loop and never reached here either: verify
    // printed "Fingerprints matching : 7/8" and still said "Demo is ready".
    // Anyone opening that passport sees "Mismatch".
    for (const p of badHashes) {
      problems.push({
        severity: 'error',
        message: dryRun
          ? `"${p.productName}" fingerprint mismatch — verify-integrity would fail`
          : `"${p.productName}" fingerprint still mismatched after restore`,
      });
    }

    // Demo mode lives only in the deployment's .env, which is not
    // version-controlled. If it is off without contracts deployed, every
    // passport created during a demo stays on "Pending verification" forever
    // and the trust moment simply never happens — so check it here rather than
    // discovering it live.
    const simulateAnchor = process.env['DEMO_SIMULATE_ANCHOR'] === 'true';
    const registryAddress = process.env['MATERIAL_REGISTRY_ADDRESS'];
    if (!simulateAnchor && !registryAddress) {
      problems.push({
        severity: 'error',
        message:
          'DEMO_SIMULATE_ANCHOR is not true and no MATERIAL_REGISTRY_ADDRESS is set — ' +
          'passports created during a demo will never show the trust seal.\n' +
          "       Set DEMO_SIMULATE_ANCHOR=true in this deployment's .env.",
      });
    }

    // Furniture invariants — run in EVERY mode. An empty inspector screen or an
    // empty governance queue is a broken demo beat, not a cosmetic nicety.
    // J-08 / D-21: this block used to be wrapped in `if (!dryRun)`, directly
    // contradicting this very comment — demo:verify reported the counts but
    // never asserted them, so a missing pending request or a short feedback
    // count both passed as "Demo is ready". Unwrapped now; the counts
    // themselves already ran in every mode.
    let furnitureSummary = '';
    if (furniture) {
      const inspectorId = personaIds.get('inspector');
      const applicantId = personaIds.get('applicant');

      const reportCount = inspectorId
        ? (
            await db
              .select({ id: schema.qualityReports.id })
              .from(schema.qualityReports)
              .where(eq(schema.qualityReports.inspectorId, inspectorId))
          ).length
        : 0;
      const pendingCount = applicantId
        ? (
            await db
              .select({ id: schema.betaAccessRequests.id })
              .from(schema.betaAccessRequests)
              .where(
                and(
                  eq(schema.betaAccessRequests.userId, applicantId),
                  eq(schema.betaAccessRequests.status, 'pending'),
                ),
              )
          ).length
        : 0;
      const feedbackCount = (
        await db
          .select({ id: schema.feedbackSubmissions.id })
          .from(schema.feedbackSubmissions)
          .where(
            inArray(
              schema.feedbackSubmissions.message,
              DEMO_FEEDBACK.map((f) => f.message),
            ),
          )
      ).length;

      if (reportCount < 1) {
        problems.push({ severity: 'error', message: 'no demo quality report after restore' });
      }
      if (pendingCount !== 1) {
        problems.push({
          severity: 'error',
          message: `expected exactly 1 pending demo access request, found ${pendingCount}`,
        });
      }
      if (feedbackCount < DEMO_FEEDBACK.length) {
        problems.push({
          severity: 'error',
          message: `expected ${DEMO_FEEDBACK.length} seeded feedback entries, found ${feedbackCount}`,
        });
      }

      furnitureSummary =
        `Quality reports         : ${reportCount}\n` +
        `Governance queue        : ${pendingCount} pending request, ${feedbackCount} feedback\n`;

      // J-08: the counts above are deliberately scoped to demo-owned identity
      // (see lib/demo-content.ts) so real visitor activity never inflates
      // them — that scoping is correct and stays. What was missing is any
      // check for what sits ALONGSIDE the seeded rows: on staging this found
      // 5 extra pending requests and 2 extra feedback entries, all clearly
      // e2e-test residue (`buyer-edit-<epoch>@example.com`,
      // `Page: http://localhost:4004/dashboard`), invisible to demo:verify.
      //
      // Real rows are only a WARNING, never an error — demo:verify also runs
      // against demo-production, the client-facing box where real leads
      // legitimately submit access requests and feedback. Turning every
      // extra row into an error there would paint it permanently red and the
      // check would stop being trusted. Only unambiguously machine-generated
      // rows fail the build.
      const otherPending = await db
        .select({
          id: schema.betaAccessRequests.id,
          email: schema.users.email,
        })
        .from(schema.betaAccessRequests)
        .innerJoin(schema.users, eq(schema.betaAccessRequests.userId, schema.users.id))
        .where(
          and(
            eq(schema.betaAccessRequests.status, 'pending'),
            applicantId ? notInArray(schema.betaAccessRequests.userId, [applicantId]) : undefined,
          ),
        );
      const E2E_EMAIL = /-\d{10,}@/; // e.g. buyer-edit-1777644475657@example.com
      const machineGenerated = otherPending.filter((r) => E2E_EMAIL.test(r.email));
      const realResidue = otherPending.filter((r) => !E2E_EMAIL.test(r.email));
      if (machineGenerated.length > 0) {
        problems.push({
          severity: 'error',
          message:
            `${machineGenerated.length} pending access request(s) beyond the demo applicant look ` +
            `like test residue: ${machineGenerated.map((r) => r.email).join(', ')} — ` +
            'reject them from /admin/access-requests (this script never deletes a request for a real account)',
        });
      }
      if (realResidue.length > 0) {
        problems.push({
          severity: 'warning',
          message:
            `${realResidue.length} pending access request(s) from real accounts are also in the ` +
            `governance queue — expected on a client-facing deployment, worth knowing about before a demo`,
        });
      }

      const otherFeedback = await db
        .select({ id: schema.feedbackSubmissions.id, pageUrl: schema.feedbackSubmissions.pageUrl })
        .from(schema.feedbackSubmissions)
        .where(
          notInArray(
            schema.feedbackSubmissions.message,
            DEMO_FEEDBACK.map((f) => f.message),
          ),
        );
      const localGenerated = otherFeedback.filter((r) => (r.pageUrl ?? '').includes('localhost'));
      const realFeedback = otherFeedback.filter((r) => !(r.pageUrl ?? '').includes('localhost'));
      if (localGenerated.length > 0) {
        problems.push({
          severity: 'error',
          message:
            `${localGenerated.length} feedback submission(s) reference localhost — test/smoke residue, ` +
            'not a real visitor (this script never deletes feedback; remove by id if it must go)',
        });
      }
      if (realFeedback.length > 0) {
        problems.push({
          severity: 'warning',
          message: `${realFeedback.length} feedback submission(s) beyond the seeded set — real visitor feedback, left as-is`,
        });
      }
    }

    console.log('\n─────────────────────────────────────────────');
    console.log(
      `Anchor mode             : ${simulateAnchor ? 'simulated' : registryAddress ? 'on-chain' : 'NONE'}`,
    );
    if (furnitureSummary) process.stdout.write(furnitureSummary);
    console.log(`Active curated listings : ${finalListings.length}/${CATALOG.length}`);
    console.log(
      `Fingerprints matching   : ${finalCurated.length - badHashes.length}/${finalCurated.length}`,
    );

    const errors = problems.filter((p) => p.severity === 'error');
    const warnings = problems.filter((p) => p.severity === 'warning');

    for (const w of warnings) console.log(`\nWARNING: ${w.message}`);
    for (const e of errors) console.log(`\nPROBLEM: ${e.message}`);

    if (errors.length > 0) {
      console.log(`\n${errors.length} problem(s) — demo is NOT ready.\n`);
      process.exitCode = 1;
    } else {
      console.log(`\nDemo is ready.${warnings.length ? ` (${warnings.length} warning(s))` : ''}\n`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
