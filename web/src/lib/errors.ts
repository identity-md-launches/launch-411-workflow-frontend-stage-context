/**
 * Turns viem / wallet / contract errors into a small structured form the UI can render, decoding
 * the PoolManager's nested `WrappedError` and the V4Quoter's `UnexpectedRevertBytes` so the hook's
 * `BlockCapExceeded(used, cap)` reason is visible to the visitor.
 */
import {
  BaseError,
  decodeAbiParameters,
  decodeErrorResult,
  isHex,
  parseAbi,
  slice,
  type Abi,
  type Hex,
} from 'viem';
import { POOL_MANAGER_ERRORS_ABI, POOL_SWAP_TEST_ABI } from '../config';

const QUOTER_ERRORS_ABI = parseAbi([
  'error UnexpectedRevertBytes(bytes revertData)',
  'error NotEnoughLiquidity(bytes32 poolId)',
  'error NotPoolManager()',
  'error NotSelf()',
  'error UnexpectedCallSuccess()',
]);

const ERROR_STRING_SELECTOR = '0x08c379a0';
const PANIC_SELECTOR = '0x4e487b71';
const WRAPPED_ERROR_SELECTOR = '0x90bfb865';
const UNEXPECTED_REVERT_BYTES_SELECTOR = '0x6190b2b0';

export type DecodedRevert =
  | { kind: 'capExceeded'; used: bigint; cap: bigint }
  | { kind: 'named'; name: string; args: readonly unknown[]; contract?: string }
  | { kind: 'message'; message: string }
  | { kind: 'unknown'; data: Hex };

export interface UserFacingError {
  /** Short sentence for the visitor. */
  message: string;
  /** Structured hook revert, when the cause is the per-block cap. */
  capExceeded?: { used: bigint; cap: bigint } | undefined;
  /** Whether the visitor declined in the wallet. */
  rejected: boolean;
}

function findRevertData(error: unknown): Hex | undefined {
  if (error instanceof BaseError) {
    const found = error.walk((e) => {
      if (typeof e !== 'object' || e === null) return false;
      const data = (e as { data?: unknown }).data;
      return isHex(data) || (typeof data === 'object' && data !== null && isHex((data as { data?: unknown }).data));
    }) as { data?: unknown } | null;
    if (found) {
      const data = found.data;
      if (isHex(data)) return data;
      if (typeof data === 'object' && data !== null) {
        const inner = (data as { data?: unknown }).data;
        if (isHex(inner)) return inner;
      }
    }
  }
  // Plain EIP-1193 errors sometimes carry data directly, or nested in `data.originalError`.
  if (typeof error === 'object' && error !== null) {
    const record = error as { data?: unknown; cause?: unknown };
    if (isHex(record.data)) return record.data;
    if (typeof record.data === 'object' && record.data !== null) {
      const inner = (record.data as { data?: unknown; originalError?: { data?: unknown } }).data;
      if (isHex(inner)) return inner;
      const original = (record.data as { originalError?: { data?: unknown } }).originalError?.data;
      if (isHex(original)) return original;
    }
    if (record.cause) return findRevertData(record.cause);
  }
  return undefined;
}

export function decodeRevertData(data: Hex, hookAbi?: Abi): DecodedRevert {
  if (data.length < 10) return { kind: 'unknown', data };
  const selector = slice(data, 0, 4).toLowerCase();
  const body = `0x${data.slice(10)}` as Hex;
  try {
    if (selector === ERROR_STRING_SELECTOR) {
      const [message] = decodeAbiParameters([{ type: 'string' }], body);
      return { kind: 'message', message };
    }
    if (selector === PANIC_SELECTOR) {
      const [code] = decodeAbiParameters([{ type: 'uint256' }], body);
      return { kind: 'message', message: `Panic code ${code.toString()}` };
    }
    if (selector === UNEXPECTED_REVERT_BYTES_SELECTOR) {
      const [inner] = decodeAbiParameters([{ type: 'bytes' }], body);
      return decodeRevertData(inner, hookAbi);
    }
    if (selector === WRAPPED_ERROR_SELECTOR) {
      const [, , reason] = decodeAbiParameters(
        [{ type: 'address' }, { type: 'bytes4' }, { type: 'bytes' }, { type: 'bytes' }],
        body,
      );
      return decodeRevertData(reason, hookAbi);
    }
    if (hookAbi) {
      try {
        const decoded = decodeErrorResult({ abi: hookAbi, data });
        if (decoded.errorName === 'BlockCapExceeded') {
          const [used, cap] = decoded.args as readonly [bigint, bigint];
          return { kind: 'capExceeded', used, cap };
        }
        return { kind: 'named', name: decoded.errorName, args: decoded.args ?? [], contract: 'BlockOutflowCapHook' };
      } catch {
        // fall through to shared ABIs
      }
    }
    for (const [abi, contract] of [
      [POOL_MANAGER_ERRORS_ABI, 'PoolManager'],
      [QUOTER_ERRORS_ABI, 'V4Quoter'],
      [POOL_SWAP_TEST_ABI, 'PoolSwapTest'],
    ] as const) {
      try {
        const decoded = decodeErrorResult({ abi, data });
        return { kind: 'named', name: decoded.errorName, args: decoded.args ?? [], contract };
      } catch {
        // try next
      }
    }
  } catch {
    // malformed payload
  }
  return { kind: 'unknown', data };
}

function isRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
  if (record.code === 4001 || record.name === 'UserRejectedRequestError') return true;
  if (typeof record.message === 'string' && /user (rejected|denied|cancel)/i.test(record.message)) return true;
  return record.cause ? isRejection(record.cause) : false;
}

export function describeDecoded(decoded: DecodedRevert): string {
  switch (decoded.kind) {
    case 'capExceeded':
      return 'The buy would exceed this block’s cap and the hook reverts it (BlockCapExceeded).';
    case 'named': {
      if (decoded.name === 'NotEnoughLiquidity') {
        return 'No liquidity is available in this direction at the current price, so none of this amount can be filled. Try the other direction or a later time.';
      }
      if (decoded.name === 'PoolNotInitialized') return 'The pool has not been initialized yet.';
      if (decoded.name === 'SwapAmountCannotBeZero') return 'Enter an amount greater than zero.';
      const args = decoded.args.map((a) => (typeof a === 'bigint' ? a.toString() : String(a))).join(', ');
      return `${decoded.contract ? decoded.contract + ' ' : ''}reverted with ${decoded.name}(${args}).`;
    }
    case 'message':
      return `Reverted: ${decoded.message}`;
    case 'unknown':
      return `Reverted with unrecognized data ${decoded.data.slice(0, 10)}….`;
  }
}

/** Build the message shown to the visitor for any failure in a quote, simulation or transaction. */
export function toUserFacingError(error: unknown, hookAbi?: Abi, fallbackMessage = 'Request failed.'): UserFacingError {
  if (isRejection(error)) {
    return { message: 'Request rejected in the wallet. Nothing was sent.', rejected: true };
  }
  const data = findRevertData(error);
  if (data) {
    const decoded = decodeRevertData(data, hookAbi);
    return {
      message: describeDecoded(decoded),
      capExceeded: decoded.kind === 'capExceeded' ? { used: decoded.used, cap: decoded.cap } : undefined,
      rejected: false,
    };
  }
  if (error instanceof BaseError) {
    const short = error.shortMessage || error.message;
    if (/insufficient funds/i.test(short)) {
      return { message: 'Insufficient ETH for this amount plus gas.', rejected: false };
    }
    return { message: short.split('\n')[0] ?? fallbackMessage, rejected: false };
  }
  if (error instanceof Error && error.message) {
    return { message: error.message.split('\n')[0] ?? fallbackMessage, rejected: false };
  }
  return { message: fallbackMessage, rejected: false };
}
