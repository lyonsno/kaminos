#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  AUTHORED_MUSCLE_COORDINATE_EXPORT_FAILURE_SCHEMA,
  buildAuthoredMuscleCoordinateExport,
  buildPackerAuthorityProbe,
} from '../authored-muscle-coordinate-export-core.mjs';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`invalid argument sequence near ${key ?? '<end>'}`);
    }
    args.set(key, value);
  }
  for (const key of [
    '--extraction', '--source-graph', '--routing-fixture',
    '--requested-routes', '--out-dir', '--failure',
  ]) {
    if (!args.has(key)) throw new Error(`${key} is required`);
  }
  return args;
}

async function loadJson(path) {
  const effectivePath = await realpath(path);
  const bytes = await readFile(effectivePath);
  return {
    requestedPath: path,
    effectivePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    value: JSON.parse(bytes),
  };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

let args;
let failurePath = null;
let requestedConstructionIds = [];
let source = null;
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = 'no caller input parsed';
try {
  args = parseArgs(process.argv.slice(2));
  failurePath = resolve(args.get('--failure'));
  requestedConstructionIds = args.get('--requested-routes')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  failurePhase = 'input-read';
  lastTrustworthyEvidence = 'exact requested route ids parsed';
  const [extraction, graph, routing] = await Promise.all([
    loadJson(args.get('--extraction')),
    loadJson(args.get('--source-graph')),
    loadJson(args.get('--routing-fixture')),
  ]);
  source = extraction.value?.source ? structuredClone(extraction.value.source) : null;
  lastTrustworthyEvidence = 'source extraction, source graph, and routing fixture bytes read and hashed';
  failurePhase = 'source-validation';
  const result = buildAuthoredMuscleCoordinateExport({
    extraction: extraction.value,
    sourceGraph: graph.value,
    sourceGraphFileSha256: graph.sha256,
    routingFixture: routing.value,
    routingFixtureFileSha256: routing.sha256,
    requestedConstructionIds,
  });
  failurePhase = 'sidecar-emission';
  lastTrustworthyEvidence = 'parent atlas and candidate-authority receipt built and hash-bound in memory';
  const outputRoot = resolve(args.get('--out-dir'));
  await mkdir(outputRoot, { recursive: true });
  await writeJson(join(outputRoot, 'parent-atlas.json'), result.parentAtlas);
  await writeJson(join(outputRoot, 'authority-receipt.json'), result.authorityReceipt);
  if (result.coordinateCarrier) {
    await writeJson(join(outputRoot, 'coordinate-carrier.json'), result.coordinateCarrier);
  } else {
    await writeJson(
      join(outputRoot, 'packer-authority-probe.json'),
      buildPackerAuthorityProbe(result.authorityReceipt),
    );
  }
  try {
    await unlink(failurePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  process.stdout.write(`${JSON.stringify({
    status: result.authorityReceipt.status,
    outputRoot,
    parentAtlasSha256: result.parentAtlas.atlasSha256,
    authorityReceiptSha256: result.authorityReceipt.receiptSha256,
    coordinateCarrierEmitted: result.coordinateCarrier !== null,
  })}\n`);
} catch (error) {
  const report = {
    schema: AUTHORED_MUSCLE_COORDINATE_EXPORT_FAILURE_SCHEMA,
    status: 'failed',
    failurePhase: error?.failurePhase ?? failurePhase,
    source,
    requestedConstructionIds,
    error: error instanceof Error ? error.message : String(error),
    lastTrustworthyEvidence: error?.lastTrustworthyEvidence ?? lastTrustworthyEvidence,
  };
  try {
    if (!failurePath) {
      const index = process.argv.indexOf('--failure');
      if (index >= 0 && process.argv[index + 1]) failurePath = resolve(process.argv[index + 1]);
    }
    if (failurePath) await writeJson(failurePath, report);
  } catch (reportError) {
    process.stderr.write(`failed to write coordinate export failure report: ${reportError}\n`);
  }
  process.stderr.write(`${report.error}\n`);
  process.exitCode = 1;
}
