import { createPublicClient, defineChain, fallback, http, type Chain, type PublicClient } from 'viem';
import type { NetworkBlock } from './deployment';

/** viem chain definition derived from the vetted network block (no hard-coded chain data). */
export function chainFromNetwork(network: NetworkBlock): Chain {
  return defineChain({
    id: network.chainId,
    name: network.name,
    testnet: network.testnet,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: { default: { http: network.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: network.explorer } },
  });
}

/** Exact `wallet_addEthereumChain` parameters, derived from the same network block. */
export function walletAddChainParams(network: NetworkBlock) {
  return {
    chainId: toChainIdHex(network.chainId),
    chainName: network.name,
    rpcUrls: network.rpcUrls,
    nativeCurrency: network.nativeCurrency,
    blockExplorerUrls: [network.explorer],
  };
}

export function toChainIdHex(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}`;
}

export function createPublicRpcClient(network: NetworkBlock): PublicClient {
  const chain = chainFromNetwork(network);
  return createPublicClient({
    chain,
    transport: fallback(
      network.rpcUrls.map((url) => http(url, { batch: false, retryCount: 1, timeout: 15_000 })),
      { rank: false, retryCount: 1 },
    ),
  });
}

export function explorerAddressUrl(network: NetworkBlock, address: string): string {
  return `${network.explorer.replace(/\/$/, '')}/address/${address}`;
}

export function explorerTxUrl(network: NetworkBlock, hash: string): string {
  return `${network.explorer.replace(/\/$/, '')}/tx/${hash}`;
}

export function explorerBlockUrl(network: NetworkBlock, block: bigint): string {
  return `${network.explorer.replace(/\/$/, '')}/block/${block.toString()}`;
}
