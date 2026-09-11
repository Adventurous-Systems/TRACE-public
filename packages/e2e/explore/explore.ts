/**
 * Exploratory QA crawler (read-only).
 *
 * Drives the TRACE web app through its key routes (logged out + as a supplier)
 * and collects automatically-detectable quality signals:
 *   - JS page errors and console errors
 *   - failed network requests / HTTP 5xx
 *   - accessibility violations (axe-core, WCAG 2 A/AA)
 *   - horizontal overflow at a 375px mobile viewport
 *
 * Creates NO data — safe to point at the live domain. Writes qa-report.md +
 * qa-report.json for the qa-explorer agent (or a human) to triage.
 *
 * Run: E2E_BASE_URL=<url> E2E_API_URL=<url> pnpm --filter @trace/e2e explore
 */
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCOUNTS, API_URL } from '../fixtures/accounts';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type Severity = 'high' | 'medium' | 'low';
interface Finding {
  route: string;
  viewport: 'desktop' | 'mobile';
  severity: Severity;
  type: string;
  detail: string;
}

const PUBLIC_ROUTES = ['/', '/marketplace', '/login', '/register', '/scan'];
const AUTHED_ROUTES = ['/passports', '/listings', '/transactions', '/passports/new'];

const findings: Finding[] = [];
const push = (f: Finding) => findings.push(f);

function attachListeners(page: Page, route: string, viewport: 'desktop' | 'mobile') {
  page.on('pageerror', (err) =>
    push({
      route,
      viewport,
      severity: 'high',
      type: 'js-error',
      detail: err.message.slice(0, 300),
    }),
  );
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      push({
        route,
        viewport,
        severity: 'medium',
        type: 'console-error',
        detail: msg.text().slice(0, 300),
      });
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 500) {
      push({
        route,
        viewport,
        severity: 'high',
        type: 'http-5xx',
        detail: `${res.status()} ${res.url()}`,
      });
    }
  });
  page.on('requestfailed', (req) => {
    const f = req.failure();
    if (f && !/aborted|canceled/i.test(f.errorText)) {
      push({
        route,
        viewport,
        severity: 'medium',
        type: 'request-failed',
        detail: `${f.errorText} ${req.url()}`,
      });
    }
  });
}

async function checkA11y(page: Page, route: string) {
  try {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    for (const v of results.violations) {
      const severity: Severity =
        v.impact === 'critical' || v.impact === 'serious'
          ? 'high'
          : v.impact === 'moderate'
            ? 'medium'
            : 'low';
      push({
        route,
        viewport: 'desktop',
        severity,
        type: `a11y:${v.id}`,
        detail: `${v.help} — ${v.nodes.length} node(s)`,
      });
    }
  } catch {
    /* axe injection can fail on redirect/blank pages — ignore */
  }
}

async function checkOverflow(page: Page, route: string) {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  if (sw > cw + 1) {
    push({
      route,
      viewport: 'mobile',
      severity: 'medium',
      type: 'mobile-overflow',
      detail: `scrollWidth ${sw} > clientWidth ${cw}`,
    });
  }
}

async function visit(ctx: BrowserContext, route: string, viewport: 'desktop' | 'mobile') {
  const page = await ctx.newPage();
  attachListeners(page, route, viewport);
  try {
    await page.goto(route, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.waitForTimeout(400);
    if (viewport === 'mobile') await checkOverflow(page, route);
    else await checkA11y(page, route);
  } catch (e) {
    push({
      route,
      viewport,
      severity: 'high',
      type: 'load-error',
      detail: String(e).slice(0, 200),
    });
  }
  await page.close();
}

async function supplierSession() {
  const res = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ACCOUNTS.supplier.email, password: ACCOUNTS.supplier.password }),
  });
  if (!res.ok) throw new Error(`supplier login failed (HTTP ${res.status})`);
  const { data } = (await res.json()) as { data: { token: string; user: unknown } };
  return data;
}

async function applyAuth(ctx: BrowserContext, token: string, user: unknown) {
  const url = new URL(BASE_URL);
  await ctx.addCookies([
    {
      name: 'trace_auth',
      value: token,
      domain: url.hostname,
      path: '/',
      secure: url.protocol === 'https:',
      sameSite: 'Strict',
    },
  ]);
  await ctx.addInitScript(
    `localStorage.setItem('trace_token', ${JSON.stringify(token)});` +
      `localStorage.setItem('trace_user', ${JSON.stringify(JSON.stringify(user))});`,
  );
}

function dedupe(items: Finding[]): Array<Finding & { count: number }> {
  const map = new Map<string, Finding & { count: number }>();
  for (const f of items) {
    const key = `${f.viewport}|${f.route}|${f.type}|${f.detail}`;
    const existing = map.get(key);
    if (existing) existing.count++;
    else map.set(key, { ...f, count: 1 });
  }
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return [...map.values()].sort(
    (a, b) => rank[a.severity] - rank[b.severity] || a.route.localeCompare(b.route),
  );
}

function writeReport(items: Array<Finding & { count: number }>) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of items) counts[f.severity] += 1;

  const lines: string[] = [];
  lines.push(`# TRACE exploratory QA report`);
  lines.push('');
  lines.push(`- Target: ${BASE_URL}`);
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(
    `- Findings: **${counts.high} high · ${counts.medium} medium · ${counts.low} low** (${items.length} unique)`,
  );
  lines.push('');
  lines.push('| Severity | Route | Viewport | Type | Detail | ×|');
  lines.push('|---|---|---|---|---|---|');
  for (const f of items) {
    lines.push(
      `| ${f.severity} | \`${f.route}\` | ${f.viewport} | ${f.type} | ${f.detail.replace(/\|/g, '\\|')} | ${f.count} |`,
    );
  }
  if (items.length === 0) lines.push('| — | — | — | — | no findings | — |');
  lines.push('');

  writeFileSync(path.join(OUT_DIR, 'qa-report.md'), lines.join('\n'));
  writeFileSync(
    path.join(OUT_DIR, 'qa-report.json'),
    JSON.stringify(
      { target: BASE_URL, generatedAt: new Date().toISOString(), counts, findings: items },
      null,
      2,
    ),
  );
  console.log(
    `\n${counts.high} high · ${counts.medium} medium · ${counts.low} low — report written to packages/e2e/qa-report.{md,json}`,
  );
}

async function main() {
  console.log(`Exploring ${BASE_URL} …`);
  const browser = await chromium.launch();

  // Public — desktop (a11y + console/network)
  const pub = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
  });
  for (const r of PUBLIC_ROUTES) await visit(pub, r, 'desktop');
  await pub.close();

  // Authed — desktop
  const { token, user } = await supplierSession();
  const authed = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
  });
  await applyAuth(authed, token, user);
  for (const r of AUTHED_ROUTES) await visit(authed, r, 'desktop');
  await authed.close();

  // Mobile overflow pass — public + authed
  const mob = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  await applyAuth(mob, token, user);
  for (const r of [...PUBLIC_ROUTES, ...AUTHED_ROUTES]) await visit(mob, r, 'mobile');
  await mob.close();

  await browser.close();
  writeReport(dedupe(findings));
}

main().catch((err) => {
  console.error('explore failed:', err);
  process.exit(1);
});
