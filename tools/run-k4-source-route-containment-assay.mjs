#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  buildK4SourceRouteContainment,
  parseGlbTriangleSoup,
} from '../k4-source-route-containment-core.mjs';

const FAILURE_SCHEMA = 'kaminos.k4-source-route-containment-failure.v0';

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`argument-parse: malformed argument ${key ?? ''}`);
    }
    if (values.has(key)) throw new Error(`argument-parse: duplicate ${key}`);
    values.set(key, value);
  }
  const required = [
    '--parent-atlas', '--expected-parent-atlas-file-sha256',
    '--parent-atlas-locator',
    '--frame-receipt', '--expected-frame-receipt-file-sha256',
    '--frame-receipt-locator',
    '--envelope', '--expected-envelope-file-sha256',
    '--envelope-locator',
    '--solver-carrier', '--expected-solver-carrier-file-sha256',
    '--solver-carrier-locator',
    '--shape-assay', '--expected-shape-assay-file-sha256',
    '--shape-assay-locator',
    '--requested-constructions', '--tolerance', '--out', '--out-locator',
    '--report', '--report-locator', '--failure',
  ];
  for (const key of required) {
    if (!values.has(key)) throw new Error(`argument-parse: missing ${key}`);
  }
  const requestedConstructionIds = values.get('--requested-constructions')
    .split(',').map(value => value.trim()).filter(Boolean);
  const tolerance = Number(values.get('--tolerance'));
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
    throw new Error('argument-parse: tolerance must be positive');
  }
  return {
    parentAtlas: resolve(values.get('--parent-atlas')),
    expectedParentAtlasFileSha256:
      values.get('--expected-parent-atlas-file-sha256'),
    parentAtlasLocator: values.get('--parent-atlas-locator'),
    frameReceipt: resolve(values.get('--frame-receipt')),
    expectedFrameReceiptFileSha256:
      values.get('--expected-frame-receipt-file-sha256'),
    frameReceiptLocator: values.get('--frame-receipt-locator'),
    envelope: resolve(values.get('--envelope')),
    expectedEnvelopeFileSha256: values.get('--expected-envelope-file-sha256'),
    envelopeLocator: values.get('--envelope-locator'),
    solverCarrier: resolve(values.get('--solver-carrier')),
    expectedSolverCarrierFileSha256:
      values.get('--expected-solver-carrier-file-sha256'),
    solverCarrierLocator: values.get('--solver-carrier-locator'),
    shapeAssay: resolve(values.get('--shape-assay')),
    expectedShapeAssayFileSha256:
      values.get('--expected-shape-assay-file-sha256'),
    shapeAssayLocator: values.get('--shape-assay-locator'),
    requestedConstructionIds,
    tolerance,
    out: resolve(values.get('--out')),
    outLocator: values.get('--out-locator'),
    report: resolve(values.get('--report')),
    reportLocator: values.get('--report-locator'),
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

function verifyExpectedHash(label, bytes, expected) {
  const effective = sha256(bytes);
  if (effective !== expected) {
    throw new Error(`${label} file SHA-256 mismatch: expected ${expected}, effective ${effective}`);
  }
  return effective;
}

let args = null;
let phase = 'argument-parse';
const lastTrustworthyEvidence = {};

try {
  args = parseArgs(process.argv.slice(2));

  phase = 'parent-atlas-read';
  const parentInput = await readJson(args.parentAtlas, phase);
  lastTrustworthyEvidence.parentAtlasRead = true;
  lastTrustworthyEvidence.parentAtlasFileSha256 = sha256(parentInput.bytes);
  phase = 'parent-atlas-hash';
  verifyExpectedHash('parent atlas', parentInput.bytes,
    args.expectedParentAtlasFileSha256);

  phase = 'frame-receipt-read';
  const frameInput = await readJson(args.frameReceipt, phase);
  lastTrustworthyEvidence.frameReceiptRead = true;
  lastTrustworthyEvidence.frameReceiptFileSha256 = sha256(frameInput.bytes);
  phase = 'frame-receipt-hash';
  verifyExpectedHash('frame receipt', frameInput.bytes,
    args.expectedFrameReceiptFileSha256);

  phase = 'envelope-read';
  const envelopeBytes = await readFile(args.envelope);
  lastTrustworthyEvidence.envelopeRead = true;
  lastTrustworthyEvidence.envelopeFileSha256 = sha256(envelopeBytes);
  phase = 'envelope-hash';
  verifyExpectedHash('envelope', envelopeBytes,
    args.expectedEnvelopeFileSha256);
  phase = 'envelope-parse';
  const envelopeMesh = parseGlbTriangleSoup(envelopeBytes);
  lastTrustworthyEvidence.envelopeTriangleCount = envelopeMesh.triangles.length;

  phase = 'solver-carrier-read';
  const carrierInput = await readJson(args.solverCarrier, phase);
  lastTrustworthyEvidence.solverCarrierRead = true;
  lastTrustworthyEvidence.solverCarrierFileSha256 = sha256(carrierInput.bytes);
  phase = 'solver-carrier-hash';
  verifyExpectedHash('solver carrier', carrierInput.bytes,
    args.expectedSolverCarrierFileSha256);

  phase = 'shape-assay-read';
  const shapeInput = await readJson(args.shapeAssay, phase);
  lastTrustworthyEvidence.shapeAssayRead = true;
  lastTrustworthyEvidence.shapeAssayFileSha256 = sha256(shapeInput.bytes);
  phase = 'shape-assay-hash';
  verifyExpectedHash('shape assay', shapeInput.bytes,
    args.expectedShapeAssayFileSha256);

  phase = 'comparison-build';
  const result = buildK4SourceRouteContainment({
    parentAtlas: parentInput.value,
    frameReceipt: frameInput.value,
    envelopeMesh,
    solverCarrier: carrierInput.value,
    shapeAssay: shapeInput.value,
    requestedConstructionIds: args.requestedConstructionIds,
    tolerance: args.tolerance,
  });
  result.inputs = {
    parentAtlas: {
      requestedPath: args.parentAtlasLocator,
      effectivePath: args.parentAtlasLocator,
      fileSha256: lastTrustworthyEvidence.parentAtlasFileSha256,
    },
    frameReceipt: {
      requestedPath: args.frameReceiptLocator,
      effectivePath: args.frameReceiptLocator,
      fileSha256: lastTrustworthyEvidence.frameReceiptFileSha256,
    },
    envelope: {
      requestedPath: args.envelopeLocator,
      effectivePath: args.envelopeLocator,
      fileSha256: lastTrustworthyEvidence.envelopeFileSha256,
    },
    solverCarrier: {
      requestedPath: args.solverCarrierLocator,
      effectivePath: args.solverCarrierLocator,
      fileSha256: lastTrustworthyEvidence.solverCarrierFileSha256,
    },
    shapeAssay: {
      requestedPath: args.shapeAssayLocator,
      effectivePath: args.shapeAssayLocator,
      fileSha256: lastTrustworthyEvidence.shapeAssayFileSha256,
    },
  };

  phase = 'primary-output';
  await mkdir(dirname(args.out), { recursive: true });
  const outputBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
  await writeFile(args.out, outputBytes);
  const outputFileSha256 = sha256(outputBytes);
  phase = 'run-report';
  await mkdir(dirname(args.report), { recursive: true });
  await writeFile(args.report, `${JSON.stringify({
    schema: 'kaminos.k4-source-route-containment-run-report.v0',
    status: 'completed',
    failurePhase: null,
    requestedConstructionIds: args.requestedConstructionIds,
    effectiveConstructionIds: result.effectiveConstructionIds,
    inputs: result.inputs,
    output: {
      requestedPath: args.outLocator,
      effectivePath: args.outLocator,
      fileSha256: outputFileSha256,
    },
    lastTrustworthyEvidence: {
      phase: 'primary-output-written',
      returnedEscapeSectionIds: result.returnedEscapeSectionIds,
      outputFileSha256,
    },
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    out: args.out,
    report: args.reportLocator,
    outputFileSha256,
    returnedEscapeSectionIds: result.returnedEscapeSectionIds,
  })}\n`);
} catch (error) {
  if (args?.failure) {
    const report = {
      schema: FAILURE_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: error.message,
      requestedConstructionIds: args.requestedConstructionIds,
      requestedInputs: {
        parentAtlas: args.parentAtlasLocator,
        frameReceipt: args.frameReceiptLocator,
        envelope: args.envelopeLocator,
        solverCarrier: args.solverCarrierLocator,
        shapeAssay: args.shapeAssayLocator,
        report: args.reportLocator,
      },
      lastTrustworthyEvidence,
    };
    await mkdir(dirname(args.failure), { recursive: true });
    await writeFile(args.failure, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
