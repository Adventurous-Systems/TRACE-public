/**
 * The one place the API picks a blockchain implementation. Everything outside
 * lib/chain/ imports from here and never from a chain SDK directly.
 */
import { env } from '../../env.js';
import type { ChainAdapter } from './types.js';
import { VeChainAdapter } from './vechain.js';

export type * from './types.js';
export { uuidToBytes32, bytes32ToUuid } from './ids.js';

function createChainAdapter(): ChainAdapter {
  switch (env.CHAIN_KIND) {
    case 'vechain':
      return new VeChainAdapter(env.VECHAIN_NODE_URL);
    // A generic EVM adapter (ethers/viem, `eip155:<chainId>`) plugs in here.
  }
}

let adapter: ChainAdapter | null = null;

export function getChainAdapter(): ChainAdapter {
  adapter ??= createChainAdapter();
  return adapter;
}
