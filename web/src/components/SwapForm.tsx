import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Address, Hex, PublicClient } from 'viem';
import { MAX_SQRT_PRICE_LIMIT, MIN_SQRT_PRICE_LIMIT, POOL_SWAP_TEST, POOL_SWAP_TEST_ABI, UI, V4_QUOTER_ABI } from '../config';
import type { HookStatus } from '../hooks/useHookState';
import type { WalletState } from '../hooks/useWallet';
import type { Deployment } from '../lib/deployment';
import { explorerTxUrl } from '../lib/chain';
import { toUserFacingError, type UserFacingError } from '../lib/errors';
import { formatAmount, formatPercent, parseAmount } from '../lib/format';
import { applySlippage, parseSlippageBps, splitBalanceDelta, type PoolKey } from '../lib/pool';

type Direction = 'buy' | 'sell';

interface Quote {
  amountIn: bigint;
  amountOut: bigint;
  direction: Direction;
  blockNumber: bigint;
}

type QuoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; quote: Quote }
  | { status: 'error'; error: UserFacingError; amountIn: bigint; direction: Direction };

type TxPhase =
  | { step: 'idle' }
  | { step: 'simulating'; action: 'approve' | 'swap' }
  | { step: 'signing'; action: 'approve' | 'swap' }
  | { step: 'pending'; action: 'approve' | 'swap'; hash: Hex }
  | { step: 'confirmed'; action: 'approve' | 'swap'; hash: Hex; received?: { amount: bigint; symbol: string } | undefined }
  | { step: 'failed'; action: 'approve' | 'swap'; error: UserFacingError; hash?: Hex | undefined };

interface Props {
  deployment: Deployment;
  client: PublicClient;
  poolKey: PoolKey;
  wallet: WalletState;
  status: HookStatus | null;
  blockNumber: bigint | null;
  onTransactionMined: () => void;
}

export function SwapForm({ deployment, client, poolKey, wallet, status, blockNumber, onTransactionMined }: Props) {
  const { manifest, token, hook } = deployment;
  const network = manifest.network;
  const native = network.nativeCurrency;
  const tokenSymbol = 'BCAP';
  const tokenDecimals = 18;

  const [direction, setDirection] = useState<Direction>('buy');
  const [amountText, setAmountText] = useState('');
  const [slippageText, setSlippageText] = useState<string>(UI.defaultSlippagePercent);
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: 'idle' });
  const [tx, setTx] = useState<TxPhase>({ step: 'idle' });
  const [balances, setBalances] = useState<{ native: bigint; token: bigint; allowance: bigint } | null>(null);
  const quoteSeq = useRef(0);
  const ids = { amount: useId(), slippage: useId(), direction: useId(), amountHelp: useId(), quote: useId() };

  const inDecimals = direction === 'buy' ? native.decimals : tokenDecimals;
  const inSymbol = direction === 'buy' ? native.symbol : tokenSymbol;
  const outSymbol = direction === 'buy' ? tokenSymbol : native.symbol;
  const outDecimals = direction === 'buy' ? tokenDecimals : native.decimals;
  const amountIn = useMemo(() => parseAmount(amountText, inDecimals), [amountText, inDecimals]);
  const slippageBps = useMemo(() => parseSlippageBps(slippageText), [slippageText]);
  const amountInvalid = amountText.trim() !== '' && amountIn === null;
  const slippageInvalid = slippageBps === null;

  // Balances and allowance for the connected account, refreshed per block.
  useEffect(() => {
    const account = wallet.account;
    if (!account || !wallet.onExpectedChain || blockNumber === null) {
      setBalances(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [nativeBalance, tokenBalance, allowance] = await Promise.all([
          client.getBalance({ address: account }),
          client.readContract({ address: token.address, abi: token.abi, functionName: 'balanceOf', args: [account] }) as Promise<bigint>,
          client.readContract({
            address: token.address,
            abi: token.abi,
            functionName: 'allowance',
            args: [account, POOL_SWAP_TEST],
          }) as Promise<bigint>,
        ]);
        if (!cancelled) setBalances({ native: nativeBalance, token: tokenBalance, allowance });
      } catch {
        if (!cancelled) setBalances(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, token, wallet.account, wallet.onExpectedChain, blockNumber]);

  // Quote (debounced) whenever the input changes or a new block arrives.
  useEffect(() => {
    if (amountIn === null) {
      setQuoteState({ status: 'idle' });
      return;
    }
    const seq = ++quoteSeq.current;
    const handle = window.setTimeout(async () => {
      setQuoteState({ status: 'loading' });
      try {
        const { result } = await client.simulateContract({
          address: network.uniswapV4.quoter,
          abi: V4_QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [{ poolKey, zeroForOne: direction === 'buy', exactAmount: amountIn, hookData: '0x' }],
        });
        if (seq !== quoteSeq.current) return;
        setQuoteState({
          status: 'ready',
          quote: { amountIn, amountOut: result[0], direction, blockNumber: blockNumber ?? 0n },
        });
      } catch (e) {
        if (seq !== quoteSeq.current) return;
        setQuoteState({ status: 'error', error: toUserFacingError(e, hook.abi, 'Unable to quote.'), amountIn, direction });
      }
    }, UI.quoteDebounceMs);
    return () => window.clearTimeout(handle);
  }, [amountIn, direction, client, network.uniswapV4.quoter, poolKey, blockNumber, hook.abi]);

  const quote = quoteState.status === 'ready' && quoteState.quote.amountIn === amountIn && quoteState.quote.direction === direction ? quoteState.quote : null;
  const quoteError = quoteState.status === 'error' && quoteState.amountIn === amountIn && quoteState.direction === direction ? quoteState.error : null;
  const minOut = quote && slippageBps !== null ? applySlippage(quote.amountOut, slippageBps) : null;

  // Cap analysis for buys.
  const capActive = status?.active ?? false;
  const cap = status?.cap ?? null;
  const remaining = status?.remainingThisBlock ?? null;
  const exceedsCap = direction === 'buy' && capActive && quote !== null && cap !== null && quote.amountOut > cap;
  const exceedsRemaining =
    direction === 'buy' && capActive && quote !== null && remaining !== null && !exceedsCap && quote.amountOut > remaining;
  const quoteCapRevert = quoteError?.capExceeded ?? null;

  const needsApproval = direction === 'sell' && amountIn !== null && balances !== null && balances.allowance < amountIn;
  const insufficient =
    amountIn !== null && balances !== null && (direction === 'buy' ? balances.native <= amountIn : balances.token < amountIn);

  const busy = tx.step === 'simulating' || tx.step === 'signing' || tx.step === 'pending';

  const blockedReason = (() => {
    if (!wallet.account) return 'Connect a wallet to swap.';
    if (!wallet.onExpectedChain) return `Switch the wallet to ${network.name} to swap.`;
    if (amountIn === null) return 'Enter an amount to swap.';
    if (slippageInvalid) return 'Enter a slippage tolerance between 0 and 50%.';
    if (insufficient) return `Not enough ${inSymbol} in the connected account.`;
    if (quoteCapRevert) return 'Reduce the amount: this buy would exceed the block cap.';
    if (quoteError) return 'The quote failed; adjust the amount and try again.';
    if (!quote) return 'Waiting for a quote.';
    if (exceedsCap) return 'Reduce the amount: the output is larger than the per-block cap.';
    if (busy) return 'A transaction is in progress.';
    return null;
  })();

  const refreshBalances = useCallback(() => {
    onTransactionMined();
  }, [onTransactionMined]);

  const runApprove = useCallback(async () => {
    const walletClient = wallet.walletClient;
    const account = wallet.account;
    if (!walletClient || !account || amountIn === null) return;
    setTx({ step: 'simulating', action: 'approve' });
    try {
      const { request } = await client.simulateContract({
        account,
        address: token.address,
        abi: token.abi,
        functionName: 'approve',
        args: [POOL_SWAP_TEST, amountIn],
      });
      setTx({ step: 'signing', action: 'approve' });
      const hash = await walletClient.writeContract(request);
      setTx({ step: 'pending', action: 'approve', hash });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('The approval transaction reverted.');
      setTx({ step: 'confirmed', action: 'approve', hash });
      setBalances((b) => (b ? { ...b, allowance: amountIn } : b));
      refreshBalances();
    } catch (e) {
      setTx({ step: 'failed', action: 'approve', error: toUserFacingError(e, hook.abi, 'Approval failed.') });
    }
  }, [wallet.walletClient, wallet.account, amountIn, client, token, hook.abi, refreshBalances]);

  const runSwap = useCallback(async () => {
    const walletClient = wallet.walletClient;
    const account = wallet.account;
    if (!walletClient || !account || amountIn === null || !quote || minOut === null) return;
    const zeroForOne = direction === 'buy';
    const outCurrency: Address = zeroForOne ? poolKey.currency1 : poolKey.currency0;
    setTx({ step: 'simulating', action: 'swap' });
    try {
      const before = await readBalance(client, token.address, token.abi, account, outCurrency);
      const { request, result } = await client.simulateContract({
        account,
        address: POOL_SWAP_TEST,
        abi: POOL_SWAP_TEST_ABI,
        functionName: 'swap',
        args: [
          poolKey,
          { zeroForOne, amountSpecified: -amountIn, sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_LIMIT : MAX_SQRT_PRICE_LIMIT },
          { takeClaims: false, settleUsingBurn: false },
          '0x',
        ],
        value: zeroForOne ? amountIn : 0n,
      });
      const delta = splitBalanceDelta(result);
      const simulatedOut = zeroForOne ? delta.amount1 : delta.amount0;
      if (simulatedOut < minOut) {
        throw new Error(
          `Simulated output ${formatAmount(simulatedOut, outDecimals, 4)} ${outSymbol} is below the minimum ${formatAmount(minOut, outDecimals, 4)} ${outSymbol}. The price moved; refresh the quote or raise the slippage tolerance.`,
        );
      }
      setTx({ step: 'signing', action: 'swap' });
      const hash = await walletClient.writeContract(request);
      setTx({ step: 'pending', action: 'swap', hash });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        setTx({ step: 'failed', action: 'swap', hash, error: { message: 'The swap transaction reverted on chain.', rejected: false } });
        refreshBalances();
        return;
      }
      const after = await readBalance(client, token.address, token.abi, account, outCurrency);
      const received = after - before;
      setTx({
        step: 'confirmed',
        action: 'swap',
        hash,
        received: received > 0n ? { amount: received, symbol: outSymbol } : undefined,
      });
      setAmountText('');
      refreshBalances();
    } catch (e) {
      setTx({ step: 'failed', action: 'swap', error: toUserFacingError(e, hook.abi, 'Swap failed.') });
    }
  }, [wallet.walletClient, wallet.account, amountIn, quote, minOut, direction, poolKey, client, token, hook.abi, outDecimals, outSymbol, refreshBalances]);

  const swapLabel = direction === 'buy' ? `Buy ${tokenSymbol}` : `Sell ${tokenSymbol}`;
  const actionLabel = (() => {
    if (tx.step === 'simulating' && tx.action === 'swap') return 'Checking…';
    if (tx.step === 'signing' && tx.action === 'swap') return 'Confirm in wallet…';
    if (tx.step === 'pending' && tx.action === 'swap') return 'Swapping…';
    return swapLabel;
  })();
  const approveLabel = (() => {
    if (tx.step === 'simulating' && tx.action === 'approve') return 'Checking…';
    if (tx.step === 'signing' && tx.action === 'approve') return 'Confirm in wallet…';
    if (tx.step === 'pending' && tx.action === 'approve') return 'Approving…';
    return `Approve ${tokenSymbol}`;
  })();

  return (
    <section className="card" aria-labelledby="swap-heading">
      <div className="card-header">
        <h2 id="swap-heading">Swap</h2>
        <span className="muted">Exact input via PoolSwapTest</span>
      </div>
      <form
        className="swap-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (needsApproval) void runApprove();
          else if (!blockedReason) void runSwap();
        }}
        noValidate
      >
        <fieldset className="direction" aria-describedby={ids.direction}>
          <legend>Direction</legend>
          <label className={`chip ${direction === 'buy' ? 'chip-selected' : ''}`}>
            <input type="radio" name="direction" value="buy" checked={direction === 'buy'} onChange={() => setDirection('buy')} />
            Buy {tokenSymbol} with {native.symbol}
          </label>
          <label className={`chip ${direction === 'sell' ? 'chip-selected' : ''}`}>
            <input type="radio" name="direction" value="sell" checked={direction === 'sell'} onChange={() => setDirection('sell')} />
            Sell {tokenSymbol} for {native.symbol}
          </label>
          <p id={ids.direction} className="muted small">
            {direction === 'buy' ? 'Buys count against the per-block cap.' : 'Sells are never capped and need a one-time token approval.'}
          </p>
        </fieldset>

        <div className="field">
          <div className="field-row">
            <label htmlFor={ids.amount}>Amount in ({inSymbol})</label>
            {balances && (
              <span className="muted small num">
                Balance {formatAmount(direction === 'buy' ? balances.native : balances.token, inDecimals, 4)} {inSymbol}
                {direction === 'sell' && balances.token > 0n && (
                  <>
                    {' '}
                    <button type="button" className="link-button" onClick={() => setAmountText(formatPlain(balances.token, tokenDecimals))}>
                      Use max
                    </button>
                  </>
                )}
              </span>
            )}
          </div>
          <input
            id={ids.amount}
            className="input num"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder={direction === 'buy' ? '0.01' : '1000'}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-invalid={amountInvalid || undefined}
            aria-describedby={ids.amountHelp}
          />
          <p id={ids.amountHelp} className={amountInvalid ? 'field-error' : 'muted small'}>
            {amountInvalid ? `Enter a positive number with at most ${inDecimals} decimals.` : `Exact input; you receive the pool’s output at the time of mining.`}
          </p>
        </div>

        <div className="field field-inline">
          <label htmlFor={ids.slippage}>Slippage tolerance (%)</label>
          <input
            id={ids.slippage}
            className="input input-short num"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={slippageText}
            onChange={(e) => setSlippageText(e.target.value)}
            aria-invalid={slippageInvalid || undefined}
          />
        </div>

        <div id={ids.quote} className="quote" role="status" aria-live="polite">
          {quoteState.status === 'loading' && amountIn !== null ? (
            <p className="muted">Fetching quote…</p>
          ) : quote ? (
            <dl className="facts">
              <div>
                <dt>Expected output</dt>
                <dd className="num">
                  {formatAmount(quote.amountOut, outDecimals, 4)} {outSymbol}
                </dd>
              </div>
              <div>
                <dt>Minimum after slippage</dt>
                <dd className="num">{minOut !== null ? `${formatAmount(minOut, outDecimals, 4)} ${outSymbol}` : '—'}</dd>
              </div>
              <div>
                <dt>Rate</dt>
                <dd className="num">{rateText(quote, direction, native.symbol, tokenSymbol, native.decimals, tokenDecimals)}</dd>
              </div>
              {direction === 'buy' && cap !== null && capActive && (
                <div>
                  <dt>Share of block cap</dt>
                  <dd className="num">{formatPercent(quote.amountOut, cap)}</dd>
                </div>
              )}
            </dl>
          ) : quoteError ? (
            <p className={quoteCapRevert ? 'notice notice-danger' : 'notice notice-danger'}>
              {quoteCapRevert
                ? `Over the cap: this buy would bring the block’s total to ${formatAmount(quoteCapRevert.used, tokenDecimals, 2)} ${tokenSymbol}, above the ${formatAmount(quoteCapRevert.cap, tokenDecimals, 0)} ${tokenSymbol} per-block cap, so the hook reverts it. Enter a smaller amount.`
                : quoteError.message}
            </p>
          ) : (
            <p className="muted">Enter an amount to see a quote from the V4Quoter.</p>
          )}
          {exceedsCap && cap !== null && (
            <p className="notice notice-danger">
              Over the cap: the expected output is larger than the {formatAmount(cap, tokenDecimals, 0)} {tokenSymbol} per-block cap,
              so the hook would revert this buy in any block. Enter a smaller amount.
            </p>
          )}
          {exceedsRemaining && remaining !== null && (
            <p className="notice notice-warning">
              Warning: the expected output exceeds the {formatAmount(remaining, tokenDecimals, 2)} {tokenSymbol} still allowed in the
              current block. If this buy is mined in a block with earlier buys it reverts; a new block resets the allowance to the full
              cap.
            </p>
          )}
          {direction === 'buy' && status && !capActive && status.capEndsAt !== 0n && (
            <p className="muted small">The cap window has ended; the hook no longer limits buys.</p>
          )}
        </div>

        <div className="actions">
          {needsApproval && (
            <button type="button" className="button button-primary" onClick={() => void runApprove()} disabled={busy || !!blockedReason && blockedReason !== 'Waiting for a quote.'}>
              {approveLabel}
            </button>
          )}
          <button
            type="submit"
            className={`button ${needsApproval ? 'button-secondary' : 'button-primary'}`}
            disabled={busy || needsApproval || blockedReason !== null}
          >
            {actionLabel}
          </button>
          <p className="muted small action-hint">
            {needsApproval
              ? `Step 1 of 2: approve PoolSwapTest to spend ${formatAmount(amountIn ?? 0n, tokenDecimals, 4)} ${tokenSymbol}, then sell.`
              : (blockedReason ?? `Simulates first, then asks the wallet to sign. Minimum output is checked in the simulation; the test router cannot enforce it on chain.`)}
          </p>
        </div>

        <div className="tx-status" role="status" aria-live="polite">
          <TxStatus tx={tx} network={network} outDecimals={outDecimals} />
        </div>
      </form>
    </section>
  );
}

function TxStatus({ tx, network, outDecimals }: { tx: TxPhase; network: Deployment['manifest']['network']; outDecimals: number }) {
  if (tx.step === 'idle') return null;
  const label = tx.action === 'approve' ? 'Approval' : 'Swap';
  const link = 'hash' in tx && tx.hash ? (
    <>
      {' '}
      <a href={explorerTxUrl(network, tx.hash)} target="_blank" rel="noreferrer">
        View transaction
      </a>
    </>
  ) : null;
  switch (tx.step) {
    case 'simulating':
      return <p className="muted">{label}: simulating against the current chain state…</p>;
    case 'signing':
      return <p className="muted">{label}: waiting for your confirmation in the wallet…</p>;
    case 'pending':
      return (
        <p className="muted">
          {label} sent, waiting for it to be mined.{link}
        </p>
      );
    case 'confirmed':
      return (
        <p className="notice notice-success">
          {label} confirmed.
          {tx.received ? ` Received ${formatAmount(tx.received.amount, outDecimals, 4)} ${tx.received.symbol}.` : ''}
          {link}
        </p>
      );
    case 'failed':
      return (
        <p className={tx.error.rejected ? 'notice notice-neutral' : 'notice notice-danger'}>
          {label} not completed: {tx.error.message}
          {tx.error.capExceeded
            ? ` Attempted block total ${formatAmount(tx.error.capExceeded.used, 18, 2)} BCAP against a cap of ${formatAmount(tx.error.capExceeded.cap, 18, 0)} BCAP.`
            : ''}
          {link}
        </p>
      );
  }
}

function rateText(quote: Quote, direction: Direction, nativeSymbol: string, tokenSymbol: string, nativeDecimals: number, tokenDecimals: number): string {
  if (quote.amountIn === 0n || quote.amountOut === 0n) return '—';
  if (direction === 'buy') {
    const perNative = (quote.amountOut * 10n ** BigInt(nativeDecimals)) / quote.amountIn;
    return `1 ${nativeSymbol} ≈ ${formatAmount(perNative, tokenDecimals, 2)} ${tokenSymbol}`;
  }
  const perToken = (quote.amountOut * 10n ** BigInt(tokenDecimals)) / quote.amountIn;
  return `1 ${tokenSymbol} ≈ ${formatAmount(perToken, nativeDecimals, 8)} ${nativeSymbol}`;
}

function formatPlain(raw: bigint, decimals: number): string {
  const text = raw.toString().padStart(decimals + 1, '0');
  const whole = text.slice(0, text.length - decimals);
  const frac = text.slice(text.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

async function readBalance(
  client: PublicClient,
  tokenAddress: Address,
  tokenAbi: Deployment['token']['abi'],
  account: Address,
  currency: Address,
): Promise<bigint> {
  if (currency === '0x0000000000000000000000000000000000000000') return client.getBalance({ address: account });
  return (await client.readContract({ address: tokenAddress, abi: tokenAbi, functionName: 'balanceOf', args: [account] })) as bigint;
}
