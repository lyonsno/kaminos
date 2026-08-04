#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import {
  TRACK_M_SELECTED_ROUTE_FIXTURE_COMPILER_ID,
  TRACK_M_SELECTED_ROUTE_FIXTURE_FAILURE_SCHEMA,
  compileTrackMSelectedRouteFixture,
} from '../track-m-selected-route-fixture-core.mjs';

const REPORT_SCHEMA = 'kaminos.track-m-selected-route-fixture-compiler-report.v0';

function usage() {
  return `Usage: node tools/compile-track-m-selected-route-fixture.mjs \\
  --graph <source-graph.json> \\
  --receipt <authority-receipt.json> \\
  --output <fixture.json> \\
  --report <report.json> \\
  --expected-source-sha256 <sha256> \\
  --expected-graph-sha256 <sha256> \\
  --expected-graph-file-sha256 <sha256> \\
  --expected-receipt-file-sha256 <sha256> \\
  --construction-id <id> [--construction-id <id> ...]\n`;
}

function parseArgs(argv) {
  const values = { constructionIds: [] };
  const names = new Map([
    ['--graph', 'graphPath'],
    ['--receipt', 'receiptPath'],
    ['--output', 'outputPath'],
    ['--report', 'reportPath'],
    ['--expected-source-sha256', 'expectedSourceSha256'],
    ['--expected-graph-sha256', 'expectedGraphSha256'],
    ['--expected-graph-file-sha256', 'expectedGraphFileSha256'],
    ['--expected-receipt-file-sha256', 'expectedReceiptFileSha256'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    const value = argv[index + 1];
    if (arg === '--construction-id') {
      if (!value || value.startsWith('--')) throw new Error('--construction-id requires a value');
      values.constructionIds.push(value);
      index += 1;
      continue;
    }
    const key = names.get(arg);
    if (!key) throw new Error(`unknown argument: ${arg}`);
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    values[key] = value;
    index += 1;
  }
  for (const key of names.values()) {
    if (!values[key]) throw new Error(`missing required argument for ${key}`);
  }
  if (values.constructionIds.length === 0) throw new Error('at least one --construction-id is required');
  for (const key of ['graphPath', 'receiptPath', 'outputPath', 'reportPath']) values[key] = resolve(values[key]);
  return values;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function effectiveDestination(path) {
  const absolutePath = resolve(path);
  try {
    return await realpath(absolutePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const parentPath = dirname(absolutePath);
    let effectiveParentPath;
    try {
      effectiveParentPath = await realpath(parentPath);
    } catch (parentError) {
      if (parentError?.code === 'ENOENT') {
        throw new Error(`destination parent directory must exist: ${parentPath}`);
      }
      throw parentError;
    }
    return resolve(effectiveParentPath, basename(absolutePath));
  }
}

async function failureSidecar(requestedPath, protectedPaths, effectiveOutputPath) {
  let suffix = 0;
  while (true) {
    const path = suffix === 0
      ? `${requestedPath}.track-m-selected-route-fixture-failure.json`
      : `${requestedPath}.track-m-selected-route-fixture-failure.${suffix}.json`;
    const effectivePath = await effectiveDestination(path);
    if (!protectedPaths.has(effectivePath) && effectivePath !== effectiveOutputPath) {
      return { path, effectivePath };
    }
    suffix += 1;
  }
}

let phase = 'arguments';
let requested = null;
let effective = null;
let lastTrustworthyEvidence = {};
let outputPath = null;
let reportPath = null;
let outputPathIsSafe = false;
let reportPathIsSafe = false;

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    process.exit(0);
  }
  requested = {
    graphPath: args.graphPath,
    receiptPath: args.receiptPath,
    outputPath: args.outputPath,
    reportPath: args.reportPath,
    constructionIds: [...args.constructionIds],
    expectedSourceSha256: args.expectedSourceSha256,
    expectedGraphSha256: args.expectedGraphSha256,
    expectedGraphFileSha256: args.expectedGraphFileSha256,
    expectedReceiptFileSha256: args.expectedReceiptFileSha256,
  };

  phase = 'resolve-destinations';
  outputPath = args.outputPath;
  reportPath = args.reportPath;
  const [effectiveOutputPath, requestedEffectiveReportPath] = await Promise.all([
    effectiveDestination(outputPath),
    effectiveDestination(reportPath),
  ]);
  const lexicalInputs = new Set([args.graphPath, args.receiptPath]);
  let effectiveReportPath = requestedEffectiveReportPath;
  if (lexicalInputs.has(effectiveReportPath)) {
    ({ path: reportPath, effectivePath: effectiveReportPath } = await failureSidecar(
      args.reportPath, lexicalInputs, effectiveOutputPath,
    ));
    reportPathIsSafe = true;
    effective = { outputPath: effectiveOutputPath, reportPath: effectiveReportPath };
    throw new Error(`report path must not alias an input; redirected report to ${reportPath}`);
  }
  reportPathIsSafe = true;
  if (lexicalInputs.has(effectiveOutputPath)) {
    effective = { outputPath: effectiveOutputPath, reportPath: effectiveReportPath };
    throw new Error('primary output path must not alias an input');
  }
  outputPathIsSafe = true;
  if (effectiveOutputPath === effectiveReportPath) {
    reportPathIsSafe = false;
    ({ path: reportPath, effectivePath: effectiveReportPath } = await failureSidecar(
      args.reportPath, lexicalInputs, effectiveOutputPath,
    ));
    reportPathIsSafe = true;
    effective = { outputPath: effectiveOutputPath, reportPath: effectiveReportPath };
    throw new Error(`output and report paths must be distinct; redirected report to ${reportPath}`);
  }

  const [graphResolution, receiptResolution] = await Promise.allSettled([
    realpath(args.graphPath),
    realpath(args.receiptPath),
  ]);
  const effectiveGraphPath = graphResolution.status === 'fulfilled' ? graphResolution.value : null;
  const effectiveReceiptPath = receiptResolution.status === 'fulfilled' ? receiptResolution.value : null;
  const protectedInputs = new Set([
    ...lexicalInputs,
    ...[effectiveGraphPath, effectiveReceiptPath].filter(Boolean),
  ]);
  if (protectedInputs.has(effectiveReportPath)) {
    reportPathIsSafe = false;
    ({ path: reportPath, effectivePath: effectiveReportPath } = await failureSidecar(
      args.reportPath, protectedInputs, effectiveOutputPath,
    ));
    reportPathIsSafe = true;
    effective = {
      graphPath: effectiveGraphPath,
      receiptPath: effectiveReceiptPath,
      outputPath: effectiveOutputPath,
      reportPath: effectiveReportPath,
    };
    throw new Error(`report path must not alias an input; redirected report to ${reportPath}`);
  }
  if (protectedInputs.has(effectiveOutputPath)) {
    outputPathIsSafe = false;
    effective = {
      graphPath: effectiveGraphPath,
      receiptPath: effectiveReceiptPath,
      outputPath: effectiveOutputPath,
      reportPath: effectiveReportPath,
    };
    throw new Error('primary output path must not alias an input');
  }
  if (graphResolution.status === 'rejected') throw graphResolution.reason;
  if (receiptResolution.status === 'rejected') throw receiptResolution.reason;

  await Promise.all([
    rm(outputPath, { force: true }),
    rm(reportPath, { force: true }),
  ]);

  phase = 'read-inputs';
  const [graphBytes, receiptBytes] = await Promise.all([
    readFile(effectiveGraphPath),
    readFile(effectiveReceiptPath),
  ]);
  effective = {
    graphPath: effectiveGraphPath,
    receiptPath: effectiveReceiptPath,
    outputPath: effectiveOutputPath,
    reportPath: effectiveReportPath,
    graphFileSha256: sha256(graphBytes),
    receiptFileSha256: sha256(receiptBytes),
    constructionIds: [...args.constructionIds],
  };
  lastTrustworthyEvidence = {
    graphPath: effectiveGraphPath,
    receiptPath: effectiveReceiptPath,
    graphFileSha256: effective.graphFileSha256,
    receiptFileSha256: effective.receiptFileSha256,
  };

  phase = 'compile';
  const fixture = compileTrackMSelectedRouteFixture(graphBytes, receiptBytes, {
    expectedConstructionIds: args.constructionIds,
    expectedSourceSha256: args.expectedSourceSha256,
    expectedGraphSha256: args.expectedGraphSha256,
    expectedGraphFileSha256: args.expectedGraphFileSha256,
    expectedReceiptFileSha256: args.expectedReceiptFileSha256,
  });

  phase = 'write-output';
  await writeJsonAtomic(outputPath, fixture);
  const outputBytes = await readFile(outputPath);
  const report = {
    schema: REPORT_SCHEMA,
    compilerId: TRACK_M_SELECTED_ROUTE_FIXTURE_COMPILER_ID,
    status: 'compiled',
    requested,
    effective,
    output: {
      path: outputPath,
      fileSha256: sha256(outputBytes),
      fixtureSha256: fixture.fixtureSha256,
      constructionIds: fixture.selection.constructionIds,
    },
  };
  phase = 'write-report';
  await writeJsonAtomic(reportPath, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  let cleanupFailure = null;
  if (outputPathIsSafe && outputPath) {
    try {
      await rm(outputPath, { force: true });
    } catch (cleanupError) {
      cleanupFailure = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    }
  }
  const failure = {
    schema: TRACK_M_SELECTED_ROUTE_FIXTURE_FAILURE_SCHEMA,
    compilerId: TRACK_M_SELECTED_ROUTE_FIXTURE_COMPILER_ID,
    status: 'failed',
    requested,
    effective,
    failure: {
      phase,
      message: error instanceof Error ? error.message : String(error),
      ...(cleanupFailure ? { cleanupFailure } : {}),
    },
    lastTrustworthyEvidence,
  };
  if (reportPathIsSafe && reportPath) {
    try {
      await writeJsonAtomic(reportPath, failure);
    } catch (reportError) {
      process.stderr.write(`failed to write failure report: ${reportError instanceof Error ? reportError.message : reportError}\n`);
    }
  }
  process.stderr.write(`${failure.failure.message}\n`);
  process.exitCode = 1;
}
