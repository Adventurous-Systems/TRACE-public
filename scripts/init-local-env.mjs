#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const destination = new URL('../.env', import.meta.url);
const example = new URL('../.env.example', import.meta.url);
const sharedDemoPassword = randomBytes(18).toString('base64url');

const values = new Map([
  ['DEPLOYER_PRIVATE_KEY', `0x${randomBytes(32).toString('hex')}`],
  ['WALLET_ENCRYPTION_KEY', randomBytes(32).toString('base64url')],
  ['JWT_SECRET', randomBytes(48).toString('base64url')],
  ['DEMO_PLATFORM_ADMIN_PASSWORD', sharedDemoPassword],
  ['DEMO_HUB_ADMIN_PASSWORD', sharedDemoPassword],
  ['DEMO_HUB_STAFF_PASSWORD', sharedDemoPassword],
  ['DEMO_INSPECTOR_PASSWORD', sharedDemoPassword],
  ['DEMO_BUYER_PASSWORD', sharedDemoPassword],
  ['DEMO_SUPPLIER_PASSWORD', sharedDemoPassword],
  ['DEMO_SUPPLIER2_PASSWORD', sharedDemoPassword],
  ['DEMO_APPLICANT_PASSWORD', sharedDemoPassword],
]);

let content = readFileSync(example, 'utf8');
for (const [key, value] of values) {
  const expression = new RegExp(`^${key}=.*$`, 'mu');
  if (!expression.test(content)) throw new Error(`Missing ${key} in .env.example`);
  content = content.replace(expression, `${key}=${value}`);
}
content = content.replace(/^DEMO_SIMULATE_ANCHOR=false$/mu, 'DEMO_SIMULATE_ANCHOR=true');

try {
  writeFileSync(destination, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
    console.error('Refusing to overwrite existing .env');
    process.exit(1);
  }
  throw error;
}

console.log('Created mode-600 .env with unique disposable local credentials.');
console.log(`Local demo password for every seeded persona: ${sharedDemoPassword}`);
console.log('Keep this value local. Delete .env and rerun this command to rotate it.');
