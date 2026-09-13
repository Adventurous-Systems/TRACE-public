import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .sort();
const manifest = readFileSync('PUBLIC_MANIFEST.txt', 'utf8')
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .sort();

const forbiddenPaths = [
  '.local/',
  '.agents/',
  '.claude/',
  'CLAUDE.md',
  'PLAN.md',
  'startup.md',
  'docs/full_audit_9Sept26/',
  'packages/db/data/workshop-attendees.csv',
  'packages/db/scripts/sync-users.ts',
];

const failures = [];
for (const path of tracked) {
  if (forbiddenPaths.some((forbidden) => path === forbidden || path.startsWith(forbidden))) {
    failures.push(`forbidden tracked path: ${path}`);
  }
}

const missing = manifest.filter((path) => !tracked.includes(path));
const unexpected = tracked.filter((path) => !manifest.includes(path));
for (const path of missing) failures.push(`manifest entry is not tracked: ${path}`);
for (const path of unexpected)
  failures.push(`tracked path is absent from PUBLIC_MANIFEST.txt: ${path}`);

const sensitivePatterns = [
  {
    label: 'historical confidential project name',
    expression: new RegExp(['re', 'loop'].join(''), 'iu'),
  },
  {
    label: 'historical published password',
    expression: new RegExp(['TRACE', '_SRH', '!'].join(''), 'u'),
  },
  { label: 'private TRACE VPS checkout path', expression: /\/opt\/TRACE/u },
  { label: 'private key block', expression: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/u },
  {
    label: 'GitHub personal token',
    expression: /(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/u,
  },
  { label: 'AWS access key', expression: /AKIA[0-9A-Z]{16}/u },
];

for (const path of tracked) {
  if (path === 'scripts/check-public-boundary.mjs') continue;
  const content = readFileSync(path);
  if (content.includes(0)) continue;
  const text = content.toString('utf8');
  for (const { label, expression } of sensitivePatterns) {
    if (expression.test(text)) failures.push(`${label}: ${path}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `Public boundary check failed:\n${failures.map((item) => `- ${item}`).join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write(`Public boundary check passed for ${tracked.length} tracked files.\n`);
