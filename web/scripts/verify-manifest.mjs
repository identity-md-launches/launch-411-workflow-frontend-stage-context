#!/usr/bin/env node
// Verifies the committed export against dist/imd-deployment.json and, when the workflow inputs
// are present, against the handoff and the vetted network block. Exits non-zero on any mismatch.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LIMITS,
  canonicalAbiHash,
  distDir,
  fileExists,
  handoffPath,
  jsonEqual,
  listDistFiles,
  manifestPath,
  networkPath,
  readJson,
  sha256Hex,
} from './manifest-lib.mjs';

const problems = [];
const note = (m) => problems.push(m);
const HEX64 = /^[0-9a-f]{64}$/;
const relativePath = (p) =>
  typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(p) && !p.split('/').includes('..');

if (!fileExists(manifestPath)) {
  console.error(`verify-manifest: ${manifestPath} is missing`);
  process.exit(1);
}
const manifest = readJson(manifestPath);

// Schema
const keys = Object.keys(manifest);
const expectedKeys = ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash', 'contracts', 'assets', 'network'];
if (keys.join(',') !== expectedKeys.join(',')) note(`unexpected key set/order: ${keys.join(',')}`);
if (manifest.version !== 1) note('version must be 1');
if (typeof manifest.launchId !== 'string') note('launchId');
if (!Number.isInteger(manifest.chainId)) note('chainId');
if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit ?? '')) note('sourceCommit');
if (!HEX64.test(manifest.attestationHash ?? '')) note('attestationHash');
if (!Array.isArray(manifest.contracts) || manifest.contracts.length === 0) note('contracts');
if (!Array.isArray(manifest.assets)) note('assets');
if (typeof manifest.network !== 'object' || manifest.network === null) note('network');
else if (manifest.network.chainId !== manifest.chainId) note('network.chainId differs from chainId');

// Assets: every listed file exists with the right hash; every exported file is listed.
const listed = new Map();
for (const asset of manifest.assets ?? []) {
  if (!relativePath(asset.path)) note(`asset path not relative: ${asset.path}`);
  if (!HEX64.test(asset.sha256 ?? '')) note(`asset hash not lowercase hex: ${asset.path}`);
  if (listed.has(asset.path)) note(`asset listed twice: ${asset.path}`);
  listed.set(asset.path, asset.sha256);
  const full = join(distDir, asset.path);
  if (!fileExists(full)) {
    note(`listed asset missing: ${asset.path}`);
    continue;
  }
  const bytes = readFileSync(full);
  if (bytes.length > LIMITS.maxFileBytes) note(`asset over 8 MiB: ${asset.path}`);
  if (sha256Hex(bytes) !== asset.sha256) note(`sha256 mismatch: ${asset.path}`);
}
if (listed.has('imd-deployment.json')) note('manifest lists itself');
if (!listed.has('index.html')) note('index.html not listed');
for (const file of listDistFiles()) if (!listed.has(file)) note(`exported file not listed: ${file}`);
if (listed.size > LIMITS.maxAssets) note(`more than ${LIMITS.maxAssets} assets`);

// Contracts: ABI files present, listed, and hash-bound.
for (const c of manifest.contracts ?? []) {
  if (!relativePath(c.abiPath)) note(`abiPath not relative: ${c.name}`);
  if (!listed.has(c.abiPath)) note(`ABI not in asset list: ${c.abiPath}`);
  const full = join(distDir, c.abiPath);
  if (!fileExists(full)) {
    note(`ABI missing: ${c.abiPath}`);
    continue;
  }
  const abi = readJson(full);
  if (!Array.isArray(abi)) note(`ABI is not a raw array: ${c.abiPath}`);
  const hash = canonicalAbiHash(abi);
  if (hash !== c.abiHash) note(`ABI hash mismatch for ${c.name}: ${hash} vs ${c.abiHash}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(c.address ?? '')) note(`address malformed: ${c.name}`);
}

// Against the workflow inputs, when present.
if (fileExists(handoffPath)) {
  const handoff = readJson(handoffPath);
  for (const field of ['launchId', 'chainId', 'sourceCommit', 'attestationHash']) {
    if (manifest[field] !== handoff[field]) note(`${field} differs from the handoff`);
  }
  const expected = handoff.contracts.map((c) => ({ name: c.name, address: c.address, abiHash: c.abiHash }));
  const actual = (manifest.contracts ?? []).map((c) => ({ name: c.name, address: c.address, abiHash: c.abiHash }));
  if (!jsonEqual(expected, actual)) note('contract set differs from the handoff');
  console.log('verify-manifest: compared against the workflow handoff');
} else {
  console.log('verify-manifest: handoff not present; skipped handoff comparison');
}
if (fileExists(networkPath)) {
  const { network } = readJson(networkPath);
  if (!jsonEqual(network, manifest.network)) note('network block differs from network.json');
  console.log('verify-manifest: compared network block with network.json');
} else {
  console.log('verify-manifest: network.json not present; skipped network comparison');
}

if (problems.length > 0) {
  console.error(`verify-manifest: ${problems.length} problem(s)`);
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log(`verify-manifest: OK (${listed.size} assets, ${manifest.contracts.length} contracts)`);
