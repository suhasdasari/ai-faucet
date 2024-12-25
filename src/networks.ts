import { 
  createPublicClient, 
  createWalletClient, 
  http,
  Chain,
  PublicClient,
  WalletClient,
  Transport,
  HttpTransport
} from 'viem';

import { 
  sepolia, 
  abstractTestnet,
  optimismSepolia,
  polygon,
} from 'viem/chains';

// Custom chain configuration for networks not in viem
const shardeumAtomium = {
  id: 8082,
  name: 'Shardeum Atomium',
  network: 'shardeum-atomium',
  nativeCurrency: {
    decimals: 18,
    name: 'Shardeum',
    symbol: 'SHM',
  },
  rpcUrls: {
    default: {
      http: ['https://atomium.shardeum.org']
    },
    public: {
      http: ['https://atomium.shardeum.org']
    }
  },
  blockExplorers: {
    default: {
      name: 'Shardeum Explorer',
      url: 'https://explorer-atomium.shardeum.org'
    }
  },
  testnet: true
} as const;

// Add faucet configuration type
type FaucetConfig = {
  symbol: string;
  amount: string;
}

// Update NetworkConfig type to include faucet info
export type NetworkConfig = {
  chain: Chain;
  publicClient: PublicClient<HttpTransport, Chain>;
  walletClient: (account: any) => WalletClient<HttpTransport, Chain>;
  faucet: FaucetConfig;
};

// Update createNetworkConfig to include faucet configuration
function createNetworkConfig(chain: Chain, faucetConfig: FaucetConfig): NetworkConfig {
  return {
    chain,
    publicClient: createPublicClient({
      chain,
      transport: http()
    }) as PublicClient<HttpTransport, Chain>,
    walletClient: (account) => createWalletClient({
      account,
      chain,
      transport: http()
    }) as WalletClient<HttpTransport, Chain>,
    faucet: faucetConfig
  };
}

// Networks configuration object with faucet details
const networks: Record<string, NetworkConfig> = {
  sepolia: createNetworkConfig(
    sepolia,
    { symbol: 'ETH', amount: '0.01' }
  ),
  abstract: createNetworkConfig(
    abstractTestnet,
    { symbol: 'ETH', amount: '0.01' }
  ),
  'optimism-sepolia': createNetworkConfig(
    optimismSepolia,
    { symbol: 'ETH', amount: '0.01' }
  ),
  polygon: createNetworkConfig(
    polygon,
    { symbol: 'POL', amount: '0.1' }
  ),
  'shardeum-atomium': createNetworkConfig(
    shardeumAtomium,
    { symbol: 'SHM', amount: '100' }
  ),
};

// Helper functions
export function getAvailableNetworks(): string[] {
  return Object.keys(networks);
}

export function getNetwork(name: string): NetworkConfig | undefined {
  return networks[name];
}

export default networks; 