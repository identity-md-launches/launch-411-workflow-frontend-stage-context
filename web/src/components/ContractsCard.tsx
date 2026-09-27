import type { Deployment } from '../lib/deployment';
import { explorerAddressUrl } from '../lib/chain';
import { POOL_SWAP_TEST } from '../config';

interface Props {
  deployment: Deployment;
}

export function ContractsCard({ deployment }: Props) {
  const { manifest, contracts } = deployment;
  const v4 = manifest.network.uniswapV4;
  const rows: { name: string; address: string; note: string }[] = [
    ...contracts.map((c) => ({ name: c.name, address: c.address, note: c.name === 'Blockcap' ? 'BCAP token' : 'Per-block cap hook' })),
    { name: 'PoolManager', address: v4.poolManager, note: 'Uniswap v4 core' },
    { name: 'V4Quoter', address: v4.quoter, note: 'Quotes (simulated, never a transaction)' },
    { name: 'StateView', address: v4.stateView, note: 'Pool price and liquidity reads' },
    { name: 'PoolSwapTest', address: POOL_SWAP_TEST, note: 'Swap router required by the approved workflow' },
  ];
  return (
    <section className="card" aria-labelledby="contracts-heading">
      <h2 id="contracts-heading">Contracts</h2>
      <ul className="contract-list">
        {rows.map((r) => (
          <li key={r.name}>
            <span className="contract-name">{r.name}</span>
            <span className="muted">{r.note}</span>
            <a href={explorerAddressUrl(manifest.network, r.address)} target="_blank" rel="noreferrer" className="num" translate="no">
              {r.address}
              <span className="sr-only"> (opens the explorer in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Chain {manifest.network.name} ({manifest.chainId}) · launch{' '}
        <span className="num" translate="no">
          {manifest.launchId}
        </span>{' '}
        · source commit{' '}
        <span className="num" translate="no">
          {manifest.sourceCommit.slice(0, 12)}
        </span>{' '}
        · attestation{' '}
        <span className="num" translate="no">
          {manifest.attestationHash.slice(0, 12)}…
        </span>
        . Addresses, chain, RPC endpoints and ABIs are loaded from imd-deployment.json at runtime.
      </p>
    </section>
  );
}
