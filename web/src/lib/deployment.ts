/**
 * Runtime deployment configuration: loads `imd-deployment.json` (generated from the workflow
 * handoff) and the implementation-derived ABI JSON files it references. Nothing else in the app
 * knows a contract address, chain id, RPC URL or Uniswap address.
 */
import { isAddress, isHex, keccak256, stringToHex, type Abi, type Address } from 'viem';
import { CONTRACT_NAMES, DEPLOYMENT_MANIFEST_PATH } from '../config';

export interface NetworkBlock {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets: string[];
  uniswapV4: {
    poolManager: Address;
    universalRouter: Address;
    quoter: Address;
    stateView: Address;
    positionManager: Address;
    permit2: Address;
  };
}

export interface ManifestContract {
  name: string;
  address: Address;
  abiHash: string;
  abiPath: string;
}

export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: ManifestContract[];
  assets: { path: string; sha256: string }[];
  network: NetworkBlock;
}

export interface LoadedContract extends ManifestContract {
  abi: Abi;
}

export interface Deployment {
  manifest: DeploymentManifest;
  token: LoadedContract;
  hook: LoadedContract;
  /** Every handoff contract, for the explorer link list. */
  contracts: LoadedContract[];
}

const HEX64 = /^[0-9a-f]{64}$/;

function fail(message: string): never {
  throw new Error(`Deployment configuration is invalid: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false; // URL scheme
  return !path.split('/').some((segment) => segment === '..' || segment === '');
}

function validateNetwork(value: unknown): NetworkBlock {
  if (!isRecord(value)) fail('network block missing');
  const { chainId, name, testnet, rpcUrls, explorer, nativeCurrency, faucets, uniswapV4 } = value;
  if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId <= 0) fail('network.chainId');
  if (typeof name !== 'string' || name.length === 0) fail('network.name');
  if (typeof testnet !== 'boolean') fail('network.testnet');
  if (!isStringArray(rpcUrls) || rpcUrls.length === 0) fail('network.rpcUrls');
  if (typeof explorer !== 'string') fail('network.explorer');
  if (
    !isRecord(nativeCurrency) ||
    typeof nativeCurrency.name !== 'string' ||
    typeof nativeCurrency.symbol !== 'string' ||
    typeof nativeCurrency.decimals !== 'number'
  ) {
    fail('network.nativeCurrency');
  }
  if (!isStringArray(faucets)) fail('network.faucets');
  if (!isRecord(uniswapV4)) fail('network.uniswapV4');
  const keys = ['poolManager', 'universalRouter', 'quoter', 'stateView', 'positionManager', 'permit2'] as const;
  for (const key of keys) {
    const address = uniswapV4[key];
    if (typeof address !== 'string' || !isAddress(address, { strict: false })) fail(`network.uniswapV4.${key}`);
  }
  return value as unknown as NetworkBlock;
}

export function validateManifest(value: unknown): DeploymentManifest {
  if (!isRecord(value)) fail('not an object');
  if (value.version !== 1) fail('version must be 1');
  if (typeof value.launchId !== 'string' || value.launchId.length === 0) fail('launchId');
  if (typeof value.chainId !== 'number' || !Number.isInteger(value.chainId)) fail('chainId');
  if (typeof value.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(value.sourceCommit)) fail('sourceCommit');
  if (typeof value.attestationHash !== 'string' || !HEX64.test(value.attestationHash)) fail('attestationHash');
  if (!Array.isArray(value.contracts) || value.contracts.length === 0) fail('contracts');
  for (const contract of value.contracts) {
    if (!isRecord(contract)) fail('contract entry');
    if (typeof contract.name !== 'string' || contract.name.length === 0) fail('contract.name');
    if (typeof contract.address !== 'string' || !isAddress(contract.address, { strict: false })) {
      fail(`contract ${contract.name} address`);
    }
    if (typeof contract.abiHash !== 'string' || !HEX64.test(contract.abiHash)) fail(`contract ${contract.name} abiHash`);
    if (typeof contract.abiPath !== 'string' || !isRelativePath(contract.abiPath)) fail(`contract ${contract.name} abiPath`);
  }
  if (!Array.isArray(value.assets)) fail('assets');
  for (const asset of value.assets) {
    if (!isRecord(asset) || typeof asset.path !== 'string' || !isRelativePath(asset.path)) fail('asset path');
    if (typeof asset.sha256 !== 'string' || !HEX64.test(asset.sha256)) fail(`asset ${asset.path} sha256`);
  }
  const network = validateNetwork(value.network);
  if (network.chainId !== value.chainId) fail('network.chainId differs from chainId');
  return value as unknown as DeploymentManifest;
}

/** Canonical ABI hash used by the handoff: keccak256 of the ABI JSON with sorted keys and no whitespace. */
export function canonicalAbiHash(abi: unknown): string {
  return keccak256(stringToHex(canonicalJson(abi))).slice(2);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function resolveRelative(path: string): string {
  return new URL(path, document.baseURI).toString();
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(resolveRelative(path), { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Unable to load ${path} (HTTP ${response.status})`);
  return response.json();
}

function isAbi(value: unknown): value is Abi {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.type === 'string');
}

export async function loadDeployment(manifestPath: string = DEPLOYMENT_MANIFEST_PATH): Promise<Deployment> {
  const manifest = validateManifest(await fetchJson(manifestPath));
  const contracts: LoadedContract[] = await Promise.all(
    manifest.contracts.map(async (contract) => {
      const abi = await fetchJson(contract.abiPath);
      if (!isAbi(abi)) fail(`${contract.abiPath} is not an ABI array`);
      const hash = canonicalAbiHash(abi);
      if (hash !== contract.abiHash) {
        fail(`ABI hash for ${contract.name} does not match the deployment handoff (${hash} ≠ ${contract.abiHash})`);
      }
      return { ...contract, abi };
    }),
  );
  const token = contracts.find((c) => c.name === CONTRACT_NAMES.token);
  const hook = contracts.find((c) => c.name === CONTRACT_NAMES.hook);
  if (!token) fail(`contract ${CONTRACT_NAMES.token} missing`);
  if (!hook) fail(`contract ${CONTRACT_NAMES.hook} missing`);
  if (!isHex(token.address) || !isHex(hook.address)) fail('address encoding');
  return { manifest, token, hook, contracts };
}
