import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { canonicalAbiHash, validateManifest } from './deployment';
import { decodeRevertData, toUserFacingError } from './errors';
import { formatAmount, formatDuration, parseAmount } from './format';
import { applySlippage, launchPoolKey, parseSlippageBps, poolId, splitBalanceDelta } from './pool';
import { walletAddChainParams } from './chain';
import { addresses, hookAbi, manifest, tokenAbi } from '../test/fixtures';

const WRAPPED: Hex =
  '0x90bfb8650000000000000000000000003d13515ce40b463d88a3149371d54133165a1040b47b2fb10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000004451c3dffc00000000000000000000000000000000000000000026a7b0aa52bc50c8f6659a0000000000000000000000000000000000000000000211654585005212800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004a9e35b2f00000000000000000000000000000000000000000000000000000000';

describe('deployment configuration', () => {
  it('binds the committed ABIs to the handoff hashes', () => {
    const hook = manifest.contracts.find((c) => c.name === 'BlockOutflowCapHook')!;
    const token = manifest.contracts.find((c) => c.name === 'Blockcap')!;
    expect(canonicalAbiHash(hookAbi)).toBe(hook.abiHash);
    expect(canonicalAbiHash(tokenAbi)).toBe(token.abiHash);
    expect(validateManifest(manifest)).toBe(manifest);
  });

  it('rejects manifests with traversal or URL paths and wrong versions', () => {
    const bad = (patch: Record<string, unknown>) => () => validateManifest({ ...manifest, ...patch });
    expect(bad({ version: 2 })).toThrow(/version/);
    expect(bad({ contracts: [{ ...manifest.contracts[0], abiPath: '../abi/x.json' }] })).toThrow(/abiPath/);
    expect(bad({ contracts: [{ ...manifest.contracts[0], abiPath: 'https://example.com/x.json' }] })).toThrow(/abiPath/);
    expect(bad({ assets: [{ path: '/index.html', sha256: 'a'.repeat(64) }] })).toThrow(/asset path/);
    expect(bad({ network: { ...manifest.network, chainId: 1 } })).toThrow(/network.chainId/);
  });

  it('derives wallet_addEthereumChain parameters from the network block', () => {
    expect(walletAddChainParams(manifest.network)).toEqual({
      chainId: '0xaa36a7',
      chainName: 'Sepolia',
      rpcUrls: manifest.network.rpcUrls,
      nativeCurrency: manifest.network.nativeCurrency,
      blockExplorerUrls: [manifest.network.explorer],
    });
  });
});

describe('pool math', () => {
  it('computes the launch pool id used on Sepolia', () => {
    const key = launchPoolKey(addresses.token, addresses.hook);
    expect(key.currency0).toBe('0x0000000000000000000000000000000000000000');
    expect(key.currency1).toBe(addresses.token);
    expect(poolId(key)).toBe('0xaf5929157e5342a1aa290d1ac01e9807b1c67eb0eaf8297eee59eed226bccdb9');
  });

  it('splits the BalanceDelta returned by a simulated PoolSwapTest buy', () => {
    const { amount0, amount1 } = splitBalanceDelta(-3402823669209384634633746074317186120624224781408962487n);
    expect(amount0).toBe(-10_000_000_000_000_000n);
    expect(amount1).toBe(495_993_935_775_218_591_037_513n);
  });

  it('applies slippage in basis points', () => {
    expect(parseSlippageBps('1')).toBe(100n);
    expect(parseSlippageBps('0.5')).toBe(50n);
    expect(parseSlippageBps('')).toBeNull();
    expect(parseSlippageBps('51')).toBeNull();
    expect(applySlippage(1_000_000n, 100n)).toBe(990_000n);
  });
});

describe('revert decoding', () => {
  it('decodes the nested WrappedError → BlockCapExceeded payload', () => {
    const decoded = decodeRevertData(WRAPPED, hookAbi);
    expect(decoded).toEqual({ kind: 'capExceeded', used: 46_731_075_248_031_101_963_625_882n, cap: 2_500_000n * 10n ** 18n });
  });

  it('explains the quoter’s NotEnoughLiquidity revert seen for sells on the one-sided launch pool', () => {
    const quoterRevert: Hex =
      '0x6190b2b0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000247a5ed734af5929157e5342a1aa290d1ac01e9807b1c67eb0eaf8297eee59eed226bccdb900000000000000000000000000000000000000000000000000000000';
    const result = toUserFacingError({ code: 3, message: 'execution reverted', data: quoterRevert }, hookAbi);
    expect(result.message).toMatch(/No liquidity is available in this direction/);
    expect(result.capExceeded).toBeUndefined();
  });

  it('turns a wallet rejection into a calm message', () => {
    const result = toUserFacingError(Object.assign(new Error('User rejected the request.'), { code: 4001 }));
    expect(result.rejected).toBe(true);
    expect(result.message).toBe('Request rejected in the wallet. Nothing was sent.');
  });

  it('exposes the cap numbers from a plain provider error carrying revert data', () => {
    const result = toUserFacingError({ code: 3, message: 'execution reverted', data: WRAPPED }, hookAbi);
    expect(result.capExceeded?.cap).toBe(2_500_000n * 10n ** 18n);
  });
});

describe('formatting', () => {
  it('formats amounts with grouping and bounded fractions', () => {
    expect(formatAmount(2_500_000n * 10n ** 18n, 18, 2)).toBe('2,500,000');
    expect(formatAmount(495_993_935_775_218_591_037_513n, 18, 4)).toBe('495,993.9357');
    expect(formatAmount(1n, 18, 4)).toBe('<0.0001');
    expect(formatAmount(0n, 18, 4)).toBe('0');
  });

  it('parses visitor input strictly', () => {
    expect(parseAmount('0.01', 18)).toBe(10n ** 16n);
    expect(parseAmount('1,000', 18)).toBe(1000n * 10n ** 18n);
    expect(parseAmount('abc', 18)).toBeNull();
    expect(parseAmount('0', 18)).toBeNull();
    expect(parseAmount('1.' + '1'.repeat(19), 18)).toBeNull();
  });

  it('formats durations', () => {
    expect(formatDuration(86_097)).toBe('23h 54m 57s');
    expect(formatDuration(-5)).toBe('0h 00m 00s');
  });
});
