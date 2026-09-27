# Design: Blockcap launch pool page

Extracted from the final source in `web/src/` (tokens and components in `web/src/styles.css`,
markup in `web/src/components/*.tsx`) and confirmed in the browser run recorded in
`docs/frontend-validation.md`. This file lives in `docs/` because the frontend assignment's write
scope does not include the repository root.

## Overview

Audience: people trading a freshly launched test-network token who need to know, before they sign,
how much the hook still allows in the current block. The character is a calm, light, data-first
utility: white cards on a cool gray page, one blue accent reserved for interactive elements and the
single primary action per card, tabular numbers everywhere a value changes. Hierarchy comes from
size and weight, grouping from space inside cards and a hairline only where rows repeat.

System-wide rules: cards as the only surface type, one accent, sentence case, verb-first buttons,
every reason for a disabled action written next to it. Page-specific arrangement (Allowance and
Pool on the left, Swap on the right, history and contracts full width) is not a rule for other pages.

## Colors

Two tiers in `:root` of `web/src/styles.css`. Components reference semantic tokens only.

Primitives: cool neutral ramp `--neutral-50 #f7f8fa`, `100 #eef0f4`, `200 #dfe3ea`, `300 #c6ccd6`,
`400 #98a1b0`, `500 #7b8698`, `600 #5b6577`, `700 #414a5a`, `900 #171c26`; accent `--blue-100
#e3ecfb`, `500 #2b5fd9`, `600 #2450b8`, `700 #1d4197`; status `--green-100/300/800`,
`--amber-100/300/800`, `--red-100/300/700`.

| Semantic token | Value | Job |
| --- | --- | --- |
| `--color-bg-page` | neutral-50 | page background |
| `--color-bg-surface` | `#ffffff` | cards, inputs, header |
| `--color-bg-sunken` | neutral-100 | quote panel, empty state, address chip, progress track |
| `--color-bg-surface-hover` | neutral-100 | secondary button hover |
| `--color-text-primary` / `-secondary` | neutral-900 / neutral-600 | body / captions, labels, hints |
| `--color-text-on-accent` | `#ffffff` | text on the primary button |
| `--color-border-subtle` / `--color-border` / `--color-border-strong` | neutral-200 / 300 / 400 | separators / badge outline / reserved |
| `--color-border-interactive` | neutral-500 | boundary of inputs, secondary buttons, chips (≥ 3:1) |
| `--color-focus-ring` | blue-500 | `:focus-visible` outline |
| `--color-accent-solid` / `-hover` / `-text` / `-bg-subtle` | blue-500 / 600 / 700 / 100 | primary button, its hover, links, selected chip |
| `--color-success-*`, `--color-warning-*`, `--color-danger-*` (`bg`, `border`, `text`) | green / amber / red ramps | badges and notices: cap active / connected; wrong network / over remaining; errors / over cap |

Measured WCAG ratios for these pairs are in the validation record. Light appearance only; there
is no dark theme and no theme switch.

## Typography

Font: `--font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
sans-serif`; no web font files. Smoothing set once on `html`.

| Role | Token | Size | Weight | Line-height | Use |
| --- | --- | --- | --- | --- | --- |
| Display | `--text-display` | 2.25 rem | 600, `letter-spacing -0.02em` | 1.1 | `.stat-value`, the remaining allowance |
| Title | `--text-title` | 1.5 rem | 600, `-0.01em` | 1.2 | `h1` |
| Heading | `--text-heading` | 1.125 rem | 600 | 1.2 | `h2` card titles |
| Body | `--text-body` | 1 rem | 400 (labels 500) | 1.5 | paragraphs, inputs, buttons |
| Caption | `--text-caption` | 0.8125 rem | 400 | 1.45 | `.small`, `dt`, badges, table, hints |

Rules: headings `text-wrap: balance`, paragraphs `text-wrap: pretty`; `.num` applies
`font-variant-numeric: tabular-nums` to every changing or aligned value; links use
`text-underline-offset: 3px` and `text-decoration-thickness: from-font`; hashes and addresses use
`overflow-wrap: anywhere`; inputs never render below 16 px (`font-size: max(1rem, var(--text-body))`);
identifiers carry `translate="no"`. No `text-transform`.

## Layout

Spacing steps `--space-1..8` (0.25, 0.5, 0.75, 1, 1.5, 2 rem). Content width `max-width: 72rem` with
`padding-inline: var(--space-4)` on `.page-header-inner`, `.page`, `.page-footer`. Vertical rhythm:
`.page` and `.column` stack cards with `gap: var(--space-6)`; inside a card `gap: var(--space-4)`;
inside a group (`.facts`, `.field`) `var(--space-3)` / `var(--space-2)`, keeping the 2× rule between
group and intra-group spacing.

Breakpoints come from the content and are written in rem:

- `≥ 56rem`: `.grid` becomes two equal columns (`minmax(0, 1fr)` each) so long values cannot widen a column.
- `≥ 48rem`: `.contract-list li` becomes a name/note + link grid (`10rem 1fr`).
- `≤ 40rem`: wallet control aligns to the start instead of the end.
- Always: `.facts-grid` uses `repeat(auto-fit, minmax(14rem, 1fr))`; tables sit in `.table-wrap`
  with `overflow-x: auto`; nothing has a fixed width except the short slippage input (`7rem`).

Verified in the browser at 1280, 900, 375 and 320 px with no horizontal overflow. Logical
properties (`inset-inline-start`, `padding-inline`, `text-align: start/end`) are used throughout;
RTL was not rendered.

## Elevation & depth

Flat, one level. Cards use a shadow-as-border: `--shadow-surface: 0 0 0 1px rgb(0 0 0 / 0.06),
0 1px 2px -1px rgb(0 0 0 / 0.06), 0 2px 4px 0 rgb(0 0 0 / 0.04)`. Structure borders stay borders:
header bottom, table row separators and contract-list separators use `--color-border-subtle`;
controls use `--color-border-interactive`. No overlays, no stacking contexts beyond the skip link.

## Shapes

`--radius-control: 8px` for buttons, inputs, chips, notices, quote panel, empty state, address chip;
`--radius-card: 16px` for cards; `999px` pills for badges and the progress meter. Card padding is
24 px, above the 24 px threshold where nested radii are chosen independently, so controls inside
cards keep 8 px.

## Components

All are plain JSX with class names; there is no component library export.

- **Button** (`.button`, `web/src/styles.css`): 44 px min height, `padding-inline 1rem`, weight 500,
  `touch-action: manipulation`. Variants `.button-primary` (accent fill, white text; one per card)
  and `.button-secondary` (white, interactive border). Disabled: `opacity .55`, `cursor: not-allowed`,
  reason written in the adjacent `.action-hint`. Busy label swaps ("Checking…", "Confirm in wallet…",
  "Swapping…") instead of a bare spinner. `.link-button` is an inline text action ("Use max").
- **Input** (`.input`): 44 px, 16 px text, `inputmode="decimal"`, `aria-invalid` + `aria-describedby`
  pointing at `.field-error`; `.input-short` for the slippage field; labels via `label for`.
- **Direction chips** (`.chip`, `SwapForm.tsx`): native radios wrapped in labels inside a
  `fieldset` with `legend`; `.chip-selected` uses the accent subtle background and text; the focus
  ring is drawn on the chip through `.chip:has(input:focus-visible)`.
- **Card** (`.card`, `.card-header`): `section[aria-labelledby]` with an `h2` and an optional
  trailing `.badge` or status text.
- **Badge** (`.badge`, `-success`, `-warning`, neutral default): pill with an icon glyph plus text
  so state is never color-only ("● Sepolia", "▲ Wrong network", "Cap active").
- **Notice** (`.notice`, `-danger`, `-warning`, `-success`, neutral): inline message block; danger
  notices inside forms use `role="alert"` only for read failures, otherwise they sit in a stable
  `role="status"` region.
- **Facts** (`.facts`, `.facts-grid`): `dl` of caption `dt` over body `dd`.
- **Stat** (`.stat`, `.stat-value`, `.stat-unit`, `.cap-meter`): display number, unit, and a native
  `progress` for share of cap.
- **Table** (`.table-wrap > .table`): caption (visually hidden), `th scope="col"`, numeric columns
  right-aligned via `.num-col`, hairline rows.
- **Empty state** (`.empty`): sunken block with a bold lead and a forward-pointing sentence.
- **Wallet control** (`WalletControl.tsx`): connect buttons per discovered wallet, connected state
  with badge, address link, optional "Switch to <network>" primary action and Disconnect; errors in a
  stable `role="status"` paragraph.
- **Skip link** (`.skip-link`): first focusable element, visible on focus, targets `main[tabindex=-1]`.

## Do's and Don'ts

- Start a new page from `.page` with `.card` sections and `h2` headings; keep one `h1` in the header.
- Use semantic tokens only; add a token for a new role instead of reusing a border as text.
- One `.button-primary` per card; every other action is `.button-secondary` or `.link-button`.
- Put the reason for any disabled action in visible text next to it; never rely on a tooltip.
- Give every changing number `.num` and format amounts with `formatAmount` from `web/src/lib/format.ts`.
- Show status with a badge or notice that carries text, never color alone.
- Keep motion to the existing 100 ms color transitions inside the `prefers-reduced-motion:
  no-preference` block; do not add keyframe entrances.
- Do not hard-code chain, address, RPC or ABI data; read it from the runtime manifest.
- Don't add a dark theme or a second accent hue without extending the token tiers and re-measuring
  every pair.

Recipe for one more page: copy `index.html`, mount a component that returns `<header
className="page-header">…</header><main id="main" className="page" tabIndex={-1}>` with `.card`
sections, import `styles.css`, and reuse `formatAmount`, `explorerAddressUrl` and the deployment
loader from `web/src/lib/`.
