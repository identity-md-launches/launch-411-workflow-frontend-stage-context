import { useEffect, useRef, useState } from 'react';
import { parseAbiItem, type Hex, type PublicClient } from 'viem';
import { UI } from '../config';
import type { Deployment } from '../lib/deployment';

export interface OutflowEvent {
  blockNumber: bigint;
  txHash: Hex;
  logIndex: number;
  amount: bigint;
  usedInBlock: bigint;
}

export interface OutflowsState {
  events: OutflowEvent[];
  /** Highest block scanned so far (null before the first chunk). */
  scannedTo: bigint | null;
  scanning: boolean;
  error: string | null;
}

const OUTFLOW_EVENT = parseAbiItem(
  'event Outflow(bytes32 indexed poolId, uint256 blockNumber, uint256 amount, uint256 usedInBlock)',
);

/**
 * Scans the hook's Outflow events for the launch pool from the deployment block (from the
 * runtime manifest's asset-free handoff data passed in as `fromBlock`) to the chain head in
 * RPC-friendly chunks, then follows new blocks incrementally.
 */
export function useOutflows(
  client: PublicClient | null,
  deployment: Deployment | null,
  poolId: Hex | null,
  fromBlock: bigint | null,
  head: bigint | null,
  capEndsAt: bigint | null,
): OutflowsState {
  const [events, setEvents] = useState<OutflowEvent[]>([]);
  const [scannedTo, setScannedTo] = useState<bigint | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<bigint | null>(null);
  const busy = useRef(false);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!client || !deployment || !poolId || fromBlock === null || head === null) return;
    if (busy.current) return;
    const start = cursor.current === null ? fromBlock : cursor.current + 1n;
    if (start > head) return;
    let cancelled = false;
    busy.current = true;
    setScanning(true);
    (async () => {
      try {
        let from = start;
        while (from <= head && !cancelled) {
          const to = from + UI.logChunkSize - 1n > head ? head : from + UI.logChunkSize - 1n;
          const logs = await client.getLogs({
            address: deployment.hook.address,
            event: OUTFLOW_EVENT,
            args: { poolId },
            fromBlock: from,
            toBlock: to,
          });
          if (cancelled) return;
          const fresh: OutflowEvent[] = [];
          for (const log of logs) {
            if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) continue;
            const key = `${log.transactionHash}:${log.logIndex}`;
            if (seen.current.has(key)) continue;
            seen.current.add(key);
            fresh.push({
              blockNumber: log.blockNumber,
              txHash: log.transactionHash,
              logIndex: log.logIndex,
              amount: log.args.amount ?? 0n,
              usedInBlock: log.args.usedInBlock ?? 0n,
            });
          }
          if (fresh.length > 0) {
            setEvents((prev) =>
              [...prev, ...fresh]
                .sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber < b.blockNumber ? 1 : -1))
                .slice(0, UI.maxOutflowRows),
            );
          }
          cursor.current = to;
          setScannedTo(to);
          from = to + 1n;
          // Once the capped day is over the hook emits nothing further; stop scanning past that time.
          if (capEndsAt !== null && capEndsAt !== 0n && from <= head) {
            const block = await client.getBlock({ blockNumber: to });
            if (block.timestamp >= capEndsAt) {
              cursor.current = head;
              setScannedTo(head);
              break;
            }
          }
        }
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message.split('\n')[0] ?? 'Log scan failed' : 'Log scan failed');
      } finally {
        busy.current = false;
        if (!cancelled) setScanning(false);
      }
    })();
    return () => {
      cancelled = true;
      busy.current = false;
    };
  }, [client, deployment, poolId, fromBlock, head, capEndsAt]);

  return { events, scannedTo, scanning, error };
}
