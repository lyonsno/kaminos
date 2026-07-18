#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  createLirmGestaltEnvelopeFromLatentGeneration,
  decodeBinaryPgmMask,
  writeLirmSpeciationArmatureGestaltCompositeWitness,
} from './lirm-speciation-armature-core.js';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(token, '1');
    } else {
      args.set(token, next);
      index += 1;
    }
  }
  return args;
}

function requireArg(args, name) {
  const value = args.get(name);
  if (!value) throw new Error(`missing required argument ${name}`);
  return value;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function resolveSourcePath(root, path) {
  const absoluteRoot = resolve(root);
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(absoluteRoot, path);
  const fromRoot = relative(absoluteRoot, absolutePath);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`latent generation mask escapes the shape-space root: ${path}`);
  }
  return absolutePath;
}

const args = parseArgs(process.argv.slice(2));
const shapeSpaceReceiptPath = resolve(requireArg(args, '--shape-space-receipt'));
const armatureWitnessPath = resolve(requireArg(args, '--armature-witness'));
const manifestPath = resolve(requireArg(args, '--manifest'));
const outDir = resolve(requireArg(args, '--out-dir'));

const [shapeSpaceReceipt, witness, manifest] = await Promise.all([
  readJson(shapeSpaceReceiptPath),
  readJson(armatureWitnessPath),
  readJson(manifestPath),
]);
if (manifest?.schema !== 'kaminos.lirm-speciation-armature-gestalt-composite-manifest.v0') {
  throw new Error('manifest must use kaminos.lirm-speciation-armature-gestalt-composite-manifest.v0');
}
if (!Array.isArray(manifest.compositions) || manifest.compositions.length === 0) {
  throw new Error('manifest requires nonempty compositions');
}

const shapeSpaceRoot = dirname(shapeSpaceReceiptPath);
const compositions = [];
for (const spec of manifest.compositions) {
  const generation = shapeSpaceReceipt.generations?.find(item => item.generationId === spec.generationId);
  if (!generation) throw new Error(`manifest generation not found: ${spec.generationId}`);
  const maskPath = resolveSourcePath(shapeSpaceRoot, generation.maskPath);
  const mask = decodeBinaryPgmMask(await readFile(maskPath));
  const gestaltEnvelope = createLirmGestaltEnvelopeFromLatentGeneration({
    shapeSpaceReceipt,
    generationId: spec.generationId,
    mask,
    pressure: spec.pressure,
    depthRadius: spec.depthRadius,
    roundness: spec.roundness,
    envelopeId: spec.envelopeId,
  });
  compositions.push({ candidateId: spec.candidateId, gestaltEnvelope });
}

const result = await writeLirmSpeciationArmatureGestaltCompositeWitness({
  outDir,
  witness,
  compositions,
});

process.stdout.write(`${JSON.stringify({
  ...result,
  sourceIdentity: {
    shapeSpaceReceipt: shapeSpaceReceiptPath,
    shapeSpaceRoute: shapeSpaceReceipt.routeIdentity,
    armatureWitness: armatureWitnessPath,
    armatureWitnessId: witness.witnessId,
    manifest: manifestPath,
  },
}, null, 2)}\n`);
