#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAuthoredRigSourceMeshIdentity,
  extractAuthoredRigHierarchy,
} from '../authored-rig-hierarchy-core.mjs';
import { parseGlbNodeGeometries } from '../bone-containment-probe-core.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function options(name) {
  return process.argv.flatMap((value, index) => (
    value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []
  ));
}

function unmatchedAdmission(value) {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error('--admit-unmatched requires NAME=RATIONALE');
  }
  return { nodeName: value.slice(0, separator), rationale: value.slice(separator + 1) };
}

const hierarchyPath = resolve(option('--source') ?? (() => { throw new Error('--source GLB is required'); })());
const skeletonPath = resolve(repoRoot, option('--skeleton', 'artifacts/cast-correspondence-v0/frozen/skeleton-authored.glb'));
const outputPath = resolve(repoRoot, option('--output', 'artifacts/cast-correspondence-v0/frozen/cat-bauplan-authored-hierarchy.receipt.json'));
const sourceMeshIdentityPath = resolve(repoRoot, option(
  '--source-mesh-identity-output',
  'artifacts/cast-correspondence-v0/frozen/cat-bauplan-authored-hierarchy.source-mesh-identity.json',
));
const [hierarchyBytes, skeletonBytes] = await Promise.all([
  readFile(hierarchyPath),
  readFile(skeletonPath),
]);
const receipt = extractAuthoredRigHierarchy({
  hierarchyBytes,
  hierarchyLabel: option('--source-label', hierarchyPath),
  skeletonBytes,
  bones: parseGlbNodeGeometries(skeletonBytes),
  unmatchedAdmissions: options('--admit-unmatched').map(unmatchedAdmission),
});
const sourceMeshIdentity = createAuthoredRigSourceMeshIdentity(receipt);
await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(sourceMeshIdentityPath), { recursive: true });
await Promise.all([
  writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`),
  writeFile(sourceMeshIdentityPath, `${JSON.stringify(sourceMeshIdentity, null, 2)}\n`),
]);
process.stdout.write(`${JSON.stringify({
  status: 'written',
  outputPath,
  sourceMeshIdentityPath,
  receiptSha256: receipt.receiptSha256,
  sourceMeshIdentitySha256: sourceMeshIdentity.identitySha256,
  sourceSha256: receipt.source.hierarchySha256,
  effectiveRoot: receipt.effectiveRoot,
  controls: receipt.controls.map(control => control.name),
  unmatchedMeshNodes: receipt.unmatchedMeshNodes,
  unmatchedMeshPolicy: receipt.unmatchedMeshPolicy,
})}\n`);
