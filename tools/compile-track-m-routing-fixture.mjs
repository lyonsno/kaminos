#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  TRACK_M_ROUTING_FIXTURE_COMPILER_ID,
  TRACK_M_ROUTING_FIXTURE_FAILURE_SCHEMA,
  compileTrackMRoutingFixture,
} from '../track-m-routing-fixture-core.mjs';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument sequence near ${key ?? '<end>'}`);
    args.set(key, value);
  }
  for (const required of [
    '--graph', '--assay', '--out', '--failure', '--expected-source-sha256',
    '--expected-graph-sha256', '--expected-graph-file-sha256', '--expected-assay-file-sha256',
  ]) {
    if (!args.has(required)) throw new Error(`${required} is required`);
  }
  return args;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
}

async function removeIfExists(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function effectiveDestination(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return resolve(path);
    throw error;
  }
}

async function failureSidecar(requestedPath, protectedPaths, effectiveOutputPath) {
  let suffix = 0;
  while (true) {
    const path = suffix === 0
      ? `${requestedPath}.track-m-routing-fixture-failure.json`
      : `${requestedPath}.track-m-routing-fixture-failure.${suffix}.json`;
    const effectivePath = await effectiveDestination(path);
    if (!protectedPaths.has(effectivePath) && effectivePath !== effectiveOutputPath) {
      return { path, effectivePath };
    }
    suffix += 1;
  }
}

let args;
let requestedGraphPath = null;
let effectiveGraphPath = null;
let requestedAssayPath = null;
let effectiveAssayPath = null;
let graphFileSha256 = null;
let assayFileSha256 = null;
let requestedFailurePath = null;
let effectiveFailurePath = null;
let failurePath = null;
let outputPath = null;
let outputPathIsSafe = false;
let failurePathIsSafe = false;
let lastTrustworthyEvidence = 'no input bytes read';
try {
  args = parseArgs(process.argv.slice(2));
  requestedGraphPath = args.get('--graph');
  requestedAssayPath = args.get('--assay');
  requestedFailurePath = resolve(args.get('--failure'));
  failurePath = requestedFailurePath;
  outputPath = resolve(args.get('--out'));
  const [effectiveOutputPath, requestedEffectiveFailurePath] = await Promise.all([
    effectiveDestination(outputPath),
    effectiveDestination(requestedFailurePath),
  ]);
  const lexicalInputs = new Set([resolve(requestedGraphPath), resolve(requestedAssayPath)]);
  if (lexicalInputs.has(requestedEffectiveFailurePath)) {
    ({ path: failurePath, effectivePath: effectiveFailurePath } = await failureSidecar(
      requestedFailurePath,
      lexicalInputs,
      effectiveOutputPath,
    ));
    failurePathIsSafe = true;
    throw new Error(`failure receipt path must not alias an input; redirected receipt to ${failurePath}`);
  }
  effectiveFailurePath = requestedEffectiveFailurePath;
  failurePathIsSafe = true;
  if (lexicalInputs.has(effectiveOutputPath)) {
    throw new Error('primary output path must not alias an input');
  }
  outputPathIsSafe = true;
  if (effectiveOutputPath === effectiveFailurePath) {
    failurePathIsSafe = false;
    ({ path: failurePath, effectivePath: effectiveFailurePath } = await failureSidecar(
      requestedFailurePath,
      lexicalInputs,
      effectiveOutputPath,
    ));
    failurePathIsSafe = true;
    throw new Error(`primary output and failure receipt paths must be distinct; redirected receipt to ${failurePath}`);
  }

  const [graphResolution, assayResolution] = await Promise.allSettled([
    realpath(requestedGraphPath),
    realpath(requestedAssayPath),
  ]);
  effectiveGraphPath = graphResolution.status === 'fulfilled' ? graphResolution.value : null;
  effectiveAssayPath = assayResolution.status === 'fulfilled' ? assayResolution.value : null;
  const protectedInputs = new Set([
    ...lexicalInputs,
    ...[effectiveGraphPath, effectiveAssayPath].filter(Boolean),
  ]);
  if (protectedInputs.has(effectiveFailurePath)) {
    failurePathIsSafe = false;
    ({ path: failurePath, effectivePath: effectiveFailurePath } = await failureSidecar(
      requestedFailurePath,
      protectedInputs,
      effectiveOutputPath,
    ));
    failurePathIsSafe = true;
    throw new Error(`failure receipt path must not alias an input; redirected receipt to ${failurePath}`);
  }
  if (protectedInputs.has(effectiveOutputPath)) {
    outputPathIsSafe = false;
    throw new Error('primary output path must not alias an input');
  }
  if (graphResolution.status === 'rejected') throw graphResolution.reason;
  if (assayResolution.status === 'rejected') throw assayResolution.reason;
  await Promise.all([removeIfExists(outputPath), removeIfExists(failurePath)]);
  const [graphBytes, assayBytes] = await Promise.all([
    readFile(effectiveGraphPath),
    readFile(effectiveAssayPath),
  ]);
  graphFileSha256 = createHash('sha256').update(graphBytes).digest('hex');
  assayFileSha256 = createHash('sha256').update(assayBytes).digest('hex');
  lastTrustworthyEvidence = 'graph and assay bytes read and hashed';
  const fixture = compileTrackMRoutingFixture(graphBytes, assayBytes, {
    expectedSourceSha256: args.get('--expected-source-sha256'),
    expectedGraphSha256: args.get('--expected-graph-sha256'),
    expectedGraphFileSha256: args.get('--expected-graph-file-sha256'),
    expectedAssayFileSha256: args.get('--expected-assay-file-sha256'),
  });
  await writeJson(outputPath, fixture);
  process.stdout.write(`${JSON.stringify({
    status: 'compiled',
    fixtureSha256: fixture.fixtureSha256,
    outputPath,
  })}\n`);
} catch (error) {
  const expected = key => args?.get(key) ?? null;
  const report = {
    schema: TRACK_M_ROUTING_FIXTURE_FAILURE_SCHEMA,
    compilerId: TRACK_M_ROUTING_FIXTURE_COMPILER_ID,
    status: 'failed',
    failurePhase: lastTrustworthyEvidence === 'no input bytes read' ? 'input-read' : 'source-identity-validation',
    requestedGraphPath,
    effectiveGraphPath,
    requestedAssayPath,
    effectiveAssayPath,
    requestedFailurePath,
    effectiveFailurePath,
    graphFileSha256,
    assayFileSha256,
    expectedSourceSha256: expected('--expected-source-sha256'),
    expectedGraphSha256: expected('--expected-graph-sha256'),
    expectedGraphFileSha256: expected('--expected-graph-file-sha256'),
    expectedAssayFileSha256: expected('--expected-assay-file-sha256'),
    error: error instanceof Error ? error.message : String(error),
    lastTrustworthyEvidence,
  };
  try {
    if (!requestedFailurePath) {
      const candidate = process.argv.indexOf('--failure');
      if (candidate >= 0 && process.argv[candidate + 1]) requestedFailurePath = resolve(process.argv[candidate + 1]);
    }
    if (outputPathIsSafe && outputPath) await removeIfExists(outputPath);
    if (failurePathIsSafe && failurePath) await writeJson(failurePath, report);
  } catch (reportError) {
    process.stderr.write(`failed to write routing fixture failure report: ${reportError}\n`);
  }
  process.stderr.write(`${report.error}\n`);
  process.exitCode = 1;
}
