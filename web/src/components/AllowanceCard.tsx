import type { ChainHead } from '../hooks/useChainHead';
import type { HookStatus } from '../hooks/useHookState';
import { useCountdown } from '../hooks/useCountdown';
import type { NetworkBlock } from '../lib/deployment';
import { explorerBlockUrl } from '../lib/chain';
import { formatAmount, formatDuration, formatPercent, formatTimestamp } from '../lib/format';

interface Props {
  status: HookStatus | null;
  head: ChainHead | null;
  network: NetworkBlock;
  symbol: string;
  decimals: number;
  loading: boolean;
  error: string | null;
}

export function AllowanceCard({ status, head, network, symbol, decimals, loading, error }: Props) {
  const secondsLeft = useCountdown(status?.capEndsAt ?? null, head);
  const initialized = status !== null && status.capEndsAt !== 0n;
  const active = status?.active ?? false;
  const remaining = status?.remainingThisBlock ?? 0n;
  const cap = status?.cap ?? 0n;
  const used = cap - remaining;

  return (
    <section className="card" aria-labelledby="allowance-heading">
      <div className="card-header">
        <h2 id="allowance-heading">Allowance this block</h2>
        {status && <span className={`badge ${active ? 'badge-success' : 'badge-neutral'}`}>{stateLabel(initialized, active)}</span>}
      </div>

      {error && (
        <p className="notice notice-danger" role="alert">
          Unable to read the hook: {error}
        </p>
      )}

      {loading && !status ? (
        <p className="muted" role="status">
          Loading contract state…
        </p>
      ) : status ? (
        <>
          <p className="stat">
            <span className="stat-value num" translate="no">
              {formatAmount(remaining, decimals, 2)}
            </span>
            <span className="stat-unit">{symbol} remaining</span>
          </p>
          <p className="muted">
            of a {formatAmount(cap, decimals, 0)} {symbol} cap per block · {formatAmount(used, decimals, 2)} {symbol} used in block{' '}
            {head ? (
              <a href={explorerBlockUrl(network, head.number)} target="_blank" rel="noreferrer" className="num">
                {head.number.toString()}
              </a>
            ) : (
              '…'
            )}
          </p>
          <progress className="cap-meter" value={Number(used) / Number(cap || 1n)} max={1} aria-label="Share of the block cap already used">
            {formatPercent(used, cap)}
          </progress>
          <dl className="facts">
            <div>
              <dt>Cap window</dt>
              <dd>
                {!initialized ? (
                  'Not started: the pool has not been initialized.'
                ) : active && secondsLeft !== null ? (
                  <>
                    <span className="num" translate="no">
                      {formatDuration(secondsLeft)}
                    </span>{' '}
                    left, ends {formatTimestamp(status.capEndsAt)}
                  </>
                ) : (
                  <>Ended {formatTimestamp(status.capEndsAt)}. Buys are no longer limited by the hook.</>
                )}
              </dd>
            </div>
            <div>
              <dt>Rule</dt>
              <dd>
                Buys in one block may deliver at most {formatAmount(cap, decimals, 0)} {symbol} in total. A buy that would go
                above it reverts as a whole. The next block starts with the full allowance again. Sells are not counted.
              </dd>
            </div>
          </dl>
        </>
      ) : null}
    </section>
  );
}

function stateLabel(initialized: boolean, active: boolean): string {
  if (!initialized) return 'Not initialized';
  return active ? 'Cap active' : 'Cap ended';
}
