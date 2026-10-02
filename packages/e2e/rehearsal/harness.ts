/**
 * Rehearsal harness: drives the running app the way each stakeholder would,
 * and keeps the evidence.
 *
 * A journey is a logged-in (or anonymous) browser session made of steps. Every
 * step ends with a screenshot, and anything the page itself reports (JS
 * errors, console errors, failed requests, broken images) becomes a finding
 * without the journey having to look for it. A step that throws is recorded as
 * a finding and the journey carries on, so one broken page does not hide the
 * rest.
 *
 * Unlike the test suite this does not assert a known-good outcome; it gathers
 * what a reviewer needs to judge one. It writes data, so it refuses any target
 * that is not local.
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEMO_PERSONAS,
  demoPersonaPassword,
  type DemoPersonaKey,
} from '@trace/core/constants/demo-personas';
import { buildStorageState, isLocalTarget } from '../fixtures/session';

export type Severity = 'blocker' | 'major' | 'minor' | 'polish' | 'info';

export interface Finding {
  /** Where it was seen: "journey / step" or "probe: name". */
  source: string;
  severity: Severity;
  /** bug | edge case | caveat | UX | data | ops | tech debt */
  type: string;
  what: string;
  evidence?: string;
}

export interface ProbeRecord {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
}

interface StepRecord {
  journey: string;
  step: string;
  url: string;
  screenshot: string;
  ok: boolean;
  notes: string[];
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: { success?: boolean; data?: T; error?: { code?: string; message?: string } };
}

/** A random password for an account that exists only for this run. */
export const throwawayPassword = (): string => `Rh-${randomBytes(12).toString('base64url')}-9a`;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export class Rehearsal {
  readonly findings: Finding[] = [];
  readonly steps: StepRecord[] = [];
  readonly probes: ProbeRecord[] = [];
  private browser: Browser | null = null;
  private readonly tokens = new Map<string, { token: string; user: { id: string } }>();

  constructor(
    readonly outDir: string,
    readonly baseUrl: string,
    readonly apiUrl: string,
  ) {
    if (!isLocalTarget(baseUrl) || !isLocalTarget(apiUrl)) {
      throw new Error(`The rehearsal writes data; refusing the non-local target ${baseUrl}.`);
    }
    mkdirSync(outDir, { recursive: true });
  }

  finding(finding: Finding): void {
    this.findings.push(finding);
    console.log(`  ! [${finding.severity}] ${finding.source}: ${finding.what}`);
  }

  // ── API ──────────────────────────────────────────────────────────────────

  async api<T = unknown>(
    method: string,
    route: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<ApiResponse<T>> {
    const send = () =>
      fetch(`${this.apiUrl}${route}`, {
        method,
        headers: {
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    let response = await send();
    // The general rate limit says nothing about the request itself; wait it
    // out once (logins have their own, handled in login()).
    if (response.status === 429 && !route.includes('/auth/')) {
      const wait = Number(response.headers.get('retry-after') ?? '60');
      console.log(`  (rate limit reached; waiting ${wait} s)`);
      await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
      response = await send();
    }
    let body: ApiResponse<T>['body'] = {};
    try {
      body = (await response.json()) as ApiResponse<T>['body'];
    } catch {
      // Not JSON (e.g. an HTML error page); the status says enough.
    }
    return { status: response.status, body };
  }

  async login(email: string, password: string): Promise<{ token: string; user: { id: string } }> {
    const cached = this.tokens.get(email);
    if (cached) return cached;
    // Logins are limited per minute; wait a refusal out instead of failing.
    for (let attempt = 1; ; attempt++) {
      const res = await this.api<{ token: string; user: { id: string } }>(
        'POST',
        '/api/v1/auth/login',
        { body: { email, password } },
      );
      if (res.status === 200 && res.body.data) {
        this.tokens.set(email, res.body.data);
        return res.body.data;
      }
      if (res.status !== 429 || attempt === 6) {
        throw new Error(`login failed for ${email}: HTTP ${res.status}`);
      }
      console.log('  (login rate limit reached; waiting 15 s)');
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }

  persona(key: DemoPersonaKey) {
    const persona = DEMO_PERSONAS[key];
    return this.login(persona.email, demoPersonaPassword(persona, process.env));
  }

  /** A brand-new public account, as a demo visitor would create. */
  async register(
    label: string,
  ): Promise<{ email: string; password: string; token: string; user: { id: string } }> {
    const email = `rehearsal.${slug(label)}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;
    const password = throwawayPassword();
    const res = await this.api<{ token: string; user: { id: string } }>(
      'POST',
      '/api/v1/auth/register',
      { body: { email, password, name: `Rehearsal ${label}` } },
    );
    if (res.status !== 201 || !res.body.data) {
      throw new Error(`register failed: HTTP ${res.status} ${res.body.error?.message ?? ''}`);
    }
    this.tokens.set(email, res.body.data);
    return { email, password, ...res.body.data };
  }

  // ── Browser ──────────────────────────────────────────────────────────────

  /**
   * Run a journey. `who` is a demo persona, a registered account, or null for
   * an anonymous visitor.
   */
  async journey(
    name: string,
    who: DemoPersonaKey | { email: string; password: string } | null,
    run: (journey: Journey) => Promise<void>,
    options: { mobile?: boolean } = {},
  ): Promise<void> {
    this.browser ??= await chromium.launch();
    console.log(`\n── ${name}`);
    let storageState: ReturnType<typeof buildStorageState> | undefined;
    if (who) {
      const session =
        typeof who === 'string'
          ? await this.persona(who)
          : await this.login(who.email, who.password);
      storageState = buildStorageState(session.token, session.user, this.baseUrl);
    }
    const context = await this.browser.newContext({
      viewport: options.mobile ? { width: 375, height: 812 } : { width: 1366, height: 900 },
      storageState,
    });
    const journey = new Journey(this, name, context, await context.newPage());
    try {
      await run(journey);
    } catch (error) {
      this.finding({
        source: name,
        severity: 'major',
        type: 'bug',
        what: `the journey stopped: ${String(error).split('\n')[0]}`,
      });
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }

  writeReport(meta: Record<string, string>): string {
    const order: Severity[] = ['blocker', 'major', 'minor', 'polish', 'info'];
    const findings = [...this.findings].sort(
      (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
    );
    const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const lines = [
      '# Rehearsal evidence',
      '',
      ...Object.entries(meta).map(([key, value]) => `- **${key}:** ${value}`),
      `- **Steps:** ${this.steps.length} (${this.steps.filter((s) => !s.ok).length} failed)`,
      `- **API probes:** ${this.probes.length} (${this.probes.filter((p) => !p.pass).length} unexpected)`,
      `- **Automatic findings:** ${findings.length}`,
      '',
      '## Findings (automatic; triage needed)',
      '',
      '| Severity | Type | Source | What | Evidence |',
      '|---|---|---|---|---|',
      ...findings.map(
        (f) =>
          `| ${f.severity} | ${f.type} | ${cell(f.source)} | ${cell(f.what)} | ${f.evidence ?? ''} |`,
      ),
      '',
      '## API probes',
      '',
      '| Probe | Expected | Actual | Pass |',
      '|---|---|---|---|',
      ...this.probes.map(
        (p) =>
          `| ${cell(p.name)} | ${cell(p.expected)} | ${cell(p.actual)} | ${p.pass ? 'yes' : '**no**'} |`,
      ),
      '',
      '## Steps',
      '',
      '| Journey | Step | OK | URL | Screenshot | Notes |',
      '|---|---|---|---|---|---|',
      ...this.steps.map(
        (s) =>
          `| ${cell(s.journey)} | ${cell(s.step)} | ${s.ok ? 'yes' : '**no**'} | ${s.url} | ${s.screenshot} | ${cell(s.notes.join('; '))} |`,
      ),
      '',
    ];
    const file = path.join(this.outDir, 'report.md');
    writeFileSync(file, lines.join('\n'));
    writeFileSync(
      path.join(this.outDir, 'report.json'),
      JSON.stringify({ meta, findings, probes: this.probes, steps: this.steps }, null, 2),
    );
    return file;
  }
}

export class Journey {
  private issues: string[] = [];
  private count = 0;

  constructor(
    private readonly rehearsal: Rehearsal,
    readonly name: string,
    readonly context: BrowserContext,
    readonly page: Page,
  ) {
    this.watch(page);
  }

  private watch(page: Page): void {
    page.on('pageerror', (error) => this.issues.push(`page error: ${error.message.slice(0, 200)}`));
    page.on('console', (message) => {
      if (message.type() === 'error') this.issues.push(`console: ${message.text().slice(0, 200)}`);
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        this.issues.push(
          `HTTP ${response.status()} ${response.request().method()} ${response.url()}`,
        );
      }
    });
  }

  async goto(route: string): Promise<void> {
    await this.page.goto(`${this.rehearsal.baseUrl}${route}`, { waitUntil: 'networkidle' });
  }

  /** Report content wider than the viewport (a horizontal scrollbar). */
  async checkOverflow(label: string): Promise<void> {
    const overflow = await this.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 1) {
      this.rehearsal.finding({
        source: `${this.name} / ${label}`,
        severity: 'minor',
        type: 'UX',
        what: `the page is ${overflow}px wider than the viewport`,
      });
    }
  }

  /** The text of the first element matching the pattern, or null. */
  async text(pattern: RegExp): Promise<string | null> {
    const locator = this.page.getByText(pattern).first();
    return (await locator.count()) ? ((await locator.textContent())?.trim() ?? null) : null;
  }

  /**
   * One step of the journey. `expectIssues` lists the HTTP statuses the step
   * provokes on purpose (e.g. a refused order), so they are not reported.
   */
  async step(
    label: string,
    run: () => Promise<string | void>,
    options: { expectIssues?: RegExp } = {},
  ): Promise<void> {
    this.count += 1;
    const source = `${this.name} / ${label}`;
    const notes: string[] = [];
    let ok = true;
    try {
      const note = await run();
      if (note) notes.push(note);
    } catch (error) {
      ok = false;
      const message = String(error).split('\n')[0]!.slice(0, 240);
      notes.push(`STEP FAILED: ${message}`);
      this.rehearsal.finding({
        source,
        severity: 'major',
        type: 'bug',
        what: `step failed: ${message}`,
      });
    }

    await this.page.waitForTimeout(700);
    const broken = await this.page
      .$$eval('img', (images) =>
        images.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.currentSrc || i.src),
      )
      .catch(() => [] as string[]);
    // A full-page screenshot shows a sticky header wherever the viewport is.
    await this.page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
    const screenshot = `${slug(this.name)}-${String(this.count).padStart(2, '0')}-${slug(label)}.png`;
    await this.page
      .screenshot({ path: path.join(this.rehearsal.outDir, screenshot), fullPage: true })
      .catch(() => undefined);

    for (const src of broken) {
      this.rehearsal.finding({
        source,
        severity: 'major',
        type: 'bug',
        what: `broken image ${src}`,
        evidence: screenshot,
      });
    }
    for (const issue of [...new Set(this.issues)]) {
      if (options.expectIssues?.test(issue)) {
        notes.push(`expected: ${issue}`);
        continue;
      }
      const server = /^HTTP 5/.test(issue) || issue.startsWith('page error');
      this.rehearsal.finding({
        source,
        severity: server ? 'major' : 'minor',
        type: 'bug',
        what: issue,
        evidence: screenshot,
      });
      notes.push(issue);
    }
    this.issues = [];

    this.rehearsal.steps.push({
      journey: this.name,
      step: label,
      url: this.page.url().replace(this.rehearsal.baseUrl, ''),
      screenshot,
      ok,
      notes,
    });
    console.log(
      `  ${ok ? '✓' : '✗'} ${label}${notes.length ? `  — ${notes.join('; ').slice(0, 200)}` : ''}`,
    );
  }
}
