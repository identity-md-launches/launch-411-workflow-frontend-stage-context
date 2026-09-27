import { useCallback, useMemo } from 'react';
import { OUTFLOW_SCAN_FROM_BLOCK } from './config';
import { AllowanceCard } from './components/AllowanceCard';
import { ContractsCard } from './components/ContractsCard';
import { OutflowHistory } from './components/OutflowHistory';
import { PoolCard } from './components/PoolCard';
import { SwapForm } from './components/SwapForm';
import { WalletControl } from './components/WalletControl';
import { useChainHead } from './hooks/useChainHead';
import { useDeployment } from './hooks/useDeployment';
import { useHookState } from './hooks/useHookState';
import { useOutflows } from './hooks/useOutflows';
import { useWallet } from './hooks/useWallet';
import { createPublicRpcClient } from './lib/chain';
import type { Deployment } from './lib/deployment';
import { launchPoolKey, poolId as computePoolId } from './lib/pool';

export default function App() {
  const state = useDeployment();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {state.status === 'loading' && (
        <main id="main" className="page">
          <p className="muted" role="status">
            Loading deployment configuration…
          </p>
        </main>
      )}
      {state.status === 'error' && (
        <main id="main" className="page">
          <h1>Blockcap launch pool</h1>
          <p className="notice notice-danger" role="alert">
            {state.error}
          </p>
          <p className="muted">
            The page reads its addresses, chain and ABIs from imd-deployment.json next to index.html. Nothing can be shown until that
            file loads.
          </p>
        </main>
      )}
      {state.status === 'ready' && <Dashboard deployment={state.deployment} />}
    </>
  );
}

function Dashboard({ deployment }: { deployment: Deployment }) {
  const { manifest, token, hook } = deployment;
  const network = manifest.network;
  const client = useMemo(() => createPublicRpcClient(network), [network]);
  const poolKey = useMemo(() => launchPoolKey(token.address, hook.address), [token.address, hook.address]);
  const poolId = useMemo(() => computePoolId(poolKey), [poolKey]);

  const { head, error: headError, refresh } = useChainHead(client);
  const blockNumber = head?.number ?? null;
  const hookState = useHookState(client, deployment, poolId, blockNumber);
  const outflows = useOutflows(client, deployment, poolId, OUTFLOW_SCAN_FROM_BLOCK, blockNumber, hookState.status?.capEndsAt ?? null);
  const wallet = useWallet(network);
  const onTransactionMined = useCallback(() => refresh(), [refresh]);

  const symbol = 'BCAP';
  const decimals = 18;

  return (
    <>
      <header className="page-header">
        <div className="page-header-inner">
          <div>
            <h1>Blockcap launch pool</h1>
            <p className="muted">
              {symbol} / {network.nativeCurrency.symbol} on {network.name}
              {network.testnet ? ' (test network)' : ''} · buys limited per block for the first day
            </p>
          </div>
          <WalletControl wallet={wallet} network={network} />
        </div>
      </header>
      <main id="main" className="page" tabIndex={-1}>
        {headError && (
          <p className="notice notice-warning" role="alert">
            Chain reads are failing: {headError}. Values below may be stale.
          </p>
        )}
        <div className="grid">
          <div className="column">
            <AllowanceCard
              status={hookState.status}
              head={head}
              network={network}
              symbol={symbol}
              decimals={decimals}
              loading={hookState.loading}
              error={hookState.error}
            />
            <PoolCard
              pool={hookState.pool}
              poolKey={poolKey}
              poolId={poolId}
              symbol={symbol}
              decimals={decimals}
              nativeSymbol={network.nativeCurrency.symbol}
              nativeDecimals={network.nativeCurrency.decimals}
            />
          </div>
          <div className="column">
            <SwapForm
              deployment={deployment}
              client={client}
              poolKey={poolKey}
              wallet={wallet}
              status={hookState.status}
              blockNumber={blockNumber}
              onTransactionMined={onTransactionMined}
            />
          </div>
        </div>
        <OutflowHistory
          outflows={outflows}
          network={network}
          symbol={symbol}
          decimals={decimals}
          cap={hookState.status?.cap ?? null}
          fromBlock={OUTFLOW_SCAN_FROM_BLOCK}
        />
        <ContractsCard deployment={deployment} />
      </main>
      <footer className="page-footer">
        <p className="muted small">
          Static page, no backend. Reads go to the network’s public RPC endpoints; signing stays in your wallet. Test network funds
          only.
        </p>
      </footer>
    </>
  );
}
