/**
 * Create a deployment-specific Thor Solo chain identity: a fresh deployer key
 * and a genesis that funds only that key.
 *
 *   node dist/scripts/solo-genesis.js <output-dir>
 *
 * Writes <output-dir>/deployer.key (mode 600, the 0x-prefixed private key)
 * and <output-dir>/genesis.json (mode 644), then prints the deployer address.
 * The key is never printed. Refuses to overwrite either file, because
 * replacing the key of a live chain strands everything signed with it.
 *
 * On the demo host this runs inside the release's API image (it needs
 * ethers), with the output directory bind-mounted from a root-only path.
 */
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Wallet } from 'ethers';
import { buildSoloGenesis } from '../lib/chain/solo-genesis.js';

function fail(message: string): never {
  process.stderr.write(`solo-genesis: ${message}\n`);
  process.exit(1);
}

const outDir = process.argv[2];
if (!outDir || process.argv.length !== 3) fail('usage: solo-genesis <output-dir>');

const keyPath = resolve(join(outDir, 'deployer.key'));
const genesisPath = resolve(join(outDir, 'genesis.json'));
for (const path of [keyPath, genesisPath]) {
  if (existsSync(path)) fail(`${path} already exists; refusing to overwrite a chain identity`);
}

const wallet = Wallet.createRandom();
writeFileSync(keyPath, `${wallet.privateKey}\n`, { mode: 0o600, flag: 'wx' });
chmodSync(keyPath, 0o600);
writeFileSync(genesisPath, `${JSON.stringify(buildSoloGenesis(wallet.address), null, 2)}\n`, {
  mode: 0o644,
  flag: 'wx',
});

process.stdout.write(
  [
    `Deployer address: ${wallet.address}`,
    `Private key:      ${keyPath} (mode 600, not printed)`,
    `Genesis:          ${genesisPath}`,
    '',
  ].join('\n'),
);
