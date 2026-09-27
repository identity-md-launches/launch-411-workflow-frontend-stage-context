import { useEffect, useState } from 'react';
import type { ChainHead } from './useChainHead';

/**
 * Seconds until `capEndsAt`, estimated from the last observed block timestamp plus the local
 * clock's progress since that observation (so a skewed device clock does not shift the value).
 */
export function useCountdown(capEndsAt: bigint | null, head: ChainHead | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (capEndsAt === null || capEndsAt === 0n || !head) return null;
  const chainNow = Number(head.timestamp) + (now - head.observedAt) / 1000;
  return Number(capEndsAt) - chainNow;
}
