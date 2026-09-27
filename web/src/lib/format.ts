import { formatUnits, parseUnits } from 'viem';

/** Format a raw token amount with grouping and at most `maxFraction` decimals (no rounding up past the value). */
export function formatAmount(raw: bigint, decimals: number, maxFraction = 4): string {
  const negative = raw < 0n;
  const text = formatUnits(negative ? -raw : raw, decimals);
  const [whole = '0', frac = ''] = text.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let fraction = frac.slice(0, maxFraction).replace(/0+$/, '');
  if (fraction === '' && raw !== 0n && frac.replace(/0+$/, '') !== '') {
    // The value is smaller than the displayed precision.
    return `${negative ? '−' : ''}<${grouped === '0' ? '0.' + '0'.repeat(Math.max(maxFraction - 1, 0)) + '1' : grouped}`;
  }
  fraction = fraction ? `.${fraction}` : '';
  return `${negative ? '−' : ''}${grouped}${fraction}`;
}

/** Parse a decimal amount typed by the visitor; returns null if it is not a positive decimal. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const trimmed = text.trim().replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') return null;
  const [, frac = ''] = trimmed.split('.');
  if (frac.length > decimals) return null;
  try {
    const value = parseUnits(trimmed, decimals);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** "23h 14m 09s" style duration for a number of whole seconds. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${h}h ${pad(m)}m ${pad(sec)}s`;
}

export function formatTimestamp(unixSeconds: bigint | number): string {
  const date = new Date(Number(unixSeconds) * 1000);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

export function formatPercent(numerator: bigint, denominator: bigint, fraction = 1): string {
  if (denominator === 0n) return '0%';
  const scale = 10n ** BigInt(fraction);
  const value = (numerator * 100n * scale) / denominator;
  const whole = value / scale;
  const frac = (value % scale).toString().padStart(fraction, '0');
  return fraction > 0 ? `${whole}.${frac}%` : `${whole}%`;
}
