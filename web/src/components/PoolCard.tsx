import type { PoolState } from '../hooks/useHookState';
import type { PoolKey } from '../lib/pool';
import { currency1PerCurrency0 } from '../lib/pool';
import { formatAmount, shortAddress } from '../lib/format';
import type { Hex } from 'viem';

interface Props {
  pool: PoolState | null;
  poolKey: PoolKey;
  poolId: Hex;
  symbol: string;
  decimals: number;
  nativeSymbol: string;
  nativeDecimals: number;
}

export function PoolCard({ pool, poolKey, poolId, symbol, decimals, nativeSymbol, nativeDecimals }: Props) {
  const tokensPerNative = pool ? currency1PerCurrency0(pool.sqrtPriceX96, nativeDecimals) : null;
  const nativePerToken =
    tokensPerNative && tokensPerNative > 0n ? (10n ** BigInt(nativeDecimals) * 10n ** BigInt(decimals)) / tokensPerNative : null;

  return (
    <section className="card" aria-labelledby="pool-heading">
      <div className="card-header">
        <h2 id="pool-heading">Pool</h2>
        {pool && (
          <span className={`badge ${pool.initialized ? 'badge-neutral' : 'badge-warning'}`}>
            {pool.initialized ? 'Uniswap v4' : 'Not initialized'}
          </span>
        )}
      </div>
      {!pool ? (
        <p className="muted">Loading pool state…</p>
      ) : (
        <dl className="facts facts-grid">
          <div>
            <dt>Spot price</dt>
            <dd>
              <span className="num" translate="no">
                1 {nativeSymbol} ≈ {tokensPerNative !== null ? formatAmount(tokensPerNative, decimals, 2) : '—'} {symbol}
              </span>
              <br />
              <span className="muted num" translate="no">
                1 {symbol} ≈ {nativePerToken !== null ? formatAmount(nativePerToken, nativeDecimals, 8) : '—'} {nativeSymbol}
              </span>
            </dd>
          </div>
          <div>
            <dt>Active liquidity</dt>
            <dd className="num" translate="no">
              {pool.liquidity.toString()}
              {pool.liquidity === 0n && <span className="muted"> (none at the current tick; buys move into the seeded range)</span>}
            </dd>
          </div>
          <div>
            <dt>Tick · LP fee</dt>
            <dd className="num" translate="no">
              {pool.tick} · {(pool.lpFee / 10_000).toFixed(2)}%
            </dd>
          </div>
          <div>
            <dt>Pool key</dt>
            <dd className="num" translate="no">
              {nativeSymbol} / {symbol} · fee {poolKey.fee} · spacing {poolKey.tickSpacing} · hook {shortAddress(poolKey.hooks)}
              <br />
              <span className="muted">id {shortAddress(poolId)}</span>
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
