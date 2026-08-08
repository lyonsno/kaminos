#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { buildK4EnvelopeFrameBinding } from '../k4-envelope-frame-binding-core.mjs';

const FAILURE_SCHEMA = 'kaminos.k4-envelope-frame-binding-failure.v0';

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`argument-parse: malformed argument ${key ?? ''}`);
    values.set(key, value);
  }
  const required = [
    '--source-extraction',
    '--skeleton-glb',
    '--envelope-glb',
    '--skeleton-envelope-frame-link',
    '--parent-atlas',
    '--expected-parent-atlas-file-sha256',
    '--baseline-result',
    '--requested-constructions',
    '--out',
    '--failure',
  ];
  for (const key of required) if (!values.has(key)) throw new Error(`argument-parse: missing ${key}`);
  const requestedConstructionIds = values.get('--requested-constructions').split(',').map(value => value.trim()).filter(Boolean);
  return {
    sourceExtraction: resolve(values.get('--source-extraction')),
    skeletonGlb: resolve(values.get('--skeleton-glb')),
    envelopeGlb: resolve(values.get('--envelope-glb')),
    skeletonEnvelopeFrameLink: resolve(values.get('--skeleton-envelope-frame-link')),
    parentAtlas: resolve(values.get('--parent-atlas')),
    expectedParentAtlasFileSha256: values.get('--expected-parent-atlas-file-sha256'),
    baselineResult: resolve(values.get('--baseline-result')),
    requestedConstructionIds,
    out: resolve(values.get('--out')),
    failure: resolve(values.get('--failure')),
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readJson(path, phase) {
  const bytes = await readFile(path);
  try {
    return { bytes, value: JSON.parse(bytes) };
  } catch (error) {
    throw new Error(`${phase}: ${error.message}`);
  }
}

function parseGlbJson(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('skeleton-glb-parse: not a GLB container');
  }
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) {
      try {
        return JSON.parse(chunk.toString('utf8'));
      } catch (error) {
        throw new Error(`skeleton-glb-parse: ${error.message}`);
      }
    }
    offset += 8 + length;
  }
  throw new Error('skeleton-glb-parse: missing JSON chunk');
}

let args;
let phase = 'argument-parse';
const lastTrustworthyEvidence = {};
let source = null;

try {
  args = parseArgs(process.argv.slice(2));
  phase = 'source-extraction-read';
  const extractionInput = await readJson(args.sourceExtraction, phase);
  const sourceExtraction = extractionInput.value;
  source = sourceExtraction.source ?? null;
  lastTrustworthyEvidence.sourceExtractionRead = true;
  lastTrustworthyEvidence.sourceExtractionFileSha256 = sha256(extractionInput.bytes);

  phase = 'parent-atlas-read';
  const parentInput = await readJson(args.parentAtlas, phase);
  const parentAtlas = parentInput.value;
  const parentAtlasFileSha256 = sha256(parentInput.bytes);
  lastTrustworthyEvidence.parentAtlasRead = true;
  lastTrustworthyEvidence.parentAtlasFileSha256 = parentAtlasFileSha256;

  phase = 'parent-atlas-hash';
  if (parentAtlasFileSha256 !== args.expectedParentAtlasFileSha256) {
    throw new Error(`parent atlas file SHA-256 mismatch: expected ${args.expectedParentAtlasFileSha256}, effective ${parentAtlasFileSha256}`);
  }

  phase = 'skeleton-read';
  const skeletonBytes = await readFile(args.skeletonGlb);
  const skeletonFileSha256 = sha256(skeletonBytes);
  lastTrustworthyEvidence.skeletonFileSha256 = skeletonFileSha256;
  const skeletonGltf = parseGlbJson(skeletonBytes);

  phase = 'envelope-read';
  const envelopeBytes = await readFile(args.envelopeGlb);
  const envelopeFileSha256 = sha256(envelopeBytes);
  lastTrustworthyEvidence.envelopeFileSha256 = envelopeFileSha256;

  phase = 'skeleton-envelope-frame-link-read';
  const frameLinkInput = await readJson(args.skeletonEnvelopeFrameLink, phase);
  const skeletonEnvelopeFrameLinkFileSha256 = sha256(frameLinkInput.bytes);
  lastTrustworthyEvidence.skeletonEnvelopeFrameLinkFileSha256 = skeletonEnvelopeFrameLinkFileSha256;

  phase = 'baseline-read';
  const baselineInput = await readJson(args.baselineResult, phase);
  const baselineCondition = baselineInput.value.conditions?.find(condition => condition.id === 'baseline');
  if (!baselineCondition) throw new Error('baseline-read: baseline condition missing');
  const baselineFileSha256 = sha256(baselineInput.bytes);
  lastTrustworthyEvidence.baselineFileSha256 = baselineFileSha256;

  phase = 'binding-build';
  const receipt = buildK4EnvelopeFrameBinding({
    sourceExtraction,
    sourceExtractionFileSha256: lastTrustworthyEvidence.sourceExtractionFileSha256,
    skeletonGltf,
    skeletonFileSha256,
    envelopeFileSha256,
    skeletonEnvelopeFrameLink: frameLinkInput.value,
    skeletonEnvelopeFrameLinkFileSha256,
    parentAtlas,
    parentAtlasFileSha256,
    requestedConstructionIds: args.requestedConstructionIds,
    baselineCondition,
    baselineFileSha256,
  });

  phase = 'primary-output';
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    status: receipt.status,
    out: args.out,
    receiptSha256: receipt.receiptSha256,
    claimCeiling: receipt.claimCeiling,
  })}\n`);
} catch (error) {
  const failurePath = args?.failure;
  if (failurePath) {
    const report = {
      schema: FAILURE_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: error.message,
      requestedConstructionIds: args.requestedConstructionIds,
      source,
      lastTrustworthyEvidence,
    };
    await mkdir(dirname(failurePath), { recursive: true });
    await writeFile(failurePath, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
