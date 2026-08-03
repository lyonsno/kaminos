#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  buildTrackMEvidencePlan,
} from '../track-m-evidence-bundle-core.mjs';
import {
  validateTrackMAuthoredSourceM0Preflight,
} from '../track-m-authored-source-m0-preflight.mjs';

const REPORT_SCHEMA = 'kaminos.track-m-authored-source-m0-preflight-report.v0';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`invalid argument sequence near ${key ?? '<end>'}`);
    }
    if (args.has(key)) throw new Error(`duplicate argument ${key}`);
    args.set(key, value);
  }
  for (const required of [
    '--graph',
    '--bundle-source',
    '--expected-graph-sha256',
    '--expected-source-sha256',
    '--output',
  ]) {
    if (!args.has(required)) throw new Error(`${required} is required`);
  }
  const accepted = new Set([
    '--graph',
    '--bundle-source',
    '--expected-graph-sha256',
    '--expected-source-sha256',
    '--output',
    '--routing-fixture',
    '--expected-routing-fixture-sha256',
  ]);
  for (const key of args.keys()) {
    if (!accepted.has(key)) throw new Error(`unsupported argument ${key}`);
  }
  if (args.has('--routing-fixture') !== args.has('--expected-routing-fixture-sha256')) {
    throw new Error('--routing-fixture and --expected-routing-fixture-sha256 must be provided together');
  }
  return args;
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function requestedPath(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function inputReceipt(requested) {
  return {
    requestedPath: requested,
    effectivePath: null,
    bytesSha256: null,
    byteLength: null,
  };
}

async function readJsonInput(receipt, phase) {
  try {
    receipt.effectivePath = await realpath(receipt.requestedPath);
    const bytes = await readFile(receipt.effectivePath);
    receipt.bytesSha256 = hashBytes(bytes);
    receipt.byteLength = bytes.byteLength;
    try {
      return JSON.parse(bytes);
    } catch (error) {
      error.failurePhase = `${phase}-parse`;
      throw error;
    }
  } catch (error) {
    if (!error.failurePhase) error.failurePhase = `${phase}-read`;
    throw error;
  }
}

const argv = process.argv.slice(2);
const outputCandidate = requestedPath(argv, '--output');
let outputPath = outputCandidate ? resolve(outputCandidate) : null;
const receipts = {
  graph: inputReceipt(requestedPath(argv, '--graph')),
  bundleSource: inputReceipt(requestedPath(argv, '--bundle-source')),
  routingFixture: inputReceipt(requestedPath(argv, '--routing-fixture')),
};
let failurePhase = 'arguments';
let validation = null;

try {
  const args = parseArgs(argv);
  outputPath = resolve(args.get('--output'));
  receipts.graph.requestedPath = args.get('--graph');
  receipts.bundleSource.requestedPath = args.get('--bundle-source');
  receipts.routingFixture.requestedPath = args.get('--routing-fixture') ?? null;

  failurePhase = 'graph-read';
  const graph = await readJsonInput(receipts.graph, 'graph');
  failurePhase = 'bundle-source-read';
  const bundleSource = await readJsonInput(receipts.bundleSource, 'bundle-source');
  failurePhase = 'bundle-plan-build';
  const bundlePlan = buildTrackMEvidencePlan(bundleSource);
  let routingFixture = null;
  if (receipts.routingFixture.requestedPath) {
    failurePhase = 'routing-fixture-read';
    routingFixture = await readJsonInput(receipts.routingFixture, 'routing-fixture');
  }

  failurePhase = 'validation';
  validation = validateTrackMAuthoredSourceM0Preflight({
    graph,
    expectedGraphSha256: args.get('--expected-graph-sha256'),
    expectedSourceSha256: args.get('--expected-source-sha256'),
    bundleSource,
    bundlePlan,
    routingFixture,
    expectedRoutingFixtureSha256: args.get('--expected-routing-fixture-sha256') ?? null,
  });
  const report = {
    schema: REPORT_SCHEMA,
    status: 'validated',
    failurePhase: null,
    requested: {
      expectedGraphSha256: args.get('--expected-graph-sha256'),
      expectedSourceSha256: args.get('--expected-source-sha256'),
      expectedRoutingFixtureSha256: args.get('--expected-routing-fixture-sha256') ?? null,
    },
    inputs: receipts,
    effectivePlanRoute: 'deterministic-plan-from-verified-bundle-source',
    validation,
    error: null,
  };
  await writeJson(outputPath, report);
  process.stdout.write(`${JSON.stringify({
    status: report.status,
    disposition: validation.disposition,
    outputPath,
  })}\n`);
  if (!validation.ok && validation.disposition !== 'HOLD_MUSCULATURE_SOURCE_EVIDENCE') {
    process.exitCode = 1;
  }
} catch (error) {
  const report = {
    schema: REPORT_SCHEMA,
    status: 'failed-before-validation',
    failurePhase: error.failurePhase ?? failurePhase,
    requested: {
      expectedGraphSha256: requestedPath(argv, '--expected-graph-sha256'),
      expectedSourceSha256: requestedPath(argv, '--expected-source-sha256'),
      expectedRoutingFixtureSha256: requestedPath(argv, '--expected-routing-fixture-sha256'),
    },
    inputs: receipts,
    effectivePlanRoute: null,
    validation,
    error: error instanceof Error ? error.message : String(error),
  };
  try {
    if (outputPath) await writeJson(outputPath, report);
  } catch (reportError) {
    process.stderr.write(`failed to write preflight report: ${reportError}\n`);
  }
  process.stderr.write(`${report.error}\n`);
  process.exitCode = 1;
}
