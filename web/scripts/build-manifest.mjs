#!/usr/bin/env node
// Emits dist/imd-deployment.json after `vite build`:
//  1. takes launchId / chainId / sourceCommit / attestationHash / contracts from the workflow
//     handoff (.imd/reads/deployment.json) and the vetted `network` block (.imd/reads/network.json);
//     when those inputs are absent (after submission), the identity fields of the existing
//     committed manifest are reused so the asset inventory can be regenerated;
//  2. copies each implementation-derived ABI (docs/abi/<Contract>.json) byte for byte into
//     dist/abi/ and checks its canonical keccak hash against the handoff;
//  3. records the SHA-256 of every exported file except the manifest itself.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LIMITS,
  abiSourceDir,
  canonicalAbiHash,
  distDir,
  fileExists,
  handoffPath,
  listDistFiles,
  manifestName,
  manifestPath,
  networkPath,
  readJson,
  repoRoot,
  sha256Hex,
} from './manifest-lib.mjs';

function fail(message) {
  console.error(`build-manifest: ${message}`);
  process.exit(1);
}

if (!fileExists(join(distDir, 'index.html'))) fail('dist/index.html is missing; run `vite build` first.');

let identity;
let network;
if (fileExists(handoffPath)) {
  const handoff = readJson(handoffPath);
  if (handoff.version !== 1) fail(`unsupported handoff version ${handoff.version}`);
  identity = {
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map((c) => ({ name: c.name, address: c.address, abiHash: c.abiHash })),
  };
  if (!fileExists(networkPath)) fail(`network block ${networkPath} is missing; swaps require the vetted network.`);
  network = readJson(networkPath).network;
  if (!network || network.chainId !== handoff.chainId) fail('network.chainId does not match the handoff chainId');
  console.log(`build-manifest: using handoff ${handoffPath} and network ${networkPath}`);
} else if (fileExists(manifestPath)) {
  const previous = readJson(manifestPath);
  identity = {
    launchId: previous.launchId,
    chainId: previous.chainId,
    sourceCommit: previous.sourceCommit,
    attestationHash: previous.attestationHash,
    contracts: previous.contracts.map((c) => ({ name: c.name, address: c.address, abiHash: c.abiHash })),
  };
  network = previous.network;
  console.log(`build-manifest: handoff not present; reusing identity fields from the committed ${manifestName}`);
} else {
  fail(`neither ${handoffPath} nor an existing ${manifestPath} is available.`);
}

// Warn (do not fail) when the ABI exports differ from the pinned source commit.
try {
  for (const c of identity.contracts) {
    const pinned = execFileSync('git', ['show', `${identity.sourceCommit}:docs/abi/${c.name}.json`], { cwd: repoRoot });
    const working = readFileSync(join(abiSourceDir, `${c.name}.json`));
    if (!pinned.equals(working)) fail(`docs/abi/${c.name}.json differs from the pinned source commit ${identity.sourceCommit}`);
  }
  console.log(`build-manifest: ABI exports match source commit ${identity.sourceCommit}`);
} catch (error) {
  if (error && typeof error === 'object' && 'status' in error) {
    console.warn(`build-manifest: could not compare ABIs with git (${error.message.split('\n')[0]}); relying on abiHash only`);
  } else {
    throw error;
  }
}

mkdirSync(join(distDir, 'abi'), { recursive: true });
const contracts = identity.contracts.map((c) => {
  const source = join(abiSourceDir, `${c.name}.json`);
  if (!fileExists(source)) fail(`ABI export ${source} is missing`);
  const abi = readJson(source);
  if (!Array.isArray(abi)) fail(`${source} is not a raw ABI array`);
  const hash = canonicalAbiHash(abi);
  if (hash !== c.abiHash) fail(`ABI hash mismatch for ${c.name}: computed ${hash}, handoff ${c.abiHash}`);
  const abiPath = `abi/${c.name}.json`;
  copyFileSync(source, join(distDir, abiPath));
  return { name: c.name, address: c.address, abiHash: c.abiHash, abiPath };
});

const files = listDistFiles();
if (files.length > LIMITS.maxAssets) fail(`${files.length} exported files exceed the ${LIMITS.maxAssets} asset limit`);
let total = 0;
const assets = files.map((path) => {
  const bytes = readFileSync(join(distDir, path));
  if (bytes.length > LIMITS.maxFileBytes) fail(`${path} is larger than 8 MiB`);
  total += bytes.length;
  return { path, sha256: sha256Hex(bytes) };
});
if (total > LIMITS.softTotalBytes) fail(`export totals ${total} bytes, above the ${LIMITS.softTotalBytes} byte budget`);
if (!assets.some((a) => a.path === 'index.html')) fail('index.html is not in the asset list');

const manifest = {
  version: 1,
  launchId: identity.launchId,
  chainId: identity.chainId,
  sourceCommit: identity.sourceCommit,
  attestationHash: identity.attestationHash,
  contracts,
  assets,
  network,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`build-manifest: wrote ${manifestPath} with ${assets.length} assets (${total} bytes) and ${contracts.length} contracts`);
