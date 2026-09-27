// Bounded browser verification (one foreground command): serves dist/ under /preview/ on an ephemeral
// port, drives a Chromium via playwright-core (paths overridable with PLAYWRIGHT_CORE and CHROMIUM_PATH),
// exercises reads, quotes, a mock wallet and reduced motion, and writes docs/validation/browser-report.json.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(repo, 'dist');
const shots = path.join(repo, 'docs', 'validation', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const FUNDED = process.env.FUNDED_ACCOUNT ?? '0x00000000000000000000000000000000000000aa';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/pwmcp/node_modules/playwright-core/index.mjs');

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/preview')) { res.writeHead(404); return res.end('outside /preview'); }
  let rel = url.pathname.replace(/^\/preview\/?/, '');
  if (rel === '') rel = 'index.html';
  const file = path.join(dist, rel);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found ' + rel); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/preview/`;
const report = { base, widths: {}, keyboard: [], interactions: {}, wallet: {}, reducedMotion: {}, problems: [] };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/ms-playwright/chromium-1246/chrome-linux64/chrome', headless: true });

async function openPage(width, height, extra = {}) {
  const context = await browser.newContext({ viewport: { width, height }, ...extra });
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on('requestfailed', (r) => failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  return { context, page, errors, failed };
}

const walletInit = `
  window.__walletRequests = [];
  (() => {
    let chainId = '0x1'; const known = new Set(['0x1']); const listeners = {};
    window.ethereum = {
      isMetaMask: true,
      on(e, l) { (listeners[e] ||= []).push(l); },
      removeListener(e, l) { listeners[e] = (listeners[e] || []).filter((x) => x !== l); },
      async request({ method, params }) {
        window.__walletRequests.push({ method, params });
        switch (method) {
          case 'eth_requestAccounts': case 'eth_accounts': return ['${FUNDED}'];
          case 'eth_chainId': return chainId;
          case 'wallet_switchEthereumChain': {
            const id = params[0].chainId;
            if (!known.has(id)) { const e = new Error('Unrecognized chain ID. Try adding the chain first.'); e.code = 4902; throw e; }
            chainId = id; (listeners.chainChanged || []).forEach((l) => l(id)); return null;
          }
          case 'wallet_addEthereumChain': known.add(params[0].chainId); return null;
          case 'eth_sendTransaction': { const e = new Error('User rejected the request.'); e.code = 4001; throw e; }
          default: throw new Error('mock wallet does not handle ' + method);
        }
      },
    };
  })();
`;

try {
  // 1. Widths: render, wait for live reads, check overflow, screenshot.
  for (const [width, height, name] of [[1280, 900, 'desktop-1280'], [900, 900, 'intermediate-900'], [375, 812, 'mobile-375'], [320, 700, 'mobile-320']]) {
    const { context, page, errors, failed } = await openPage(width, height);
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    let liveReads = true;
    try { await page.getByText('BCAP remaining').waitFor({ timeout: 40_000 }); } catch { liveReads = false; }
    await page.waitForTimeout(1500);
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      h1: getComputedStyle(document.querySelector('h1')).fontSize,
      h2: getComputedStyle(document.querySelector('h2')).fontSize,
      body: getComputedStyle(document.body).fontSize,
      input: getComputedStyle(document.querySelector('input.input')).fontSize,
      statValue: document.querySelector('.stat-value')?.textContent,
      countdown: document.querySelector('.facts dd .num')?.textContent,
      badge: [...document.querySelectorAll('.badge')].map((b) => b.textContent.trim()),
      price: document.querySelector('[aria-labelledby="pool-heading"] dd .num')?.textContent,
      history: document.querySelector('[aria-labelledby="history-heading"] .empty, [aria-labelledby="history-heading"] table')?.tagName,
      minTargets: [...document.querySelectorAll('button, a, input')].map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName, text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((t) => t.h > 0 && t.h < 24),
    }));
    await page.screenshot({ path: path.join(shots, `${name}.jpg`), fullPage: true, type: 'jpeg', quality: 72 });
    report.widths[name] = { liveReads, overflow: metrics.scrollWidth > metrics.innerWidth, ...metrics, consoleIssues: errors, failedRequests: failed };
    await context.close();
  }

  // 2. Keyboard walk and focus indicators at desktop width.
  {
    const { context, page } = await openPage(1280, 900);
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByText('BCAP remaining').waitFor({ timeout: 40_000 });
    for (let i = 0; i < 22; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { tag: 'BODY' };
        const cs = getComputedStyle(el);
        const chip = el.closest('.chip');
        const chipCs = chip ? getComputedStyle(chip) : null;
        return {
          tag: el.tagName, type: el.getAttribute('type'), name: (el.getAttribute('aria-label') || el.textContent || el.id || '').trim().slice(0, 40),
          focusVisible: el.matches(':focus-visible'), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
          chipOutline: chipCs ? `${chipCs.outlineStyle} ${chipCs.outlineWidth} ${chipCs.outlineColor}` : null,
          disabled: el.disabled ?? false,
        };
      });
      report.keyboard.push(info);
      if (i === 0) await page.screenshot({ path: path.join(shots, 'focus-skip-link.jpg'), type: 'jpeg', quality: 72 });
      if (info.tag === 'INPUT' && info.type === 'text' && info.name === '') await page.screenshot({ path: path.join(shots, 'focus-amount-input.jpg'), type: 'jpeg', quality: 72 });
    }
    // Skip link works: focus it and activate.
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByText('BCAP remaining').waitFor({ timeout: 40_000 });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    report.skipLinkTarget = await page.evaluate(() => location.hash + ' / ' + (document.activeElement?.id || document.activeElement?.tagName));
    await context.close();
  }

  // 3. Live quotes without a wallet: normal amount, then an over-cap amount (real quoter revert).
  {
    const { context, page, errors } = await openPage(1280, 900);
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByText('BCAP remaining').waitFor({ timeout: 40_000 });
    const amount = page.getByLabel('Amount in (ETH)');
    await amount.fill('0.01');
    await page.getByText('Expected output').waitFor({ timeout: 40_000 });
    report.interactions.quoteSmall = await page.locator('.quote').innerText();
    report.interactions.actionsSmall = await page.locator('.actions').innerText();
    await amount.fill('1');
    await page.getByText(/Over the cap/).waitFor({ timeout: 40_000 });
    report.interactions.quoteOverCap = await page.locator('.quote').innerText();
    report.interactions.actionsOverCap = await page.locator('.actions').innerText();
    await page.screenshot({ path: path.join(shots, 'swap-over-cap.jpg'), type: 'jpeg', quality: 72, fullPage: false });
    await amount.fill('abc');
    report.interactions.invalidAmount = { ariaInvalid: await amount.getAttribute('aria-invalid'), help: await page.locator('.field-error').innerText() };
    await page.getByLabel('Sell BCAP for ETH').check();
    await page.getByLabel('Amount in (BCAP)').fill('1000');
    await page.locator('.quote').getByText(/Expected output|No liquidity|reverted/).waitFor({ timeout: 40_000 });
    report.interactions.quoteSell = await page.locator('.quote').innerText();
    report.interactions.actionsSell = await page.locator('.actions').innerText();
    await page.screenshot({ path: path.join(shots, 'swap-sell-no-liquidity.jpg'), type: 'jpeg', quality: 72, fullPage: false });
    report.interactions.consoleIssues = errors;
    await context.close();
  }

  // 4. Mock wallet: wrong chain → add chain (4902) → switch → live simulation → scripted rejection.
  {
    const { context, page, errors } = await openPage(1280, 900);
    await context.addInitScript(walletInit);
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByText('BCAP remaining').waitFor({ timeout: 40_000 });
    await page.getByRole('button', { name: 'Connect wallet' }).click();
    await page.getByText('Wrong network').waitFor({ timeout: 10_000 });
    report.wallet.wrongChainHint = await page.locator('.wallet-hint').innerText();
    report.wallet.actionHintWrongChain = await page.locator('.action-hint').innerText();
    await page.screenshot({ path: path.join(shots, 'wallet-wrong-network.jpg'), type: 'jpeg', quality: 72, fullPage: false });
    await page.getByRole('button', { name: 'Switch to Sepolia' }).click();
    await page.locator('.badge', { hasText: 'Sepolia' }).waitFor({ timeout: 10_000 });
    report.wallet.requests = await page.evaluate(() => window.__walletRequests.map((r) => r.method));
    report.wallet.addChainParams = await page.evaluate(() => window.__walletRequests.find((r) => r.method === 'wallet_addEthereumChain')?.params?.[0]);
    const amount = page.getByLabel('Amount in (ETH)');
    await amount.fill('0.001');
    await page.getByText('Expected output').waitFor({ timeout: 40_000 });
    const buy = page.getByRole('button', { name: 'Buy BCAP' });
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Buy BCAP'); return b && !b.disabled; }, null, { timeout: 40_000 }).catch(() => {});
    report.wallet.balanceLine = await page.locator('.field-row .muted').innerText().catch(() => null);
    report.wallet.buyEnabled = await buy.isEnabled();
    report.wallet.actionHint = await page.locator('.action-hint').innerText();
    if (report.wallet.buyEnabled) {
      await buy.click();
      await page.locator('.tx-status').getByText(/not completed|confirmed/).waitFor({ timeout: 60_000 });
      report.wallet.txStatus = await page.locator('.tx-status').innerText();
      report.wallet.sendTransactionParams = await page.evaluate(() => window.__walletRequests.find((r) => r.method === 'eth_sendTransaction')?.params?.[0]);
      await page.screenshot({ path: path.join(shots, 'swap-rejected-after-simulation.jpg'), type: 'jpeg', quality: 72, fullPage: false });
    }
    await page.getByRole('button', { name: 'Disconnect' }).click();
    report.wallet.afterDisconnect = await page.getByRole('button', { name: 'Connect wallet' }).isVisible();
    report.wallet.consoleIssues = errors;
    await context.close();
  }

  // 5. Reduced motion: transitions disabled.
  {
    const { context, page } = await openPage(1280, 900, { reducedMotion: 'reduce' });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByText('BCAP remaining').waitFor({ timeout: 40_000 });
    report.reducedMotion = await page.evaluate(() => ({
      buttonTransition: getComputedStyle(document.querySelector('.button')).transitionDuration,
      chipTransition: getComputedStyle(document.querySelector('.chip')).transitionDuration,
    }));
    await context.close();
    const { context: c2, page: p2 } = await openPage(1280, 900, { reducedMotion: 'no-preference' });
    await p2.goto(base, { waitUntil: 'domcontentloaded' });
    await p2.getByText('BCAP remaining').waitFor({ timeout: 40_000 });
    report.reducedMotion.noPreferenceButtonTransition = await p2.evaluate(() => getComputedStyle(document.querySelector('.button')).transitionDuration);
    await c2.close();
  }
} catch (error) {
  report.problems.push(String(error?.stack || error));
} finally {
  await browser.close();
  server.close();
}
fs.writeFileSync(path.join(repo, 'docs', 'validation', 'browser-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
