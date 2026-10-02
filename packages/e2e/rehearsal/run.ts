/**
 * Run the rehearsal: stakeholder journeys, then API probes, against a local
 * stack. Writes report.md, report.json and one screenshot per step.
 *
 *   pnpm --filter @trace/e2e rehearse              # journeys and probes
 *   pnpm --filter @trace/e2e rehearse -- journeys  # or: probes
 *
 * Environment: E2E_BASE_URL, E2E_API_URL (default the local stack),
 * REHEARSAL_OUT (default ./rehearsal-report), REHEARSAL_COMMIT (for the
 * report), and the DEMO_*_PASSWORD persona passwords.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rehearsal } from './harness';
import { runJourneys } from './journeys';
import { runProbes } from './probes';

const here = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2).find((arg) => arg === 'journeys' || arg === 'probes');
const rehearsal = new Rehearsal(
  process.env.REHEARSAL_OUT ?? path.resolve(here, '..', 'rehearsal-report'),
  process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  process.env.E2E_API_URL ?? 'http://localhost:3001',
);

try {
  if (only !== 'probes') await runJourneys(rehearsal);
  if (only !== 'journeys') await runProbes(rehearsal);
} finally {
  await rehearsal.close();
  const report = rehearsal.writeReport({
    Commit: process.env.REHEARSAL_COMMIT ?? 'unknown',
    Target: rehearsal.baseUrl,
    Ran: new Date().toISOString(),
  });
  console.log(`\nReport: ${report}`);
  console.log(
    `${rehearsal.steps.length} steps, ${rehearsal.probes.length} probes, ` +
      `${rehearsal.findings.length} automatic finding(s).`,
  );
}
