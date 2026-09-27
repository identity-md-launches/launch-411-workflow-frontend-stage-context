# Blockcap launch pool frontend

One static page for the Blockcap (BCAP) launch pool on Sepolia. It shows this block's remaining
buy allowance from `BlockOutflowCapHook`, a countdown to the end of the capped day, the pool's
spot price and liquidity, the hook's `Outflow` history per block, and a swap form that quotes an
exact-input buy or sell through the network's V4Quoter and warns when a buy would exceed the cap.
Swaps go through the approved workflow's `PoolSwapTest` router. There is no backend: reads go to
the chain's public RPC endpoints and signing stays in the visitor's browser wallet.

Stack: Vite 8, React 19, TypeScript 7, viem 2. Tests: Vitest 5 with Testing Library and jsdom.

## Configuration

Deployment identity lives in **one runtime file**, `dist/imd-deployment.json`, generated from the
workflow handoff by `scripts/build-manifest.mjs`:

- `chainId`, `launchId`, `sourceCommit`, `attestationHash`
- `contracts[]`: name, address, `abiHash` and `abiPath` (`dist/abi/<Contract>.json`, copied byte for
  byte from the pinned implementation-derived export in `docs/abi/`)
- `assets[]`: SHA-256 of every other exported file
- `network`: the vetted network block (name, public RPC URLs, explorer, native currency, faucets and
  the Uniswap v4 `poolManager`, `universalRouter`, `quoter`, `stateView`, `positionManager`, `permit2`)

The app fetches this file relative to `index.html` on start (`src/lib/deployment.ts`), validates it,
loads the referenced ABI JSON and checks each ABI's canonical keccak hash against `abiHash`.
Nothing else in the source knows an address, chain id, RPC URL or ABI of a handoff contract.
`wallet_addEthereumChain` parameters are derived from the same `network` block.

`src/config.ts` holds only what the handoff does not carry:

| Value | Why it is in source |
| --- | --- |
| `POOL_SWAP_TEST` | Swap router named by the approved workflow; not part of the vetted network block |
| `POOL` (paired currency, fee 3000, tick spacing 60) | Launch pool parameters from the attested manifest |
| `OUTFLOW_SCAN_FROM_BLOCK` | Deployment block, the earliest block that can hold an `Outflow` event |
| ABIs of V4Quoter, StateView, PoolSwapTest and PoolManager errors | Shared Uniswap contracts, not handoff contracts |
| `WALLETCONNECT_PROJECT_ID` (empty) | Optional; without it only injected wallets (EIP-6963 / `window.ethereum`) are offered |
| `UI` tuning (poll interval, debounce, default slippage, log chunk size) | Presentation only |

There are no private credentials, API keys or private RPC URLs anywhere in the project.

## Install, develop, preview

```sh
cd web
npm ci                # exact versions from package-lock.json
npm run dev           # Vite dev server; imd-deployment.json is served from ../dist (build once first)
npm run preview       # serves the production export from ../dist
```

The dev server does not generate the manifest, so run `npm run build` once before `npm run dev`
if `dist/imd-deployment.json` does not exist yet. Any static file server works for the export;
the base is relative (`./`) so it also loads from a gateway subpath such as `/ipfs/<cid>/` or an
ENS name without server rewrites.

## Rebuild the export

```sh
cd web
npm run build         # vite build -> ../dist, then scripts/build-manifest.mjs
npm run verify:manifest
```

`build-manifest.mjs` reads the handoff from `../.imd/reads/deployment.json` and the network block
from `../.imd/reads/network.json` (override with `IMD_DEPLOYMENT` and `IMD_NETWORK`). When those
inputs are absent, it reuses the identity fields of the committed `dist/imd-deployment.json` and
only regenerates the ABI copies and the asset hashes, so the manifest can always be rebuilt after
an export change. It refuses to write if an ABI hash does not match the handoff, if `docs/abi`
differs from the pinned source commit, or if the export exceeds 128 files or 8 MiB per file.

`verify-manifest.mjs` re-checks the committed export: schema, every listed hash, every exported
file listed, ABI hashes, and (when present) agreement with the handoff and `network.json`.

Commit `web/` (without `node_modules`), `dist/` and the manifest together after every rebuild.

## Validation

```sh
cd web
npm run typecheck     # tsc, app and config
npm test              # vitest: 28 tests, mocked JSON-RPC node and mocked EIP-1193 wallet
npm run build && npm run verify:manifest
FUNDED_ACCOUNT=0x… npm run browser:check   # bounded browser pass against the export (see below)
```

The unit and interaction tests (`src/App.test.tsx`, `src/lib/lib.test.ts`) load the committed
`dist/imd-deployment.json` and ABI files through the same code path the site uses, then exercise:
live reads without a wallet, cap-ended and empty states, Outflow history rows and chunked log
requests, wallet discovery (EIP-6963 and `window.ethereum`), the wrong-chain path with
`wallet_switchEthereumChain` → 4902 → `wallet_addEthereumChain` → switch, quoting, the over-cap
warning and the hard block above the cap, decoding of the real `BlockCapExceeded` revert payload
captured from Sepolia (from the quoter and from a swap simulation), simulate → sign → pending →
confirmed, wallet rejection, the explicit approval step before a sell, and inline input errors.

`scripts/browser-check.mjs` serves `dist/` under `/preview/` on an ephemeral port, drives a
headless Chromium with `playwright-core` (defaults point at the Playwright MCP install on the
worker; override with `PLAYWRIGHT_CORE` and `CHROMIUM_PATH`), and writes screenshots plus
`docs/validation/browser-report.json`. It checks four widths (1280, 900, 375, 320) for live reads,
horizontal overflow, console errors and failed requests; walks the page with Tab and records the
focus indicator at every stop; runs live quotes (including the real over-cap revert and the sell
direction); and, with an injected mock wallet on chain 1, exercises the add-chain flow, a live swap
simulation for `FUNDED_ACCOUNT` (eth_call only) and a scripted signature rejection. No transaction
is ever broadcast. Results and limitations are recorded in `docs/frontend-validation.md`.

## Behavior notes

- Quotes use `quoteExactInputSingle` through `simulateContract`, never a transaction. When the
  quoted buy would exceed the cap the quoter itself reverts; the page decodes the nested
  `UnexpectedRevertBytes → WrappedError → BlockCapExceeded(used, cap)` payload and shows the numbers.
- A buy whose quoted output is above the cap is blocked (it would revert in any block). A buy above
  the *remaining* allowance of the current block is allowed with a warning, because the next block
  resets the allowance.
- Swaps are exact input with the extreme `sqrtPriceLimitX96`, so they fill completely. The visitor's
  slippage tolerance is enforced by simulating `PoolSwapTest.swap` right before signing and refusing
  to sign if the simulated output is below the minimum; the test router has no on-chain minimum.
- Selling requires `approve(PoolSwapTest, amount)` on BCAP first, shown as its own step.
- On this one-sided launch pool a sell quote currently reverts with the quoter's
  `NotEnoughLiquidity`; the page explains that no liquidity exists in that direction.
