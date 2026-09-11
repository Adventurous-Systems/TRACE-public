/**
 * Assert that no @smoke-tagged spec can write to the environment it targets.
 *
 * WHY THIS EXISTS
 * smoke.yml points `playwright test --grep @smoke` at LIVE PRODUCTION
 * (E2E_BASE_URL=https://trace.adventurous.systems) after every deploy. That is
 * only safe because every @smoke test is strictly read-only — a property
 * deliberately established on 2026-06-03, and until now protected by nothing
 * but a comment.
 *
 * The rest of the suite is the opposite: one full `pnpm e2e` creates ~5
 * passports, 3 listings, a transaction and 3 MinIO photos, with no cleanup
 * hooks anywhere in this package. None of it carries the curated seedSource
 * tag, so demo:restore will never converge or remove it — a mutating @smoke
 * test would write permanent junk into the demo environment on every deploy.
 *
 * Run: pnpm --filter @trace/e2e check:smoke-isolation
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');
const TESTS_DIR = path.join(PKG_ROOT, 'tests');

/** Modules that create data. Reaching any of these from a @smoke spec is a failure. */
const FORBIDDEN_MODULES = ['fixtures/api'];

/** Mutating HTTP verbs / contexts that would let a spec write without the fixtures. */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\.post\s*\(/, why: 'issues a POST' },
  { pattern: /\.put\s*\(/, why: 'issues a PUT' },
  { pattern: /\.patch\s*\(/, why: 'issues a PATCH' },
  { pattern: /\.delete\s*\(/, why: 'issues a DELETE' },
  { pattern: /request\.newContext\s*\(/, why: 'opens a raw API request context' },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });
}

/** Resolve a relative import to a real file on disk. */
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* not this one */
    }
  }
  return null;
}

/** Every file reachable from `entry` through relative imports. */
function importClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf-8');
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const resolved = resolveImport(file, m[1]!);
      if (resolved) queue.push(resolved);
    }
  }
  return [...seen];
}

const failures: string[] = [];
const smokeSpecs = walk(TESTS_DIR).filter((f) => readFileSync(f, 'utf-8').includes('@smoke'));

if (smokeSpecs.length === 0) {
  console.error('No @smoke-tagged specs found. smoke.yml would run nothing — is the tag intact?');
  process.exit(1);
}

for (const spec of smokeSpecs) {
  for (const file of importClosure(spec)) {
    const rel = path.relative(PKG_ROOT, file);
    const src = readFileSync(file, 'utf-8');

    for (const forbidden of FORBIDDEN_MODULES) {
      if (file !== spec && rel.replace(/\\/g, '/').includes(forbidden)) {
        failures.push(
          `${path.relative(PKG_ROOT, spec)} reaches ${rel} — that module creates passports and listings`,
        );
      }
    }
    for (const { pattern, why } of FORBIDDEN_PATTERNS) {
      if (pattern.test(src)) {
        failures.push(`${rel} ${why} (reached from ${path.relative(PKG_ROOT, spec)})`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('\n@smoke isolation VIOLATED:\n');
  for (const f of new Set(failures)) console.error(`  - ${f}`);
  console.error(
    '\nsmoke.yml runs this selection against LIVE PRODUCTION after every deploy.\n' +
      'A mutating @smoke test writes permanent, untagged data into the demo\n' +
      'environment — demo:restore cannot clean it up. Keep @smoke read-only, or\n' +
      'move the test out of the @smoke describe block.\n',
  );
  process.exit(1);
}

console.log(
  `@smoke isolation OK — ${smokeSpecs.length} spec(s) checked, ` +
    'no data-creating imports or mutating requests reachable.',
);
