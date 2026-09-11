import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomicfoundation/hardhat-network-helpers';
import '@vechain/sdk-hardhat-plugin';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: '../../.env' });

const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
const accounts =
  deployerPrivateKey && /^0x[0-9a-fA-F]{64}$/.test(deployerPrivateKey) ? [deployerPrivateKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.20',
    settings: {
      evmVersion: 'paris',
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    vechain_solo: {
      url: process.env.VECHAIN_NODE_URL ?? 'http://localhost:8669',
      accounts: accounts,
    },
    vechain_testnet: {
      url: 'https://testnet.veblocks.net',
      accounts: accounts,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
};

export default config;
