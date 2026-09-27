// Shared helpers for building and verifying dist/imd-deployment.json.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, stringToHex } from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
export const webRoot = resolve(here, '..');
export const repoRoot = resolve(webRoot, '..');
export const distDir = resolve(repoRoot, 'dist');
export const manifestName = 'imd-deployment.json';
export const manifestPath = join(distDir, manifestName);

export const handoffPath = process.env.IMD_DEPLOYMENT ?? join(repoRoot, '.imd', 'reads', 'deployment.json');
export const networkPath = process.env.IMD_NETWORK ?? join(repoRoot, '.imd', 'reads', 'network.json');
export const abiSourceDir = process.env.IMD_ABI_DIR ?? join(repoRoot, 'docs', 'abi');

export const LIMITS = {
  maxAssets: 128,
  maxFileBytes: 8 * 1024 * 1024,
  /** Keep the export well under half of the checker's 64 MiB budget. */
  softTotalBytes: 24 * 1024 * 1024,
};

/** @param {unknown} value */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = /** @type {Record<string, unknown>} */ (value);
    return `{${Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** keccak256 of the ABI JSON with sorted keys and no whitespace, as 64 lowercase hex chars. */
export function canonicalAbiHash(abi) {
  return keccak256(stringToHex(canonicalJson(abi))).slice(2);
}

/** @param {string} path */
export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** @param {Buffer} bytes */
export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Recursively list files under dist (posix-style relative paths), excluding the manifest. */
export function listDistFiles() {
  /** @type {string[]} */
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const rel = relative(distDir, full).split(sep).join('/');
        if (rel !== manifestName) out.push(rel);
      }
    }
  };
  walk(distDir);
  return out.sort();
}

export function fileExists(path) {
  return existsSync(path) && statSync(path).isFile();
}

/** Deep structural equality for plain JSON values. */
export function jsonEqual(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}
