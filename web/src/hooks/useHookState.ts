import { useEffect, useState } from 'react';
import type { Hex, PublicClient } from 'viem';
import { STATE_VIEW_ABI } from '../config';
import type { Deployment } from '../lib/deployment';

export interface HookStatus {
  active: boolean;
  remainingThisBlock: bigint;
  capEndsAt: bigint;
  cap: bigint;
  /** Block number the status was read against. */
  blockNumber: bigint;
}

export interface PoolState {
  sqrtPriceX96: bigint;
  tick: number;
  lpFee: number;
  liquidity: bigint;
  initialized: boolean;
}

export interface HookStateResult {
  status: HookStatus | null;
  pool: PoolState | null;
  error: string | null;
  loading: boolean;
}

/** Reads hook status / CAP and pool slot0 / liquidity whenever the chain head changes. */
export function useHookState(
  client: PublicClient | null,
  deployment: Deployment | null,
  poolId: Hex | null,
  blockNumber: bigint | null,
): HookStateResult {
  const [status, setStatus] = useState<HookStatus | null>(null);
  const [pool, setPool] = useState<PoolState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client || !deployment || !poolId || blockNumber === null) return;
    let cancelled = false;
    const { hook, manifest } = deployment;
    const stateView = manifest.network.uniswapV4.stateView;
    (async () => {
      try {
        const [statusResult, cap, slot0, liquidity] = await Promise.all([
          client.readContract({ address: hook.address, abi: hook.abi, functionName: 'status', args: [poolId] }) as Promise<
            readonly [boolean, bigint, bigint]
          >,
          client.readContract({ address: hook.address, abi: hook.abi, functionName: 'CAP' }) as Promise<bigint>,
          client.readContract({ address: stateView, abi: STATE_VIEW_ABI, functionName: 'getSlot0', args: [poolId] }),
          client.readContract({ address: stateView, abi: STATE_VIEW_ABI, functionName: 'getLiquidity', args: [poolId] }),
        ]);
        if (cancelled) return;
        const [active, remainingThisBlock, capEndsAt] = statusResult;
        setStatus({ active, remainingThisBlock, capEndsAt, cap, blockNumber });
        setPool({
          sqrtPriceX96: slot0[0],
          tick: slot0[1],
          lpFee: slot0[3],
          liquidity,
          initialized: slot0[0] !== 0n,
        });
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message.split('\n')[0] ?? 'Read failed' : 'Read failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, deployment, poolId, blockNumber]);

  return { status, pool, error, loading };
}
