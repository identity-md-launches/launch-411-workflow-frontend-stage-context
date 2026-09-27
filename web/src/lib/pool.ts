import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';
import { POOL } from '../config';

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

const ZERO = '0x0000000000000000000000000000000000000000';

/** The launch pool key: paired currency and the token sorted ascending, hook from the handoff. */
export function launchPoolKey(token: Address, hook: Address): PoolKey {
  const paired = POOL.pairedCurrency;
  const [currency0, currency1] =
    paired === ZERO || paired.toLowerCase() < token.toLowerCase() ? [paired, token] : [token, paired];
  return { currency0, currency1, fee: POOL.fee, tickSpacing: POOL.tickSpacing, hooks: hook };
}

/** PoolId = keccak256(abi.encode(PoolKey)). */
export function poolId(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint24' },
        { type: 'int24' },
        { type: 'address' },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

const Q192 = 1n << 192n;

/**
 * Price of currency1 in currency0 units scaled by 10^decimals1... expressed here as the amount of
 * currency1 (raw units) received per 10^decimals0 raw units of currency0, from sqrtPriceX96.
 * With both currencies at 18 decimals the result reads directly as "BCAP-wei per 1 ETH".
 */
export function currency1PerCurrency0(sqrtPriceX96: bigint, decimals0: number): bigint {
  return (sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(decimals0)) / Q192;
}

/** Split a packed BalanceDelta (int256) into amount0 / amount1 (int128 each). */
export function splitBalanceDelta(delta: bigint): { amount0: bigint; amount1: bigint } {
  const mask = (1n << 128n) - 1n;
  const toSigned = (v: bigint) => (v >= 1n << 127n ? v - (1n << 128n) : v);
  const amount1 = toSigned(delta & mask);
  // arithmetic shift for negative values
  const amount0 = delta >> 128n;
  return { amount0, amount1 };
}

/** Minimum output after slippage in basis points (e.g. 100 = 1%). */
export function applySlippage(amountOut: bigint, slippageBps: bigint): bigint {
  return (amountOut * (10_000n - slippageBps)) / 10_000n;
}

/** Parse a percent string such as "0.5" into basis points, or null if invalid. */
export function parseSlippageBps(text: string): bigint | null {
  const trimmed = text.trim();
  if (!/^\d{0,2}(\.\d{0,2})?$/.test(trimmed) || trimmed === '' || trimmed === '.') return null;
  const [whole = '0', frac = ''] = trimmed.split('.');
  const bps = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
  if (bps > 5_000n) return null; // 50% ceiling
  return bps;
}
