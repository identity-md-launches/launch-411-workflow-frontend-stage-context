import type { OutflowsState } from '../hooks/useOutflows';
import type { NetworkBlock } from '../lib/deployment';
import { explorerBlockUrl, explorerTxUrl } from '../lib/chain';
import { formatAmount, formatPercent, shortHash } from '../lib/format';

interface Props {
  outflows: OutflowsState;
  network: NetworkBlock;
  symbol: string;
  decimals: number;
  cap: bigint | null;
  fromBlock: bigint;
}

export function OutflowHistory({ outflows, network, symbol, decimals, cap, fromBlock }: Props) {
  const { events, scanning, scannedTo, error } = outflows;
  const blocks = new Set(events.map((e) => e.blockNumber.toString())).size;

  return (
    <section className="card" aria-labelledby="history-heading">
      <div className="card-header">
        <h2 id="history-heading">Outflow history</h2>
        <span className="muted" role="status">
          {scanning
            ? `Scanning blocks from ${scannedTo ? scannedTo.toString() : fromBlock.toString()}…`
            : scannedTo
              ? `Scanned through block ${scannedTo.toString()}`
              : ''}
        </span>
      </div>
      <p className="muted">
        Every counted buy emits an Outflow event with the amount delivered and the block’s running total. {blocks} block
        {blocks === 1 ? '' : 's'} with counted buys so far.
      </p>
      {error && (
        <p className="notice notice-danger" role="alert">
          Unable to load events: {error}
        </p>
      )}
      {events.length === 0 ? (
        <p className="empty">
          <strong>No counted buys yet.</strong> Buys made during the capped day appear here per block as soon as they are
          mined.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Outflow events, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Block</th>
                <th scope="col" className="num-col">
                  Amount ({symbol})
                </th>
                <th scope="col" className="num-col">
                  Block total after
                </th>
                <th scope="col" className="num-col">
                  Share of cap
                </th>
                <th scope="col">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={`${e.txHash}:${e.logIndex}`}>
                  <td className="num">
                    <a href={explorerBlockUrl(network, e.blockNumber)} target="_blank" rel="noreferrer">
                      {e.blockNumber.toString()}
                    </a>
                  </td>
                  <td className="num num-col">{formatAmount(e.amount, decimals, 2)}</td>
                  <td className="num num-col">{formatAmount(e.usedInBlock, decimals, 2)}</td>
                  <td className="num num-col">{cap ? formatPercent(e.usedInBlock, cap) : '—'}</td>
                  <td className="num">
                    <a href={explorerTxUrl(network, e.txHash)} target="_blank" rel="noreferrer" translate="no">
                      {shortHash(e.txHash)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
