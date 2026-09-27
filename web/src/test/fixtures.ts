/**
 * Test fixtures come from the committed static export so the tests exercise the same runtime
 * configuration path (imd-deployment.json + ABI JSON) that the published site uses.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { vi } from 'vitest';
import type { Abi, Address } from 'viem';
import type { DeploymentManifest } from '../lib/deployment';

// vitest runs with web/ as the working directory; the export lives at the repository root.
const distDir = resolve(process.cwd(), '..', 'dist');

export function readDistText(path: string): string {
  return readFileSync(join(distDir, path), 'utf8');
}

export const manifest = JSON.parse(readDistText('imd-deployment.json')) as DeploymentManifest;
export const hookAbi = JSON.parse(readDistText('abi/BlockOutflowCapHook.json')) as Abi;
export const tokenAbi = JSON.parse(readDistText('abi/Blockcap.json')) as Abi;

export const addresses = {
  token: manifest.contracts.find((c) => c.name === 'Blockcap')!.address as Address,
  hook: manifest.contracts.find((c) => c.name === 'BlockOutflowCapHook')!.address as Address,
  quoter: manifest.network.uniswapV4.quoter as Address,
  stateView: manifest.network.uniswapV4.stateView as Address,
};

export function installFetchMock(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      const path = url.pathname.replace(/^\//, '');
      try {
        const text = readDistText(path);
        return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
      } catch {
        return new Response('not found', { status: 404 });
      }
    }),
  );
}
