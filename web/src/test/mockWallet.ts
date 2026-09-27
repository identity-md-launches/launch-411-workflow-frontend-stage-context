/** A scripted EIP-1193 wallet: accounts, chain switching (optionally unknown chain), signing. */
import { numberToHex, type Hex } from 'viem';
import { rpcProvider } from './mockRpc';

export interface MockWalletOptions {
  account: string;
  chainId: number;
  /** Chains the wallet knows; switching to another one fails with 4902 until it is added. */
  knownChains?: number[];
  /** Reject signing requests with EIP-1193 code 4001. */
  rejectSigning?: boolean;
  isMetaMask?: boolean;
}

export function createMockWallet(options: MockWalletOptions) {
  type Listener = (payload: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  const known = new Set(options.knownChains ?? [options.chainId]);
  let chainId = options.chainId;
  const requests: { method: string; params: unknown }[] = [];
  const sent: Hex[] = [];

  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };

  const provider = {
    isMetaMask: options.isMetaMask ?? false,
    requests,
    sent,
    on(event: string, listener: (...args: never[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener as Listener);
    },
    removeListener(event: string, listener: (...args: never[]) => void) {
      listeners.get(event)?.delete(listener as Listener);
    },
    async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
      requests.push({ method, params });
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [options.account];
        case 'eth_chainId':
          return numberToHex(chainId);
        case 'wallet_switchEthereumChain': {
          const [{ chainId: hex }] = params as [{ chainId: string }];
          const target = Number.parseInt(hex, 16);
          if (!known.has(target)) {
            throw Object.assign(new Error('Unrecognized chain ID. Try adding the chain first.'), { code: 4902 });
          }
          chainId = target;
          emit('chainChanged', hex);
          return null;
        }
        case 'wallet_addEthereumChain': {
          const [{ chainId: hex }] = params as [{ chainId: string }];
          known.add(Number.parseInt(hex, 16));
          return null;
        }
        case 'eth_sendTransaction': {
          if (options.rejectSigning) {
            throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          }
          const hash = `0x${(sent.length + 1).toString(16).padStart(64, '0')}` as Hex;
          sent.push(hash);
          return hash;
        }
        default:
          // Anything else (eth_call, eth_estimateGas, …) goes to the mock node.
          return rpcProvider.request({ method, params });
      }
    },
  };
  return provider;
}

export type MockWallet = ReturnType<typeof createMockWallet>;
