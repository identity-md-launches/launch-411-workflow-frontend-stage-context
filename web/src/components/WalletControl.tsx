import type { WalletState } from '../hooks/useWallet';
import type { NetworkBlock } from '../lib/deployment';
import { explorerAddressUrl } from '../lib/chain';
import { shortAddress } from '../lib/format';

interface Props {
  wallet: WalletState;
  network: NetworkBlock;
}

export function WalletControl({ wallet, network }: Props) {
  const { wallets, selected, account, chainId, onExpectedChain, connecting, switching, error } = wallet;

  return (
    <div className="wallet">
      {account && selected ? (
        <div className="wallet-connected">
          <span className={`badge ${onExpectedChain ? 'badge-success' : 'badge-warning'}`}>
            <span aria-hidden="true">{onExpectedChain ? '●' : '▲'}</span> {onExpectedChain ? network.name : 'Wrong network'}
          </span>
          <a className="wallet-address" href={explorerAddressUrl(network, account)} target="_blank" rel="noreferrer" translate="no">
            {shortAddress(account)}
            <span className="sr-only"> (opens the explorer in a new tab)</span>
          </a>
          {!onExpectedChain && (
            <button type="button" className="button button-primary" onClick={() => void wallet.switchChain()} disabled={switching}>
              {switching ? 'Switching…' : `Switch to ${network.name}`}
            </button>
          )}
          <button type="button" className="button button-secondary" onClick={wallet.disconnect}>
            Disconnect
          </button>
          {!onExpectedChain && chainId !== null && (
            <p className="wallet-hint">
              The wallet is on chain {chainId}. This page needs {network.name} ({network.chainId}).
            </p>
          )}
        </div>
      ) : wallets.length === 0 ? (
        <p className="wallet-hint">No browser wallet detected. Install one to swap; reads work without it.</p>
      ) : (
        <div className="wallet-options">
          {wallets.map((w) => (
            <button
              key={w.id}
              type="button"
              className="button button-primary"
              onClick={() => void wallet.connect(w.id)}
              disabled={connecting}
            >
              {w.icon ? <img src={w.icon} alt="" width="18" height="18" className="wallet-icon" /> : null}
              {connecting ? 'Connecting…' : wallets.length === 1 ? 'Connect wallet' : `Connect ${w.name}`}
            </button>
          ))}
        </div>
      )}
      <p className="wallet-error" role="status">
        {error ?? ''}
      </p>
    </div>
  );
}
