#!/usr/bin/env node

import { rename, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { captureIndependentBrowserScreenshot } from '../lib/receipt-bearing-browser-capture.mjs';
import { captureReportPathsForVisual } from '../muscle-compartment-ring-cage-contact-visual-receipts.mjs';

const BATCH_SCHEMA = 'kaminos.authored-packing-trajectory-capture-batch.v0';
const AUTHORED_BUNDLE_SCHEMA = 'kaminos.authored-packing-trajectory-visual-bundle.v1';
const DOM_IDENTITY_KEYS = Object.freeze([
  'witnessLoaded',
  'witnessState',
  'witnessRouteRequested',
  'witnessRouteEffective',
  'witnessBundle',
  'witnessGeneration',
  'observedCarrier',
  'initializedCarrier',
  'packedCarrier',
  'residualLedger',
]);

function parseArguments(argv) {
  const supported = new Set([
    '--output', '--base-url', '--browser', '--width', '--height', '--timeout-ms',
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!supported.has(key) || !value || value.startsWith('--')) {
      throw new Error(`invalid argument pair ${key || 'missing'} ${value || 'missing'}`);
    }
    values.set(key.slice(2), value);
  }
  if (!values.get('output') || !values.get('base-url')) {
    throw new Error('--output and --base-url are required');
  }
  const baseUrl = new URL(values.get('base-url'));
  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    throw new Error('--base-url must use HTTP or HTTPS');
  }
  const viewport = {
    width:Number(values.get('width') || 1600),
    height:Number(values.get('height') || 1000),
  };
  if (!Number.isInteger(viewport.width) || viewport.width <= 0 ||
      !Number.isInteger(viewport.height) || viewport.height <= 0) {
    throw new Error('--width and --height must be positive integers');
  }
  return {
    outputDirectory:path.resolve(values.get('output')),
    baseUrl:baseUrl.href,
    browserExecutable:values.get('browser') || process.env.KAMINOS_HEADLESS_BROWSER || null,
    viewport,
    captureTimeoutMs:Number(values.get('timeout-ms') || 30_000),
  };
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomic(target, value) {
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, jsonBytes(value));
  await rename(temporary, target);
}

function pngPathForReport(reportPath) {
  if (!reportPath.endsWith('-capture-report.json')) {
    throw new Error(`capture report does not have the required semantic suffix: ${reportPath}`);
  }
  return reportPath.replace(/-capture-report\.json$/, '.png');
}

let batchPath = null;
let batch = null;
let phase = 'parse-arguments';

try {
  const args = parseArguments(process.argv.slice(2));
  batchPath = path.join(args.outputDirectory, 'capture-batch-report.json');
  phase = 'read-run-report';
  const runReport = JSON.parse(await readFile(
    path.join(args.outputDirectory, 'run-report.json'),
    'utf8',
  ));
  if (runReport.status !== 'completed') {
    throw new Error('authored visual capture requires a completed assay run');
  }
  if (runReport.visual?.bundleIdentity?.schema !== AUTHORED_BUNDLE_SCHEMA ||
      runReport.generation !== runReport.visual.bundleIdentity.generation) {
    throw new Error('authored visual capture generation or bundle schema mismatch');
  }
  const reportPaths = captureReportPathsForVisual(runReport);
  const captures = reportPaths.map((reportPath, index) => ({
    semanticView:reportPath.replace(/-capture-report\.json$/, ''),
    url:new URL(runReport.visual.captureUrls[index], args.baseUrl).href,
    outputPath:pngPathForReport(reportPath),
    reportPath,
  }));
  batch = {
    schema:BATCH_SCHEMA,
    status:'in-progress',
    generation:runReport.generation,
    bundleIdentity:runReport.visual.bundleIdentity,
    route:runReport.visual.route,
    requestedBaseUrl:args.baseUrl,
    viewport:args.viewport,
    captures:[],
    nextCapture:captures[0].semanticView,
    failurePhase:null,
    error:null,
    lastTrustworthyEvidence:{ phase:'capture-plan-published', completedCaptureCount:0 },
  };
  await writeAtomic(batchPath, batch);

  for (const capture of captures) {
    phase = `capture-${capture.semanticView}`;
    const result = await captureIndependentBrowserScreenshot({
      cliExecutable:args.browserExecutable,
      url:capture.url,
      outputPath:path.join(args.outputDirectory, capture.outputPath),
      reportPath:path.join(args.outputDirectory, capture.reportPath),
      viewport:args.viewport,
      captureTimeoutMs:args.captureTimeoutMs,
      cleanupGraceMs:1_000,
      receiptRoot:process.cwd(),
      domDatasetKeys:DOM_IDENTITY_KEYS,
    });
    batch.captures.push({
      semanticView:capture.semanticView,
      requestedUrl:capture.url,
      outputPath:capture.outputPath,
      reportPath:capture.reportPath,
      sha256:result.report.primaryOutput.sha256,
      sizeBytes:result.report.primaryOutput.sizeBytes,
      route:result.report.route,
      domReceipt:result.report.domReceipt,
    });
    batch.nextCapture = captures[batch.captures.length]?.semanticView || null;
    batch.lastTrustworthyEvidence = {
      phase:'capture-completed',
      completedCaptureCount:batch.captures.length,
      semanticView:capture.semanticView,
      sha256:result.report.primaryOutput.sha256,
    };
    await writeAtomic(batchPath, batch);
  }
  batch.status = 'completed';
  batch.nextCapture = null;
  batch.lastTrustworthyEvidence = {
    phase:'all-declared-captures-completed',
    completedCaptureCount:batch.captures.length,
  };
  await writeAtomic(batchPath, batch);
  process.stdout.write(`${JSON.stringify({
    status:batch.status,
    generation:batch.generation,
    captureCount:batch.captures.length,
    batchPath,
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (batchPath) {
    await writeAtomic(batchPath, {
      ...(batch || { schema:BATCH_SCHEMA, status:'failed', captures:[] }),
      status:'failed',
      failurePhase:phase,
      error:message,
      lastTrustworthyEvidence:batch?.lastTrustworthyEvidence || { phase },
    });
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
