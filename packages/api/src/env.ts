import { z } from 'zod';

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

  // MinIO
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().default(9000),
  MINIO_USE_SSL: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  MINIO_PUBLIC_READ: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_BUCKET_PASSPORTS: z.string().default('passports'),
  MINIO_BUCKET_REPORTS: z.string().default('reports'),
  MINIO_PUBLIC_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
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
