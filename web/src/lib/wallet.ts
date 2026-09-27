/**
 * Browser wallet discovery (EIP-6963 with a window.ethereum fallback) and chain switching with the
 * add-chain fallback required for test networks. No WalletConnect project id is configured, so
 * only injected wallets are offered (see config.ts).
 */
import type { NetworkBlock } from './deployment';
import { toChainIdHex, walletAddChainParams } from './chain';

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: never[]) => void): void;
  removeListener?(event: string, listener: (...args: never[]) => void): void;
}

export interface WalletOption {
  id: string;
  name: string;
  icon?: string | undefined;
  provider: Eip1193Provider;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { isMetaMask?: boolean; providers?: Eip1193Provider[] };
  }
}

/** Subscribe to wallet discovery. Calls `onChange` with the current list whenever it changes. */
export function discoverWallets(onChange: (wallets: WalletOption[]) => void): () => void {
  const found = new Map<string, WalletOption>();
  let announced = false;

  const emit = () => {
    const list = [...found.values()];
    if (!announced && window.ethereum) {
      list.push({ id: 'injected', name: injectedName(window.ethereum), provider: window.ethereum });
    }
    onChange(list);
  };

  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Detail>).detail;
    if (!detail?.info?.uuid || !detail.provider) return;
    announced = true;
    found.set(detail.info.uuid, {
      id: detail.info.rdns || detail.info.uuid,
      name: detail.info.name,
      icon: detail.info.icon,
      provider: detail.provider,
    });
    emit();
  };

  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  emit();
  return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
}

function injectedName(provider: { isMetaMask?: boolean }): string {
  return provider.isMetaMask ? 'MetaMask' : 'Browser wallet';
}

export async function requestAccounts(provider: Eip1193Provider): Promise<string[]> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  return accounts.map((a) => a.toLowerCase());
}

export async function readChainId(provider: Eip1193Provider): Promise<number> {
  const hex = (await provider.request({ method: 'eth_chainId' })) as string;
  return Number.parseInt(hex, 16);
}

function isUnknownChainError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { code?: unknown; message?: unknown; data?: { originalError?: { code?: unknown } } };
  if (record.code === 4902 || record.data?.originalError?.code === 4902) return true;
  return typeof record.message === 'string' && /unrecognized chain|not (been )?added|unknown chain|4902/i.test(record.message);
}

/**
 * Switch the wallet to the configured chain. When the wallet does not know the chain
 * (error 4902 or an equivalent message), offer `wallet_addEthereumChain` with the exact
 * network parameters and then switch again.
 */
export async function switchOrAddChain(provider: Eip1193Provider, network: NetworkBlock): Promise<void> {
  const chainId = toChainIdHex(network.chainId);
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    return;
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
  }
  await provider.request({ method: 'wallet_addEthereumChain', params: [walletAddChainParams(network)] });
  if ((await readChainId(provider)) === network.chainId) return;
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
}
