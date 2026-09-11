import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_PERSONAS, demoPersonaPassword } from '@trace/core/constants/demo-personas';

export type Role = 'supplier' | 'supplier2' | 'hubStaff' | 'buyer' | 'platformAdmin';

export interface Account {
  role: Role;
  email: string;
  password: string;
}

const passwordFor = (persona: (typeof DEMO_PERSONAS)[keyof typeof DEMO_PERSONAS]): string =>
  process.env.E2E_READ_ONLY === '1'
    ? 'unused-read-only-smoke'
    : demoPersonaPassword(persona, process.env);

/**
 * Test accounts, derived from the single demo persona definition in
 * @trace/core so this file can no longer drift from what the demo environment
 * actually contains.
 *
 * Personas are guaranteed by
 * `pnpm --filter @trace/db demo:restore`.
 */
export const ACCOUNTS: Record<Role, Account> = {
  supplier: {
    role: 'supplier',
    email: DEMO_PERSONAS.supplier.email,
    password: passwordFor(DEMO_PERSONAS.supplier),
  },
  supplier2: {
    role: 'supplier2',
    email: DEMO_PERSONAS.supplier2.email,
    password: passwordFor(DEMO_PERSONAS.supplier2),
  },
  hubStaff: {
    role: 'hubStaff',
    email: DEMO_PERSONAS.hubStaff.email,
    password: passwordFor(DEMO_PERSONAS.hubStaff),
  },
  buyer: {
    role: 'buyer',
    email: DEMO_PERSONAS.buyer.email,
    password: passwordFor(DEMO_PERSONAS.buyer),
  },
  platformAdmin: {
    role: 'platformAdmin',
    email: DEMO_PERSONAS.platformAdmin.email,
    password: passwordFor(DEMO_PERSONAS.platformAdmin),
  },
};

/** API origin used by global-setup to mint sessions (same origin as web on the deployed domain). */
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';

const here = path.dirname(fileURLToPath(import.meta.url));
export const STATE_DIR = path.resolve(here, '..', '.auth');
export const statePath = (role: Role): string => path.join(STATE_DIR, `${role}.json`);
