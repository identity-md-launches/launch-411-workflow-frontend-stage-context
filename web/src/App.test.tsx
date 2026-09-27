import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createPublicClient, custom, encodeErrorResult, parseAbi, type Hex } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { POOL_SWAP_TEST } from './config';
import { manifest } from './test/fixtures';
import { calls, resetRpc, rpcProvider, state } from './test/mockRpc';
import { createMockWallet } from './test/mockWallet';

// Route the app's public client through the in-memory node.
vi.mock('./lib/chain', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/chain')>();
  return {
    ...original,
    createPublicRpcClient: (network: Parameters<typeof original.createPublicRpcClient>[0]) =>
      createPublicClient({ chain: original.chainFromNetwork(network), transport: custom(rpcProvider) }),
  };
});

const ACCOUNT = '0x00000000000000000000000000000000000000aa';
const ONE = 10n ** 18n;

// Real revert payload captured from Sepolia when a 1 ETH buy was quoted above the cap.
const CAP_REVERT_WRAPPED: Hex =
  '0x90bfb8650000000000000000000000003d13515ce40b463d88a3149371d54133165a1040b47b2fb10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000004451c3dffc00000000000000000000000000000000000000000026a7b0aa52bc50c8f6659a0000000000000000000000000000000000000000000211654585005212800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004a9e35b2f00000000000000000000000000000000000000000000000000000000';
const CAP_REVERT_QUOTER = encodeErrorResult({
  abi: parseAbi(['error UnexpectedRevertBytes(bytes revertData)']),
  errorName: 'UnexpectedRevertBytes',
  args: [CAP_REVERT_WRAPPED],
});

async function renderApp() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Blockcap launch pool' });
  return user;
}

beforeEach(() => {
  resetRpc();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('reads without a wallet', () => {
  it('loads the runtime deployment configuration and shows live hook, pool and countdown state', async () => {
    await renderApp();
    const allowance = await screen.findByRole('region', { name: 'Allowance this block' });
    await within(allowance).findByText('2,500,000');
    expect(within(allowance).getByText('Cap active')).toBeInTheDocument();
    expect(within(allowance).getByText(/left, ends/)).toHaveTextContent(/\d+h \d{2}m \d{2}s/);
    const pool = screen.getByRole('region', { name: 'Pool' });
    await within(pool).findByText(/1 ETH ≈ 50,000,000 BCAP/);
    expect(screen.getByText(/No browser wallet detected/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy BCAP' })).toBeDisabled();
    expect(screen.getByText('Connect a wallet to swap.')).toBeInTheDocument();
    // The contract addresses come from the manifest, not from source.
    const contracts = screen.getByRole('region', { name: 'Contracts' });
    for (const c of manifest.contracts) {
      expect(within(contracts).getByRole('link', { name: new RegExp(c.address) })).toHaveAttribute(
        'href',
        `${manifest.network.explorer}/address/${c.address}`,
      );
    }
    expect(within(contracts).getByRole('link', { name: new RegExp(POOL_SWAP_TEST) })).toBeInTheDocument();
  });

  it('shows the cap-ended state and the not-initialized state', async () => {
    resetRpc({ active: false, capEndsAt: 1_790_000_000n });
    await renderApp();
    const allowance = await screen.findByRole('region', { name: 'Allowance this block' });
    await within(allowance).findByText('Cap ended');
    expect(within(allowance).getByText(/Buys are no longer limited/)).toBeInTheDocument();
  });

  it('renders Outflow history rows per block from the hook logs, newest first', async () => {
    resetRpc({
      remaining: 1_000_000n * ONE,
      logs: [
        { blockNumber: 11_794_850n, txHash: `0x${'1'.repeat(64)}`, logIndex: 3, amount: 400_000n * ONE, usedInBlock: 400_000n * ONE },
        { blockNumber: 11_794_900n, txHash: `0x${'2'.repeat(64)}`, logIndex: 1, amount: 1_500_000n * ONE, usedInBlock: 1_500_000n * ONE },
      ],
    });
    await renderApp();
    const history = await screen.findByRole('region', { name: 'Outflow history' });
    const rows = await within(history).findAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2 events
    expect(rows[1]).toHaveTextContent('11794900');
    expect(rows[1]).toHaveTextContent('1,500,000');
    expect(rows[1]).toHaveTextContent('60.0%');
    expect(rows[2]).toHaveTextContent('11794850');
    expect(within(history).getByText(/2 blocks with counted buys/)).toBeInTheDocument();
    // Log requests stay within the RPC's block-range limits.
    for (const call of calls.filter((c) => c.method === 'eth_getLogs')) {
      const [filter] = call.params as [{ fromBlock: Hex; toBlock: Hex }];
      expect(BigInt(filter.toBlock) - BigInt(filter.fromBlock)).toBeLessThan(10_000n);
    }
  });

  it('shows an empty state when no buys were counted', async () => {
    await renderApp();
    expect(await screen.findByText('No counted buys yet.')).toBeInTheDocument();
  });
});

describe('wallet connection and network switching', () => {
  it('connects an injected wallet, flags the wrong chain, adds the chain after a 4902 and switches', async () => {
    const wallet = createMockWallet({ account: ACCOUNT, chainId: 1, knownChains: [1] });
    window.ethereum = wallet;
    const user = await renderApp();
    await user.click(await screen.findByRole('button', { name: 'Connect wallet' }));
    expect(await screen.findByText('Wrong network')).toBeInTheDocument();
    expect(screen.getByText(/needs Sepolia \(11155111\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy BCAP' })).toBeDisabled();
    expect(screen.getByText('Switch the wallet to Sepolia to swap.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Switch to Sepolia' }));
    await screen.findByText('Sepolia', { selector: '.badge' });

    const methods = wallet.requests.map((r) => r.method);
    const firstSwitch = methods.indexOf('wallet_switchEthereumChain');
    const add = methods.indexOf('wallet_addEthereumChain');
    expect(firstSwitch).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(firstSwitch);
    const addParams = wallet.requests[add]!.params as [Record<string, unknown>];
    expect(addParams[0]).toEqual({
      chainId: '0xaa36a7',
      chainName: manifest.network.name,
      rpcUrls: manifest.network.rpcUrls,
      nativeCurrency: manifest.network.nativeCurrency,
      blockExplorerUrls: [manifest.network.explorer],
    });
    expect(screen.getByRole('link', { name: /0x0000…00aa/ })).toBeInTheDocument();
  });

  it('discovers EIP-6963 wallets by name and supports disconnecting', async () => {
    const wallet = createMockWallet({ account: ACCOUNT, chainId: 11155111 });
    const announce = () => {
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: { info: { uuid: 'u-1', name: 'Test Wallet', icon: 'data:image/svg+xml,', rdns: 'test.wallet' }, provider: wallet },
        }),
      );
    };
    window.addEventListener('eip6963:requestProvider', announce);
    try {
      const user = await renderApp();
      await user.click(await screen.findByRole('button', { name: 'Connect wallet' }));
      await screen.findByText('Sepolia', { selector: '.badge' });
      expect(wallet.requests.map((r) => r.method)).toContain('eth_requestAccounts');
      await user.click(screen.getByRole('button', { name: 'Disconnect' }));
      expect(await screen.findByRole('button', { name: 'Connect wallet' })).toBeInTheDocument();
    } finally {
      window.removeEventListener('eip6963:requestProvider', announce);
    }
  });

  it('reports a rejected connection request', async () => {
    const wallet = createMockWallet({ account: ACCOUNT, chainId: 11155111 });
    wallet.request = async ({ method }) => {
      if (method === 'eth_requestAccounts') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      return null;
    };
    window.ethereum = wallet;
    const user = await renderApp();
    await user.click(await screen.findByRole('button', { name: 'Connect wallet' }));
    expect(await screen.findByText('Request rejected in the wallet. Nothing was sent.')).toBeInTheDocument();
  });
});

describe('swap form', () => {
  function connectedWallet(overrides: Partial<Parameters<typeof createMockWallet>[0]> = {}) {
    const wallet = createMockWallet({ account: ACCOUNT, chainId: 11155111, ...overrides });
    window.ethereum = wallet;
    state.balances[ACCOUNT] = 5n * ONE;
    state.tokenBalances[ACCOUNT] = 3_000_000n * ONE;
    return wallet;
  }

  it('quotes a buy through the V4Quoter and shows output, minimum and share of cap', async () => {
    connectedWallet();
    const user = await renderApp();
    await user.click(await screen.findByRole('button', { name: 'Connect wallet' }));
    await user.type(screen.getByLabelText('Amount in (ETH)'), '0.01');
    await screen.findByText('Expected output');
    expect(screen.getByText(/495,993\.9357 BCAP/)).toBeInTheDocument(); // 0.01 × 49,599,393.57…
    expect(screen.getByText(/491,033\.9964 BCAP/)).toBeInTheDocument(); // 1% slippage
    expect(screen.getByText('19.8%')).toBeInTheDocument(); // of the 2.5M cap
    expect(screen.getByRole('button', { name: 'Buy BCAP' })).toBeEnabled();
    const quoteCall = calls.find((c) => c.method === 'eth_call' && (c.params as [{ to: string }])[0].to.toLowerCase() === manifest.network.uniswapV4.quoter);
    expect(quoteCall).toBeDefined();
  });

  it('warns when the quoted output exceeds the remaining allowance and blocks buys above the cap', async () => {
    resetRpc({ remaining: 300_000n * ONE });
    connectedWallet();
    const user = await renderApp();
    await user.click(await screen.findByRole('button', { name: 'Connect wallet' }));
    const amount = screen.getByLabelText('Amount in (ETH)');
    await user.type(amount, '0.01');
    expect(await screen.findByText(/exceeds the 300,000 BCAP still allowed in the current block/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy BCAP' })).toBeEnabled();

    await user.clear(amount);
    await user.type(amount, '0.06'); // ≈ 3.0M BCAP > 2.5M cap
    expect(await screen.findByText(/larger than the 2,500,000 BCAP per-block cap/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy BCAP' })).toBeDisabled();
    expect(screen.getByText('Reduce the amount: the output is larger than the per-block cap.')).toBeInTheDocument();
  });

  it('decodes a BlockCapExceeded revert from the quoter into an over-cap message', async () => {
    resetRpc({ quoteRevertData: CAP_REVERT_QUOTER });
    connectedWallet();
    const user = await renderApp();
    await user.click(await screen.findByRole('button', { name: 'Connect wallet' }));
    await user.type(screen.getByLabelText('Amount in (ETH)'), '1');
    expect(await screen.findByText(/Over the cap: this buy would bring the block’s total to 46,731,075\.24 BCAP, above the 2,500,000 BCAP per-block cap/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy BCAP' })).toBeDisabled();
  });

  it('simulates, signs, waits and confirms a buy, then reports the received amount', async () => {
    const wallet = connectedWallet();
    const user = await renderApp();
    await user.click(await screen.findByRole('button', { name: 'Connect wallet' }));
    await user.type(screen.getByLabelText('Amount in (ETH)'), '0.01');
    const buy = await screen.findByRole('button', { name: 'Buy BCAP' });
    await waitFor(() => expect(buy).toBeEnabled());
    // The balance read after mining shows the delivered tokens.
    const before = state.tokenBalances[ACCOUNT]!;
    state.onReceipt = () => {
      state.tokenBalances[ACCOUNT] = before + 499_993n * ONE;
    };
    await user.click(buy);
    expect(await screen.findByText(/Swap confirmed\. Received 499,993 BCAP\./)).toBeInTheDocument();
    const tx = wallet.requests.find((r) => r.method === 'eth_sendTransaction');
    expect(tx).toBeDefined();
    const [request] = tx!.params as [{ to: string; value: Hex; data: Hex }];
    expect(request.to.toLowerCase()).toBe(POOL_SWAP_TEST.toLowerCase());
    expect(BigInt(request.value)).toBe(ONE / 100n);
    expect(screen.getByRole('link', { name: 'View transaction' })).toHaveAttribute('href', `${manifest.network.explorer}/tx/${wallet.sent[0]}`);
  });

  it('shows a calm message when the wallet rejects the signature', async () => {
    connectedWallet({ rejectSigning: true });
    const user = await renderApp();
    await user.click(await screen.findByRole('button', { name: 'Connect wallet' }));
    await user.type(screen.getByLabelText('Amount in (ETH)'), '0.01');
    const buy = await screen.findByRole('button', { name: 'Buy BCAP' });
    await waitFor(() => expect(buy).toBeEnabled());
    await user.click(buy);
    expect(await screen.findByText(/Swap not completed: Request rejected in the wallet\. Nothing was sent\./)).toBeInTheDocument();
  });

  it('shows the decoded hook revert when the swap simulation fails with BlockCapExceeded', async () => {
    resetRpc({ swapRevertData: CAP_REVERT_WRAPPED });
    connectedWallet();
    const user = await renderApp();
    await user.click(await screen.findByRole('button', { name: 'Connect wallet' }));
    await user.type(screen.getByLabelText('Amount in (ETH)'), '0.01');
    const buy = await screen.findByRole('button', { name: 'Buy BCAP' });
    await waitFor(() => expect(buy).toBeEnabled());
    await user.click(buy);
    expect(await screen.findByText(/The buy would exceed this block’s cap and the hook reverts it \(BlockCapExceeded\)\. Attempted block total 46,731,075\.24 BCAP against a cap of 2,500,000 BCAP\./)).toBeInTheDocument();
  });

  it('requires an explicit approval step before selling and then enables the sell', async () => {
    const wallet = connectedWallet();
    const user = await renderApp();
    await user.click(await screen.findByRole('button', { name: 'Connect wallet' }));
    await user.click(screen.getByLabelText('Sell BCAP for ETH'));
    await user.type(screen.getByLabelText('Amount in (BCAP)'), '1000');
    await screen.findByText('Expected output');
    const approve = await screen.findByRole('button', { name: 'Approve BCAP' });
    expect(screen.getByRole('button', { name: 'Sell BCAP' })).toBeDisabled();
    expect(screen.getByText(/Step 1 of 2: approve PoolSwapTest to spend 1,000 BCAP/)).toBeInTheDocument();
    await user.click(approve);
    expect(await screen.findByText(/Approval confirmed\./)).toBeInTheDocument();
    const tx = wallet.requests.find((r) => r.method === 'eth_sendTransaction');
    const [request] = tx!.params as [{ to: string; data: Hex }];
    expect(request.to.toLowerCase()).toBe(manifest.contracts.find((c) => c.name === 'Blockcap')!.address.toLowerCase());
    expect(request.data.startsWith('0x095ea7b3')).toBe(true); // approve(address,uint256)
    expect(request.data.slice(34, 74).toLowerCase()).toBe(POOL_SWAP_TEST.slice(2).toLowerCase());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sell BCAP' })).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Approve BCAP' })).not.toBeInTheDocument();
  });

  it('flags an invalid amount inline and an insufficient balance', async () => {
    connectedWallet();
    state.balances[ACCOUNT] = ONE / 1000n;
    const user = await renderApp();
    await user.click(await screen.findByRole('button', { name: 'Connect wallet' }));
    const amount = screen.getByLabelText('Amount in (ETH)');
    await user.type(amount, 'abc');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Enter a positive number/)).toBeInTheDocument();
    await user.clear(amount);
    await user.type(amount, '0.01');
    expect(await screen.findByText('Not enough ETH in the connected account.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy BCAP' })).toBeDisabled();
  });
});
