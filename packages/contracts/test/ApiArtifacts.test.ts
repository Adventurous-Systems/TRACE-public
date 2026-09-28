import { expect } from 'chai';
import * as fs from 'fs';
import { API_ARTIFACT_PATH, renderApiArtifact } from '../scripts/export-api-artifacts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hre: any = require('hardhat');

describe('API contract artifacts', () => {
  // The API image deploys MaterialRegistry from bytecode bundled in
  // packages/api (the demo host has no Solidity compiler). A contract change
  // without re-exporting would silently deploy the old contract.
  it('bundled MaterialRegistry matches a fresh compile', async () => {
    const artifact = await hre.artifacts.readArtifact('MaterialRegistry');
    const expected = await renderApiArtifact({ abi: artifact.abi, bytecode: artifact.bytecode });
    const actual = fs.readFileSync(API_ARTIFACT_PATH, 'utf8');
    expect(actual, 'run `pnpm --filter @trace/contracts export:api-artifacts`').to.equal(expected);
  });
});
