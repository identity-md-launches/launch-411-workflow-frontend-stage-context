import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicClient } from 'viem';
import { UI } from '../config';

export interface ChainHead {
  number: bigint;
  /** Block timestamp in unix seconds. */
  timestamp: bigint;
  /** Local clock (ms) when this head was observed, for the countdown offset. */
  observedAt: number;
}

export interface ChainHeadState {
  head: ChainHead | null;
  error: string | null;
  refresh: () => void;
}

/** Polls the latest block header; every other read keys off the returned block number. */
export function useChainHead(client: PublicClient | null): ChainHeadState {
  const [head, setHead] = useState<ChainHead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const inFlight = useRef(false);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const poll = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const block = await client.getBlock({ blockTag: 'latest' });
        if (cancelled) return;
        setHead((prev) =>
          prev && prev.number === block.number ? prev : { number: block.number, timestamp: block.timestamp, observedAt: Date.now() },
        );
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message.split('\n')[0] ?? 'RPC error' : 'RPC error');
      } finally {
        inFlight.current = false;
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), UI.blockPollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [client, tick]);

  return { head, error, refresh };
}
