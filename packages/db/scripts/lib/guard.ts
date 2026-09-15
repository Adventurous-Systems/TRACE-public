/**
 * Target guard for destructive database scripts.
 *
 * `reset:marketplace --yes` removes marketplace data. The guard makes the
 * target explicit and fails closed:
 *
 * - the operator must pass `--env <name>`;
 * - the deployment must declare the same `TRACE_ENV`;
 * - a missing or mismatched value exits before any write.
 *
 * The connection string is printed only with credentials masked. Environment
 * identity is never inferred from a hostname, port, checkout path, or database
 * name because those details are not reliable safety boundaries.
 *
 * Supported names retain compatibility with existing self-hosted installations:
 * `local`, `staging`, `demo-production`, and `demo`.
 */
export type TraceEnv = 'local' | 'staging' | 'demo-production' | 'demo';

const VALID: readonly TraceEnv[] = ['local', 'staging', 'demo-production', 'demo'];

export interface ResolvedTarget {
  env: TraceEnv;
  databaseUrl: string;
  /** Human-readable target, credentials masked — safe to print. */
  description: string;
}

/** Mask credentials so a connection string can be printed in logs/CI. */
export function describeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '') || '(none)';
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.hostname}${port}/${database}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

/**
 * Resolve and verify the target environment, or exit non-zero.
 *
 * Reads `--env <name>` from argv and `TRACE_ENV` from the environment, and
 * requires them to agree.
 */
export function resolveTarget(argv: string[]): ResolvedTarget {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const flagIndex = argv.indexOf('--env');
  const requested = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  const declared = process.env['TRACE_ENV'];
  const where = describeDatabaseUrl(databaseUrl);

  if (!requested) {
    console.error(
      `\nRefusing to run without --env.\n` +
        `  This script writes to: ${where}\n` +
        `  That deployment declares TRACE_ENV=${declared ?? '(unset)'}\n\n` +
        `  Re-run with --env <${VALID.join('|')}> to confirm the target.\n`,
    );
    process.exit(1);
  }

  if (!VALID.includes(requested as TraceEnv)) {
    console.error(`\n--env must be one of: ${VALID.join(', ')} (got "${requested}")\n`);
    process.exit(1);
  }

  if (!declared) {
    console.error(
      `\nRefusing to run: this deployment does not declare TRACE_ENV.\n` +
        `  Target database: ${where}\n` +
        `  You asked for:   --env ${requested}\n\n` +
        `  Add TRACE_ENV=<${VALID.join('|')}> to the deployment's .env so the\n` +
        `  target can be verified rather than assumed.\n`,
    );
    process.exit(1);
  }

  if (declared !== requested) {
    console.error(
      `\nWRONG TARGET — refusing to run.\n` +
        `  You asked for:      --env ${requested}\n` +
        `  This deployment is: TRACE_ENV=${declared}\n` +
        `  Target database:    ${where}\n`,
    );
    process.exit(1);
  }

  return {
    env: declared as TraceEnv,
    databaseUrl,
    description: `${declared} (${where})`,
  };
}
