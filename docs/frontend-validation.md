# Frontend validation record

Worker validation for the Blockcap launch pool page (source `web/`, export `dist/`). This is the
worker's own report; it is not an independent network certification. Publication checks (CID,
named entrypoint, asset hashes, ABI binding, RPC chain id and contract code) run later and are not
claimed here.

## 1. Scope and assumptions

- **Reviewed surface:** the single page in `dist/index.html`: header with wallet control, Allowance
  this block (with countdown), Pool, Swap, Outflow history, Contracts, footer. States: no wallet,
  wrong chain, connected, quote loading/ready/over-remaining/over-cap/reverted, invalid amount,
  insufficient balance, approval step, simulating/signing/pending/confirmed/failed/rejected,
  cap active/ended/not initialized, history empty/rows, manifest load error.
- **Export location:** `dist/` (relative base `./`), inspected served under a `/preview/` subpath.
- **Swap router:** the approved workflow and this assignment name `PoolSwapTest`
  (0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe) as the swap route, so swaps use it. Quotes use the
  network block's V4Quoter and prices its StateView. The generic criterion "every swap, quote and
  approval uses the network's Uniswap addresses" is therefore met for quotes and prices, while the
  swap itself and the sell approval target the workflow's router. The universal router path was not
  implemented to avoid a second, untested execution route.
- **Exact input only.** Exact-output buys through PoolSwapTest would leave surplus ETH in the router
  on older deployments, so the form only offers exact input with the extreme price limit and checks
  the visitor's minimum output in a pre-sign simulation (the router has no on-chain minimum).
- **`DESIGN.md` location:** the acceptance criteria name the repository root, but this assignment's
  write scope is `web/**`, `dist/**`, `docs/**`. The document is therefore delivered at
  `docs/DESIGN.md`; the root location was not written.
- **Scan start:** `OUTFLOW_SCAN_FROM_BLOCK` (11794805, the deployment block) is a source constant
  because the runtime manifest schema carries no block numbers.
- **No dark theme, no localization, no dialogs, no animations beyond 100 ms color transitions.**
  Absent features are marked Not applicable below rather than added for the checklist.

## 2. Better Interface coverage

| Domain | Status | Inspected | Not performed |
| --- | --- | --- | --- |
| Accessibility | Checked | Native elements only (`button`, `a`, `input`, `fieldset`/`legend`, `label for`, `progress`, `table` with caption); skip link → `main` (focus lands on `main`, verified); Tab walk of 22 stops with a visible 2 px ring at every stop (chips light up via `:has(input:focus-visible)`); `aria-invalid` + `aria-describedby` on the amount field; stable `role="status"` regions for quote, transaction status and wallet errors; `role="alert"` only for read failures; `prefers-reduced-motion` verified (transition 0 s under reduce, 0.1 s otherwise); 44 px controls and inputs, 16 px input text; viewport meta without zoom cap | Screen-reader session; forced-colors mode; browser-native 200 % zoom (reflow at 320 px done instead); automated axe-style scan |
| Layout | Checked | Widths 1280, 900, 375, 320: no horizontal overflow, live content; two columns from 56 rem, single column below; logical properties (`inset-inline-start`, `padding-inline`, `text-align: start/end`); grouping by space inside cards, one hairline separator style in table and contract list; primary action first in each card | RTL mirror (no RTL content); container queries not used |
| Writing | Checked (source) | Sentence case throughout; verb-first buttons (Connect wallet, Switch to Sepolia, Approve BCAP, Buy BCAP, Sell BCAP, Disconnect, Use max); errors state the fix beside the field; empty state points forward; links describe destinations; one vocabulary ("cap", "allowance", "block") | — |
| Typography | Checked | Role scale 13/16/18/24/36 px, headings 24 → 18 descending (computed), body 16 px, line-height 1.5 body / 1.1–1.2 headings, `tabular-nums` on every changing value, `text-wrap: balance` on headings and `pretty` on paragraphs, `overflow-wrap: anywhere` on hashes/addresses, system font stack, smoothing on root | Rendering with a non-system fallback font; widows at other content lengths |
| Colors | Checked | Two-tier tokens (primitives by hue, semantics by role) in `web/src/styles.css`; one accent, one neutral, three status ramps that all render; WCAG ratios computed for every declared pair (table below) and the failing control-border pair fixed | Rendered measurement of alpha shadows over content (shadows are decorative); APCA values |
| UI | Checked | Shadow-as-border surfaces, concentric radii (16 px card, 8 px controls, 24 px padding treated as separate surfaces), interactive states via CSS only, transitions limited to `background-color, border-color` at 100 ms ease-out and opt-in under `prefers-reduced-motion: no-preference`, no icons except the inline favicon | Hover states viewed in the browser; motion replay at 10 % speed (nothing animates beyond color) |

Measured contrast (WCAG 2, from the token values; `node web/scripts/contrast.mjs` reproduces the table):

| Pair | Ratio |
| --- | --- |
| Primary text `#171c26` on surface `#ffffff` / page `#f7f8fa` | 17.07 / 16.06 |
| Secondary text `#5b6577` on surface / sunken `#eef0f4` | 5.88 / 5.15 |
| Link text `#1d4197` on surface / sunken / selected chip `#e3ecfb` | 9.31 / 8.16 / 7.83 |
| White on accent solid `#2b5fd9` / hover `#2450b8` | 5.61 / 7.21 |
| Success `#1a5a33` on `#e2f5e8`; warning `#6b4a00` on `#fff3d6`; danger `#a12222` on `#fde8e8` and on white | 7.23; 7.31; 6.46 and 7.59 |
| Focus ring `#2b5fd9` on surface / page / sunken | 5.61 / 5.28 / 4.92 |
| Interactive border `#7b8698` on surface / sunken (after fix) | 3.68 / 3.23 |
| Decorative border `#c6ccd6` and separator `#dfe3ea` on surface (non-control) | 1.61 / 1.29 |
| Disabled primary button (exempt) | ≈ 2.43 |

## 3. Findings and fixes

| # | Severity | Location | Evidence | Fix | Recheck |
| --- | --- | --- | --- | --- | --- |
| 1 | MEDIUM | `web/src/styles.css` `.input`, `.button-secondary`, `.chip` | Control boundary `#c6ccd6` on white measured 1.61:1, below the 3:1 non-text minimum | Added `--color-border-interactive` (`#7b8698`, 3.68:1 on white, 3.23:1 on the sunken quote panel) for inputs, secondary buttons and chips; badges keep the lighter border | Re-measured; rebuilt |
| 2 | MEDIUM | `web/src/lib/errors.ts` `describeDecoded` | Live sell quote reverted with the quoter's `NotEnoughLiquidity(poolId)` and the page showed the raw error name | Plain-language message: no liquidity in this direction at the current price | Browser run: `quoteSell` shows the new text; unit test added |
| 3 | LOW | `web/src/App.tsx` `<main>` | Skip link moved the sequential focus point but `document.activeElement` stayed `body` | `tabIndex={-1}` on `main` | Browser run: `skipLinkTarget = "#main / main"` |
| 4 | LOW | `web/index.html` | Chromium requested `/favicon.ico` and logged a 404 (would also 404 on static hosting) | Inline SVG data-URL icon | Console clean at all four widths |
| 5 | Applied while building | `SwapForm.tsx` | Guide rules: reasons for disabled actions in visible text beside the button; submit disabled only while chain/eligibility prerequisites fail (contract-safety rule); wallet rejection reported without blame; over-cap message carries the decoded numbers | — | Covered by tests and the browser run |

No HIGH findings. Remaining low-cost polish deliberately not done: a copy-address button (the
explorer link already exposes the address) and per-block grouping headers in the history table
(rows already carry the block number and the block's running total).

## 4. Verification

All commands run from `web/` on the worker, 2026-09-27.

| Command | Outcome |
| --- | --- |
| `npm install` (network allowed) | 0 vulnerabilities; lockfile `web/package-lock.json` committed, `node_modules` ignored |
| `npm run typecheck` (`tsc -p tsconfig.json`, `tsc -p tsconfig.node.json`) | exit 0, no errors |
| `npm test` (`vitest run`) | 2 files, 28 tests passed |
| `npm run build` (`vite build` + `scripts/build-manifest.mjs`) | 6 assets, 588 616 bytes; ABI hashes match the handoff; `docs/abi` matches source commit 04624f0c… |
| `npm run verify:manifest` | OK (6 assets, 2 contracts); compared against `.imd/reads/deployment.json` and `network.json` |
| `FUNDED_ACCOUNT=0x09EC…4a60 node scripts/browser-check.mjs` | `problems: []`; report at `docs/validation/browser-report.json` |

Live Sepolia reads made during validation with `cast` (block 11794818 → 11794985):
`status(poolId)` = active, 2 500 000 BCAP remaining, `capEndsAt` 1790616252; `CAP()` = 2.5e24;
StateView `getSlot0` sqrtPrice 560227709747861399187319382274582 (tick 177284), liquidity 0 at
the current tick; V4Quoter for 0.01 ETH = 495 993.9357 BCAP; V4Quoter for 1 ETH reverted with the
nested `BlockCapExceeded(46 731 075.24…, 2 500 000)` payload; `PoolSwapTest.swap` simulated for
0.01 ETH returned a BalanceDelta of −0.01 ETH / +495 993.9357 BCAP and for 1 ETH reverted with the
same wrapped error. Public RPC `eth_getLogs` range limits observed: 50 000 (publicnode),
30 000 (ethpandaops), unlimited (sentio); the page scans in 5 000-block chunks.

Browser run (headless Chromium 154 via playwright-core, export served at `/preview/`):

- Widths 1280 × 900, 900 × 900, 375 × 812, 320 × 700: live reads within the timeout, `scrollWidth ==
  innerWidth` (no overflow), no console errors or warnings, no failed requests. Screenshots:
  `docs/validation/screenshots/desktop-1280.jpg`, `intermediate-900.jpg`, `mobile-375.jpg`,
  `mobile-320.jpg`.
- Keyboard: Tab order skip link → block link → direction radio → amount → slippage → six contract
  links → wraps; every stop reports `:focus-visible` with `solid 2px rgb(43, 95, 217)` (the radio's
  ring is drawn on its chip). `focus-skip-link.jpg`, `focus-amount-input.jpg`.
- Live quotes without a wallet: 0.01 ETH → expected 495 993.9357 BCAP, minimum 491 033.9964 at 1 %,
  rate 1 ETH ≈ 49 599 393.57 BCAP, share of cap 19.8 %; 1 ETH → over-cap message with the decoded
  block total (`swap-over-cap.jpg`); `abc` → `aria-invalid="true"` with the inline hint; sell 1000
  BCAP → no-liquidity message (`swap-sell-no-liquidity.jpg`).
- Mock wallet (injected via init script, chain 1, knows only chain 1, rejects signing): Connect →
  "Wrong network" badge and hint (`wallet-wrong-network.jpg`) → Switch to Sepolia → request sequence
  `wallet_switchEthereumChain` (4902) → `wallet_addEthereumChain` with exactly the network block's
  chainId `0xaa36a7`, name, three RPC URLs, native currency and explorer → `wallet_switchEthereumChain`
  → Sepolia badge. Then 0.001 ETH buy for the funded deployer address: balance 0.9099 ETH read live,
  quote 49 627.0851 BCAP, Buy enabled, click → live `eth_call` simulation of `PoolSwapTest.swap`
  passed → `eth_sendTransaction` reached the wallet with `to` = PoolSwapTest, `value` = 0.001 ETH,
  selector `0x2229d0b4` → scripted 4001 → "Swap not completed: Request rejected in the wallet. Nothing
  was sent." (`swap-rejected-after-simulation.jpg`, status text is below the fold in that capture and
  recorded in the report). Disconnect returns to Connect wallet.
- Reduced motion: `.button` and `.chip` transition-duration `0s` under `reduce`, `0.1s` otherwise.

## 5. Untested live-chain behavior and limitations

- **No transaction was broadcast.** Real buys, sells and approvals (gas, receipt handling, the
  received-amount read after mining, `Outflow` rows appearing for a real buy) are covered only by the
  mocked JSON-RPC node in the Vitest suite. The chain had no `Outflow` events during validation, so
  the history table with real data was not observed.
- The deployed `PoolSwapTest` bytecode was not verified to refund surplus ETH; the form never sends
  surplus (exact input, full fill), so this only matters for an unexpected partial fill.
- Real wallet extensions (MetaMask, Rabby, …) were not driven; the EIP-1193 surface was mocked in
  Vitest and in the browser run. WalletConnect is not configured.
- Not performed: screen-reader session, forced-colors mode, native 200 % zoom, hover-state
  screenshots, physical-device touch, RTL. Emulated widths are not physical devices.
- Time left in the cap window is estimated from the last block timestamp plus elapsed local time;
  it can drift by one block interval between polls.

## 6. Completion

**Complete for the stated scope.** Build, typecheck, 28 mocked interaction tests, manifest
verification and the browser pass at four widths all passed on the final export; the two MEDIUM
findings were fixed and rechecked. Limitations are the untested real-transaction paths and the
manual accessibility checks listed above, plus `DESIGN.md` living in `docs/` instead of the
repository root because of the assignment's write scope.
