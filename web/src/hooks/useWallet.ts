import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWalletClient, custom, type Address, type WalletClient } from 'viem';
import { chainFromNetwork } from '../lib/chain';
import type { NetworkBlock } from '../lib/deployment';
import { toUserFacingError } from '../lib/errors';
import {
  discoverWallets,
  readChainId,
  requestAccounts,
  switchOrAddChain,
  type Eip1193Provider,
  type WalletOption,
} from '../lib/wallet';

export interface WalletState {
  wallets: WalletOption[];
  selected: WalletOption | null;
  account: Address | null;
  chainId: number | null;
  onExpectedChain: boolean;
  connecting: boolean;
  switching: boolean;
  error: string | null;
  walletClient: WalletClient | null;
  connect: (walletId: string) => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
}

export function useWallet(network: NetworkBlock | null): WalletState {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [selected, setSelected] = useState<WalletOption | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providerRef = useRef<Eip1193Provider | null>(null);

  useEffect(() => discoverWallets(setWallets), []);

  // Track account / chain changes from the selected provider.
  useEffect(() => {
    const provider = selected?.provider;
    providerRef.current = provider ?? null;
    if (!provider?.on || !provider.removeListener) return;
    const onAccounts = (accounts: string[]) => {
      const next = accounts[0];
      setAccount(next ? (next.toLowerCase() as Address) : null);
    };
    const onChain = (hex: string) => setChainId(Number.parseInt(hex, 16));
    provider.on('accountsChanged', onAccounts as never);
    provider.on('chainChanged', onChain as never);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts as never);
      provider.removeListener?.('chainChanged', onChain as never);
    };
  }, [selected]);

  const connect = useCallback(
    async (walletId: string) => {
      const wallet = wallets.find((w) => w.id === walletId);
      if (!wallet) return;
      setConnecting(true);
      setError(null);
      try {
        const accounts = await requestAccounts(wallet.provider);
        const first = accounts[0];
        if (!first) throw new Error('The wallet returned no account.');
        setSelected(wallet);
        setAccount(first as Address);
        setChainId(await readChainId(wallet.provider));
      } catch (e) {
        setError(toUserFacingError(e, undefined, 'Unable to connect the wallet.').message);
      } finally {
        setConnecting(false);
      }
    },
    [wallets],
  );

  const disconnect = useCallback(() => {
    setSelected(null);
    setAccount(null);
    setChainId(null);
    setError(null);
  }, []);

  const switchChain = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider || !network) return;
    setSwitching(true);
    setError(null);
    try {
      await switchOrAddChain(provider, network);
      setChainId(await readChainId(provider));
    } catch (e) {
      setError(toUserFacingError(e, undefined, 'Unable to switch network.').message);
    } finally {
      setSwitching(false);
    }
  }, [network]);

  const onExpectedChain = network !== null && chainId === network.chainId;

  const walletClient = useMemo(() => {
    if (!selected || !account || !network || !onExpectedChain) return null;
    return createWalletClient({ account, chain: chainFromNetwork(network), transport: custom(selected.provider) });
  }, [selected, account, network, onExpectedChain]);

  return {
    wallets,
    selected,
    account,
    chainId,
    onExpectedChain,
    connecting,
    switching,
    error,
    walletClient,
    connect,
    disconnect,
    switchChain,
  };
}
