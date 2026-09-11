/**
 * The demo persona set — one definition, used by everything.
 *
 * WHY THIS EXISTS
 * The accounts a demo depends on were previously defined in several places
 * that disagreed about credentials and account lifecycle. That caused checks
 * to fail before any test ran.
 *
 * These are platform-owned demo identities. Demo automation must never modify
 * accounts outside this declared set.
 *
 * `demo:restore` converges this set. `packages/e2e/fixtures/accounts.ts` reads
 * from it, so the readiness check and the demo can never again disagree about
 * who exists.
 */

export type DemoPersonaKey =
  | 'platformAdmin'
  | 'hubAdmin'
  | 'hubStaff'
  | 'inspector'
  | 'buyer'
  | 'supplier'
  | 'supplier2'
  | 'applicant';

export interface DemoPersona {
  key: DemoPersonaKey;
  email: string;
  /** Runtime environment variable containing this account's password. */
  passwordEnv: string;
  name: string;
  /** Matches the application's UserRole values. */
  role: 'platform_admin' | 'hub_admin' | 'hub_staff' | 'inspector' | 'buyer' | 'supplier';
  /**
   * How this persona is attached to an organisation:
   *   'hub'  — the seeded reuse hub (hub_admin / hub_staff need this)
   *   'own'  — its own organisation, created if absent (suppliers list stock)
   *   'none' — no organisation
   */
  organisation: 'hub' | 'own' | 'none';
  /** Shown in the demo run sheet so the presenter knows what each is for. */
  purpose: string;
}

/** Slug of the organisation created by `seed`, used for the 'hub' attachment. */
export const HUB_ORG_SLUG = 'stirling';

export const DEMO_PERSONAS: Record<DemoPersonaKey, DemoPersona> = {
  platformAdmin: {
    key: 'platformAdmin',
    email: 'platform@trace.eco',
    passwordEnv: 'DEMO_PLATFORM_ADMIN_PASSWORD',
    name: 'Platform Admin',
    role: 'platform_admin',
    organisation: 'none',
    purpose: 'Governance walkthrough: access requests and the feedback inbox',
  },
  hubAdmin: {
    key: 'hubAdmin',
    email: 'admin@stirlingreuse.com',
    passwordEnv: 'DEMO_HUB_ADMIN_PASSWORD',
    name: 'Hub Admin',
    role: 'hub_admin',
    organisation: 'hub',
    purpose: 'Owns the curated catalogue; the seller behind every demo listing',
  },
  hubStaff: {
    key: 'hubStaff',
    email: 'staff@stirlingreuse.com',
    passwordEnv: 'DEMO_HUB_STAFF_PASSWORD',
    name: 'Hub Staff',
    role: 'hub_staff',
    organisation: 'hub',
    purpose: 'Registers materials and issues passports',
  },
  inspector: {
    key: 'inspector',
    email: 'inspector@trace.eco',
    passwordEnv: 'DEMO_INSPECTOR_PASSWORD',
    name: 'Quality Inspector',
    role: 'inspector',
    organisation: 'none',
    purpose: 'Quality report workflow',
  },
  buyer: {
    key: 'buyer',
    email: 'buyer@example.com',
    passwordEnv: 'DEMO_BUYER_PASSWORD',
    name: 'Demo Buyer',
    role: 'buyer',
    organisation: 'none',
    purpose: 'Makes an offer on a listing',
  },
  supplier: {
    key: 'supplier',
    email: 'ada.lovelace@example.com',
    passwordEnv: 'DEMO_SUPPLIER_PASSWORD',
    name: 'Ada Lovelace',
    role: 'supplier',
    organisation: 'own',
    purpose: 'Presenter account: registers a material live during the demo',
  },
  supplier2: {
    // A platform-owned address that is guaranteed by demo:restore.
    key: 'supplier2',
    email: 'demo.supplier2@trace.eco',
    passwordEnv: 'DEMO_SUPPLIER2_PASSWORD',
    name: 'Demo Supplier Two',
    role: 'supplier',
    organisation: 'own',
    purpose: 'Second party, so buyer/seller interactions can be shown end to end',
  },
  applicant: {
    // Exists so the governance walk-through has a real pending request to
    // review. It must NOT be an account used for anything else: approving a
    // request rewrites the requester's role and organisation
    // (access-request.service.ts approveAccessRequest), so reusing
    // buyer@example.com would silently break the buyer journey the moment a
    // facilitator approved it live. `buyer` is also the only role permitted to
    // submit a request ("Only buyer accounts can request elevated access").
    key: 'applicant',
    email: 'demo.applicant@trace.eco',
    passwordEnv: 'DEMO_APPLICANT_PASSWORD',
    name: 'Demo Applicant',
    role: 'buyer',
    organisation: 'none',
    purpose: 'Governance queue: the pending access request the platform admin reviews',
  },
};

export const DEMO_PERSONA_LIST: DemoPersona[] = Object.values(DEMO_PERSONAS);

/** Emails owned by the demo system — safe for scripts to converge. */
export const DEMO_PERSONA_EMAILS: string[] = DEMO_PERSONA_LIST.map((p) => p.email);

/** Resolve a persona password without ever committing it to source control. */
export function demoPersonaPassword(
  persona: DemoPersona,
  environment: Record<string, string | undefined>,
): string {
  const password = environment[persona.passwordEnv];
  if (!password || password.length < 16) {
    throw new Error(persona.passwordEnv + ' is required and must contain at least 16 characters');
  }
  return password;
}
