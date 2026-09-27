/**
 * A tiny in-memory JSON-RPC node: enough of eth_* for the page's reads, quotes, simulations,
 * receipts and logs, dispatching eth_call by target address and function selector.
 */
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  numberToHex,
  parseAbiItem,
  RpcRequestError,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { POOL_SWAP_TEST, POOL_SWAP_TEST_ABI, STATE_VIEW_ABI, V4_QUOTER_ABI } from '../config';
import { addresses, hookAbi, tokenAbi } from './fixtures';

export interface RpcState {
  chainId: number;
  blockNumber: bigint;
  timestamp: bigint;
  /** hook.status() */
  active: boolean;
  remaining: bigint;
  capEndsAt: bigint;
  cap: bigint;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  /** quoter behaviour: amountOut per 1e18 of input, or a revert payload */
  quoteOutPerInput: bigint;
  quoteRevertData: Hex | null;
  /** PoolSwapTest.swap simulation: null = compute from quote; hex = revert with this data */
  swapRevertData: Hex | null;
  balances: Record<string, bigint>;
  tokenBalances: Record<string, bigint>;
  allowances: Record<string, bigint>;
  logs: { blockNumber: bigint; txHash: Hex; logIndex: number; amount: bigint; usedInBlock: bigint }[];
  receiptStatus: 'success' | 'reverted';
  /** Invoked when a receipt is served, to mutate balances as a mined transaction would. */
  onReceipt: (() => void) | null;
}

export const defaultState = (): RpcState => ({
  chainId: 11155111,
  blockNumber: 11_794_900n,
  timestamp: 1_790_530_000n,
  active: true,
  remaining: 2_500_000n * 10n ** 18n,
  capEndsAt: 1_790_616_252n,
  cap: 2_500_000n * 10n ** 18n,
  sqrtPriceX96: 560_227_709_747_861_399_187_319_382_274_582n,
  tick: 177_284,
  liquidity: 0n,
  quoteOutPerInput: 49_599_393_577_521_859_103_751_300n, // ≈ 49.6M BCAP per ETH
  quoteRevertData: null,
  swapRevertData: null,
  balances: {},
  tokenBalances: {},
  allowances: {},
  logs: [],
  receiptStatus: 'success',
  onReceipt: null,
});

export let state: RpcState = defaultState();
export function resetRpc(overrides: Partial<RpcState> = {}): void {
  state = { ...defaultState(), ...overrides };
  calls.length = 0;
}

/** Every request seen, for assertions. */
export const calls: { method: string; params: unknown }[] = [];

const OUTFLOW = parseAbiItem('event Outflow(bytes32 indexed poolId, uint256 blockNumber, uint256 amount, uint256 usedInBlock)');

/** Throw the same JSON-RPC error shape a node returns for `execution reverted` (code 3 + data). */
function revert(data: Hex): never {
  throw new RpcRequestError({
    body: { method: 'eth_call' },
    error: { code: 3, message: 'execution reverted', data },
    url: 'mock://rpc',
  });
}

function packDelta(amount0: bigint, amount1: bigint): bigint {
  const mask = (1n << 128n) - 1n;
  return (amount0 << 128n) | (amount1 & mask);
}

function handleCall(to: Address, data: Hex, value: bigint, from?: Address): Hex {
  const target = to.toLowerCase();
  if (target === addresses.hook.toLowerCase()) {
    const { functionName } = decodeFunctionData({ abi: hookAbi, data });
    if (functionName === 'status') {
      return encodeFunctionResult({ abi: hookAbi, functionName: 'status', result: [state.active, state.remaining, state.capEndsAt] });
    }
    if (functionName === 'CAP') return encodeFunctionResult({ abi: hookAbi, functionName: 'CAP', result: state.cap });
  }
  if (target === addresses.stateView.toLowerCase()) {
    const { functionName } = decodeFunctionData({ abi: STATE_VIEW_ABI, data });
    if (functionName === 'getSlot0') {
      return encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: 'getSlot0', result: [state.sqrtPriceX96, state.tick, 0, 3000] });
    }
    if (functionName === 'getLiquidity') {
      return encodeFunctionResult({ abi: STATE_VIEW_ABI, functionName: 'getLiquidity', result: state.liquidity });
    }
  }
  if (target === addresses.quoter.toLowerCase()) {
    const { args } = decodeFunctionData({ abi: V4_QUOTER_ABI, data });
    if (state.quoteRevertData) revert(state.quoteRevertData);
    const params = args[0];
    const out = (params.exactAmount * state.quoteOutPerInput) / 10n ** 18n;
    return encodeFunctionResult({ abi: V4_QUOTER_ABI, functionName: 'quoteExactInputSingle', result: [out, 141_702n] });
  }
  if (target === addresses.token.toLowerCase()) {
    const decoded = decodeFunctionData({ abi: tokenAbi, data });
    if (decoded.functionName === 'balanceOf') {
      const [owner] = decoded.args as [Address];
      return encodeFunctionResult({ abi: tokenAbi, functionName: 'balanceOf', result: state.tokenBalances[owner.toLowerCase()] ?? 0n });
    }
    if (decoded.functionName === 'allowance') {
      const [owner] = decoded.args as [Address, Address];
      return encodeFunctionResult({ abi: tokenAbi, functionName: 'allowance', result: state.allowances[owner.toLowerCase()] ?? 0n });
    }
    if (decoded.functionName === 'approve') return encodeFunctionResult({ abi: tokenAbi, functionName: 'approve', result: true });
  }
  if (target === POOL_SWAP_TEST.toLowerCase()) {
    const { args } = decodeFunctionData({ abi: POOL_SWAP_TEST_ABI, data });
    if (state.swapRevertData) revert(state.swapRevertData);
    const [, params] = args;
    const amountIn = -params.amountSpecified;
    if (params.zeroForOne && value !== amountIn) throw new Error(`mock: msg.value ${value} != amountIn ${amountIn}`);
    if (from && params.zeroForOne && (state.balances[from.toLowerCase()] ?? 0n) < value) {
      throw new RpcRequestError({
        body: { method: 'eth_call' },
        error: { code: -32000, message: 'insufficient funds for transfer' },
        url: 'mock://rpc',
      });
    }
    const out = (amountIn * state.quoteOutPerInput) / 10n ** 18n;
    const delta = params.zeroForOne ? packDelta(-amountIn, out) : packDelta(out / 1_000_000n, -amountIn);
    return encodeAbiParameters([{ type: 'int256' }], [delta]);
  }
  throw new Error(`mock rpc: unhandled eth_call to ${to} data ${data.slice(0, 10)}`);
}

export const rpcProvider = {
  async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    calls.push({ method, params });
    const p = (params ?? []) as unknown[];
    switch (method) {
      case 'eth_chainId':
        return numberToHex(state.chainId);
      case 'eth_blockNumber':
        return numberToHex(state.blockNumber);
      case 'eth_getBlockByNumber': {
        const tag = p[0] as string;
        const number = tag === 'latest' || tag === 'pending' ? state.blockNumber : BigInt(tag);
        return {
          number: numberToHex(number),
          timestamp: numberToHex(state.timestamp - (state.blockNumber - number) * 12n),
          hash: toHex(number, { size: 32 }),
          parentHash: toHex(number - 1n, { size: 32 }),
          baseFeePerGas: '0x1',
          gasLimit: '0x1c9c380',
          gasUsed: '0x0',
          miner: '0x0000000000000000000000000000000000000000',
          transactions: [],
        };
      }
      case 'eth_getBalance': {
        const [address] = p as [Address];
        return numberToHex(state.balances[address.toLowerCase()] ?? 0n);
      }
      case 'eth_call': {
        const [tx] = p as [{ to: Address; data: Hex; value?: Hex; from?: Address }];
        return handleCall(tx.to, tx.data, tx.value ? BigInt(tx.value) : 0n, tx.from);
      }
      case 'eth_estimateGas':
        return '0x5208';
      case 'eth_getLogs': {
        const [filter] = p as [{ fromBlock: Hex; toBlock: Hex; address: Address; topics: (Hex | null)[] }];
        const from = BigInt(filter.fromBlock);
        const to = BigInt(filter.toBlock);
        return state.logs
          .filter((l) => l.blockNumber >= from && l.blockNumber <= to)
          .map((l) => ({
            address: addresses.hook,
            blockNumber: numberToHex(l.blockNumber),
            blockHash: toHex(l.blockNumber, { size: 32 }),
            transactionHash: l.txHash,
            transactionIndex: '0x0',
            logIndex: numberToHex(l.logIndex),
            removed: false,
            topics: encodeEventTopics({ abi: [OUTFLOW], eventName: 'Outflow', args: { poolId: filter.topics[1] as Hex } }),
            data: encodeAbiParameters(
              [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
              [l.blockNumber, l.amount, l.usedInBlock],
            ),
          }));
      }
      case 'eth_getTransactionReceipt': {
        const [hash] = p as [Hex];
        state.onReceipt?.();
        state.onReceipt = null;
        return {
          transactionHash: hash,
          blockNumber: numberToHex(state.blockNumber),
          blockHash: toHex(state.blockNumber, { size: 32 }),
          transactionIndex: '0x0',
          from: '0x0000000000000000000000000000000000000000',
          to: POOL_SWAP_TEST,
          status: state.receiptStatus === 'success' ? '0x1' : '0x0',
          gasUsed: '0x5208',
          cumulativeGasUsed: '0x5208',
          effectiveGasPrice: '0x1',
          logs: [],
          logsBloom: `0x${'0'.repeat(512)}`,
          type: '0x2',
        };
      }
      default:
        throw new Error(`mock rpc: unhandled method ${method}`);
    }
  },
};
