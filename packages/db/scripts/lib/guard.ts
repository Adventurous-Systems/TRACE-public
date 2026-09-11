/**
 * Target guard for destructive database scripts.
 *
 * WHY THIS EXISTS
 * `reset:marketplace --yes` truncates material_passports, listings,
 * transactions, quality_reports, passport_events and sensor_readings. It had no
 * environment check of any kind: a stale DATABASE_URL in a shell, or a copied
 * command run from the wrong directory, truncates production in one keystroke.
 *
 * The guard makes the target explicit and fails closed:
 *   - the operator must pass `--env <name>`;
 *   - the deployment must declare `TRACE_ENV` (in its .env);
 *   - the two must match, or nothing runs.
 *
 * Saying the environment out loud is the point. It cannot be inferred from
 * DATABASE_URL, because every deployment on the VPS uses the same database
 * name (`trace`) on the same host — only the port differs.
 *
 * Add to .env:
 *   TRACE_ENV=local            # a developer machine
 *   TRACE_ENV=staging          # shared test environment
 *   TRACE_ENV=demo-production  # public demonstration environment
 *   TRACE_ENV=demo             # the standalone showcase on its own subdomain
 *
 * NAMING — `demo-production` and `demo` are two different deployments, and the
 * names are unfortunately close. `demo-production` is the long-standing name
 * for an environment containing non-fixture data, so destructive demo tools
 * require an explicit matching environment name.
 * from the `demo` branch. It is kept rather than renamed because renaming it
 * means editing production's .env and deploy workflow — a riskier change than
 * the confusion warrants (D-05).
 *
 * The guard is what makes the similarity safe: it requires --env and TRACE_ENV
 * to AGREE, so typing `--env demo` at the client-facing box does not run
 * against it — it exits 1 with WRONG TARGET. Being a valid name is never on
 * its own permission to write anywhere.
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
