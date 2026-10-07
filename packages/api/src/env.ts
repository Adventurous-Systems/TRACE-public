import { z } from 'zod';
import { PASSPORT_PHOTOS_MAX, PHOTO_UPLOAD_MAX_BYTES } from '@trace/core';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  // Server
  API_PORT: z.coerce.number().int().default(3001),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().max(10_000).default(100),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:3001'),
  ANCHOR_WORKER_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  TRACE_DEPLOYMENT_PROFILE: z
    .enum(['self_hosted', 'public_showcase', 'public_buyer_demo', 'public_sandbox'])
    .default('self_hosted'),

  // Auth
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRY: z.string().default('7d'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Blockchain. CHAIN_KIND picks the adapter in lib/chain/; only 'vechain'
  // exists today (Thor Solo, testnet or mainnet, chosen by VECHAIN_NODE_URL).
  CHAIN_KIND: z.enum(['vechain']).default('vechain'),
  // Human-readable network name shown in the UI next to on-chain anchors,
  // e.g. "TRACE demo chain (VeChain Thor Solo)". Never claim testnet/mainnet
  // here unless the node really is one.
  CHAIN_NETWORK_LABEL: z
    .string()
    .optional()
    .transform((v) => v || undefined),

  // VeChain
  VECHAIN_NODE_URL: z.string().url().default('http://localhost:8669'),
  DEPLOYER_PRIVATE_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v !== '0x' ? v : undefined))
    .pipe(
      z
        .string()
        .regex(
          /^0x[0-9a-fA-F]{64}$/,
          'DEPLOYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string',
        )
        .optional(),
    ),
  WALLET_ENCRYPTION_KEY: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.string().min(16).optional()),
  MATERIAL_REGISTRY_ADDRESS: z.string().optional(),
  MARKETPLACE_ADDRESS: z.string().optional(),
  CBT_ADDRESS: z.string().optional(),
  QUALITY_ASSURANCE_ADDRESS: z.string().optional(),
  IOT_ORACLE_ADDRESS: z.string().optional(),
  GOVERNANCE_ADDRESS: z.string().optional(),
  HUB_REGISTRY_ADDRESS: z.string().optional(),
  CONTRACT_REGISTRY_ADDRESS: z.string().optional(),
  FEE_DELEGATOR_URL: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.string().url().optional()),
  FEE_DELEGATOR_PRIVATE_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v !== '0x' ? v : undefined))
    .pipe(
      z
        .string()
        .regex(
          /^0x[0-9a-fA-F]{64}$/,
          'FEE_DELEGATOR_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string',
        )
        .optional(),
    ),
  FEE_DELEGATION_REQUIRED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  // Demo/showcase: when true, passports get a real keccak256 fingerprint marked
  // "trust layer prepared" instead of a real on-chain VeChain transaction. Use only with synthetic demo data; never describe it as an on-chain anchor.
  DEMO_SIMULATE_ANCHOR: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  VTHO_WARNING_THRESHOLD_WEI: z.string().default('10000000000000000000'),
  VTHO_CRITICAL_THRESHOLD_WEI: z.string().default('1000000000000000000'),

  // Object storage: plain files under STORAGE_DIR, served by nginx at
  // STORAGE_PUBLIC_URL/<bucket>/<key>. MINIO_PUBLIC_URL is the setting it
  // replaced, still read so an existing environment file keeps working.
  STORAGE_DIR: z.string().default('/var/lib/trace/objects'),
  STORAGE_PUBLIC_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  MINIO_PUBLIC_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  // Upload limits (owner, 2026-10-07): per file, photos per passport, bytes
  // stored per organisation, and the free disk below which uploads stop.
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(PHOTO_UPLOAD_MAX_BYTES),
  PASSPORT_PHOTOS_MAX: z.coerce.number().int().positive().default(PASSPORT_PHOTOS_MAX),
  ORG_STORAGE_QUOTA_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(100 * 1024 * 1024),
  STORAGE_MIN_FREE_BYTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(5 * 1024 * 1024 * 1024),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return result.data;
}

export const env = parseEnv();
export type Env = z.infer<typeof envSchema>;
