import { request, type FullConfig } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { ACCOUNTS, API_URL, STATE_DIR, statePath, type Account } from './fixtures/accounts';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/**
 * Logs an account in via the API and writes a Playwright storageState file.
 * The web app authenticates from `localStorage` (trace_token / trace_user) plus
 * a `trace_auth` cookie used by the Next.js middleware — we set both.
 */
async function mintState(account: Account): Promise<void> {
  const ctx = await request.newContext({ baseURL: API_URL });

  // Retry: the API may be mid-restart right after a deploy (smoke runs eagerly).
  let lastError = '';
  let res = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await ctx.post('/api/v1/auth/login', {
        data: { email: account.email, password: account.password },
        timeout: 15_000,
      });
      if (r.ok()) {
        res = r;
        break;
      }
      lastError = `HTTP ${r.status()}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  if (!res) {
    throw new Error(
      `[e2e global-setup] login failed for persona "${account.role}" (${account.email}) ` +
        `against ${API_URL} after retries (${lastError}).\n` +
        '  This is usually a missing demo persona rather than a broken platform.\n' +
        '  Fix with:  pnpm --filter @trace/db demo:restore -- --env <env> --yes\n' +
        '  Locally:   pnpm --filter @trace/db seed',
    );
  }
  const { data } = (await res.json()) as { data: { token: string; user: unknown } };
  const url = new URL(BASE_URL);

  const state = {
    cookies: [
      {
        name: 'trace_auth',
        value: data.token,
        domain: url.hostname,
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: url.protocol === 'https:',
        sameSite: 'Strict' as const,
      },
    ],
    origins: [
      {
        origin: url.origin,
        localStorage: [
          { name: 'trace_token', value: data.token },
          { name: 'trace_user', value: JSON.stringify(data.user) },
        ],
      },
    ],
  };

  await writeFile(statePath(account.role), JSON.stringify(state, null, 2));
  await ctx.dispose();
}

/**
 * Refuse to run the writing suite against a deployed environment.
 *
 * A full `pnpm e2e` creates ~5 material passports, 3 listings, a transaction
 * and 3 MinIO photos — and there is not a single cleanup hook in this package.
 * With workers: 2 and retries: 1 a bad run leaves 7-9 passports. None of it
 * carries the curated seedSource tag, so `demo:restore` will never converge or
 * remove it: only `--sweep` cancels the listings after 24h, and the PASSPORTS
 * PERSIST FOREVER. Pointing this suite at the demo box pollutes it permanently.
 *
 * The @smoke selection is exempt because it is strictly read-only, an invariant
 * enforced by `pnpm --filter @trace/e2e check:smoke-isolation` rather than by
 * convention.
 */
function assertSafeTarget(config: FullConfig): void {
  const target = new URL(BASE_URL);
  const isLocal = ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(target.hostname);
  if (isLocal) return;

  // Is this the read-only @smoke selection?
  //
  // NOTE: do NOT use config.grep. Playwright does not surface a CLI `--grep`
  // there — it reports /.*/ and applies the filter after globalSetup runs, so
  // checking it would block smoke.yml against production. Verified by probe.
  // Two independent signals instead:
  //   1. the CLI args this process was started with
  //   2. E2E_READ_ONLY, set by the `e2e:smoke` package script
  const argv = process.argv.join(' ');
  const grepIndex = process.argv.indexOf('--grep');
  const cliSmoke = grepIndex !== -1 && (process.argv[grepIndex + 1] ?? '').includes('@smoke');
  const configSmoke = (Array.isArray(config.grep) ? config.grep : [config.grep]).some(
    (g) => g instanceof RegExp && g.source.includes('@smoke'),
  );
  if (
    cliSmoke ||
    configSmoke ||
    process.env.E2E_READ_ONLY === '1' ||
    argv.includes('--grep=@smoke')
  ) {
    return;
  }

  if (process.env.E2E_ALLOW_REMOTE_WRITES === 'i-understand-this-writes-permanent-data') {
    console.warn(
      `\n[e2e] WARNING: running the WRITING suite against ${BASE_URL}.\n` +
        '      It will leave passports and listings behind that nothing cleans up.\n',
    );
    return;
  }

  throw new Error(
    `[e2e global-setup] refusing to run the writing suite against ${BASE_URL}.\n\n` +
      '  This suite creates ~5 passports, 3 listings, a transaction and 3 photos,\n' +
      '  and has NO cleanup hooks. None of it is tagged, so demo:restore cannot\n' +
      '  remove it — the passports would stay on that environment permanently.\n\n' +
      '  Did you mean the read-only subset?\n' +
      '      pnpm e2e:smoke\n\n' +
      '  If you genuinely intend to write to a deployed environment, set:\n' +
      '      E2E_ALLOW_REMOTE_WRITES=i-understand-this-writes-permanent-data\n',
  );
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  assertSafeTarget(config);

  await mkdir(STATE_DIR, { recursive: true });
  for (const account of Object.values(ACCOUNTS)) {
    await mintState(account);
  }
}
