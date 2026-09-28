/**
 * Thor Solo genesis for a TRACE deployment, funding exactly one deployer.
 *
 * Mirrors the repository's genesis.json with only the funded account (and the
 * authority entry Solo requires but does not use for signing) swapped for a
 * deployment-specific address, so each deployment's chain and signing key are
 * its own. solo-genesis.test.ts fails if this drifts from genesis.json.
 */

// 100,000 VET and 100,000 VTHO, as in genesis.json.
const DEPLOYER_FUNDS = '0x152d02c7e14af6800000';

export function buildSoloGenesis(deployerAddress: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(deployerAddress)) {
    throw new Error(`Not an address: ${deployerAddress}`);
  }
  return {
    launchTime: 1526400000,
    gasLimit: 10000000,
    extraData: '0x',
    accounts: [
      {
        address: deployerAddress,
        balance: DEPLOYER_FUNDS,
        energy: DEPLOYER_FUNDS,
        storage: {},
      },
    ],
    authority: [
      {
        masterAddress: deployerAddress,
        endorsorAddress: deployerAddress,
        identity: '0x0000000000000000000000000000000000000000000000000000000000000001',
      },
    ],
    params: {
      rewardRatio: '0x400000000000000000',
      baseGasPrice: '0x5af3107a4000',
      proposerEndorsement: '0x152d02c7e14af6800000',
      executorAddress: '0x0000000000000000000000004578656375746f72',
    },
    executor: { approvers: [] },
    forkConfig: {
      VIP191: 0,
      ETH_CONST: 2,
      BLOCKLIST: 4,
      ETH_IST: 5214,
      VIP214: 10,
      FINALITY: 0,
      GALACTICA: 0,
      HAYABUSA: 0,
    },
  };
}
