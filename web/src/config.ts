/**
 * Central configuration.
 *
 * Deployment identity (chain id, contract addresses, ABI paths, public RPC URLs and the
 * vetted Uniswap v4 addresses) is NOT duplicated here. The app loads it at runtime from
 * `imd-deployment.json` next to index.html (see `lib/deployment.ts`); that file is generated
 * from the workflow handoff by `scripts/build-manifest.mjs` and is the single source of truth.
 *
 * This module only holds values that the handoff does not carry: the approved workflow's
 * swap router, the launch pool parameters, ABIs of the shared Uniswap contracts, and UI tuning.
 * No private credentials or API keys are needed or present.
 */
import { parseAbi, type Address } from 'viem';

/** Where the runtime deployment configuration lives, relative to index.html. */
export const DEPLOYMENT_MANIFEST_PATH = './imd-deployment.json';

/** Names of the handoff contracts this page binds to (must match `contracts[].name`). */
export const CONTRACT_NAMES = {
  token: 'Blockcap',
  hook: 'BlockOutflowCapHook',
} as const;

/**
 * Launch pool parameters from the approved workflow and attested manifest
 * (`manifest.pool`): native ETH is currency0, BCAP is currency1, LP fee 3000, tick spacing 60,
 * hooks = the deployed BlockOutflowCapHook (taken from the runtime manifest).
 */
export const POOL = {
  pairedCurrency: '0x0000000000000000000000000000000000000000' as Address,
  fee: 3000,
  tickSpacing: 60,
} as const;

/**
 * Swap router required by the approved workflow: Uniswap v4-core `PoolSwapTest` on Sepolia.
 * It forwards hookData and sqrtPriceLimitX96 to the PoolManager. It is not part of the vetted
 * network block, so it is the one address configured here. Quotes use the network's V4Quoter
 * and prices the network's StateView, both read from the runtime manifest.
 */
export const POOL_SWAP_TEST: Address = '0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe';

/**
 * First block to scan for Outflow events: the handoff's deployment block of the hook
 * (contracts[].blockNumber = 11794805, tx 0x2209040b…). The runtime manifest schema carries no
 * block numbers, so this scan hint lives here. Too early only costs extra log requests.
 */
export const OUTFLOW_SCAN_FROM_BLOCK = 11_794_805n;

/** Uniswap v4-core TickMath bounds; ±1 so an exact-input swap fills completely. */
export const MIN_SQRT_PRICE_LIMIT = 4295128739n + 1n;
export const MAX_SQRT_PRICE_LIMIT = 1461446703485210103287273052203988822378723970342n - 1n;

/** Optional WalletConnect project id. Empty: only injected (EIP-6963 / window.ethereum) wallets. */
export const WALLETCONNECT_PROJECT_ID = '';

/** UI tuning. */
export const UI = {
  /** How often to poll the chain head, in ms (Sepolia blocks are ~12 s). */
  blockPollIntervalMs: 6_000,
  /** Debounce for quoting after the visitor types, in ms. */
  quoteDebounceMs: 400,
  /** Default slippage tolerance in percent. */
  defaultSlippagePercent: '1',
  /** Maximum number of Outflow rows shown. */
  maxOutflowRows: 100,
  /** Block-range chunk for eth_getLogs against public RPCs. */
  logChunkSize: 5_000n,
} as const;

/** ABIs of shared Uniswap v4 contracts (not handoff contracts, so they live in source). */
export const V4_QUOTER_ABI = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
]);

export const STATE_VIEW_ABI = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
]);

export const POOL_SWAP_TEST_ABI = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }',
  'struct TestSettings { bool takeClaims; bool settleUsingBurn; }',
  'function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256 delta)',
  'error NoSwapOccurred()',
]);

/** PoolManager errors that a swap can surface (for readable revert reasons). */
export const POOL_MANAGER_ERRORS_ABI = parseAbi([
  'error WrappedError(address target, bytes4 selector, bytes reason, bytes details)',
  'error HookCallFailed()',
  'error PriceLimitAlreadyExceeded(uint160 sqrtPriceCurrentX96, uint160 sqrtPriceLimitX96)',
  'error PriceLimitOutOfBounds(uint160 sqrtPriceLimitX96)',
  'error SwapAmountCannotBeZero()',
  'error CurrencyNotSettled()',
  'error PoolNotInitialized()',
]);
