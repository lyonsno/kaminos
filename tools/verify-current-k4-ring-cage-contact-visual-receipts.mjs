#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  AUTHORED_PACKING_TRAJECTORY_VISUAL_RECEIPT_SCHEMA,
  MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_VISUAL_RECEIPT_SCHEMA,
  captureReportPathsForVisual,
  validateMuscleCompartmentRingCageContactVisualReceipts,
} from '../muscle-compartment-ring-cage-contact-visual-receipts.mjs';
import {
  analyzeReceiptBearingPngVisualSignal,
  validateReceiptBearingPng,
} from '../lib/receipt-bearing-browser-capture.mjs';

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--output', '--base-url'].includes(key) || !value || value.startsWith('--')) {
      throw new Error(`invalid argument pair ${key || 'missing'} ${value || 'missing'}`);
    }
    values.set(key.slice(2), value);
  }
  if (!values.get('output') || !values.get('base-url')) {
    throw new Error('--output and --base-url are required');
  }
  return {
    outputDirectory: path.resolve(values.get('output')),
    baseUrl: new URL(values.get('base-url')).href,
  };
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeAtomic(target, value) {
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, jsonBytes(value));
  await rename(temporary, target);
}

let outputPath = null;
let phase = 'parse-arguments';
let failureSchema = MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_VISUAL_RECEIPT_SCHEMA;

try {
  const args = parseArguments(process.argv.slice(2));
  outputPath = path.join(args.outputDirectory, 'capture-route-verification.json');
  phase = 'read-receipts';
  const runReport = JSON.parse(await readFile(path.join(args.outputDirectory, 'run-report.json')));
  if (runReport.visual?.bundleIdentity?.schema ===
      'kaminos.authored-packing-trajectory-visual-bundle.v1') {
    failureSchema = AUTHORED_PACKING_TRAJECTORY_VISUAL_RECEIPT_SCHEMA;
  }
  const captureReportPaths = captureReportPathsForVisual(runReport);
  const captureBytes = await Promise.all(
    captureReportPaths.map(relative => readFile(path.join(args.outputDirectory, relative))),
  );
  const captureReports = captureBytes.map(bytes => JSON.parse(bytes));
  let captureBatch = null;
  let captureReportSha256s = null;
  let currentPngOutputs = null;
  if (failureSchema === AUTHORED_PACKING_TRAJECTORY_VISUAL_RECEIPT_SCHEMA) {
    phase = 'read-current-capture-batch';
    const batchPath = path.join(args.outputDirectory, 'capture-batch-report.json');
    const batchBytes = await readFile(batchPath);
    const batchReport = JSON.parse(batchBytes);
    captureBatch = {
      path:'capture-batch-report.json',
      sha256:sha256(batchBytes),
      report:batchReport,
    };
    captureReportSha256s = captureBytes.map(sha256);
    phase = 'read-current-png-bytes';
    currentPngOutputs = await Promise.all(batchReport.plannedCaptures.map(async capture => {
      const pngBytes = await readFile(path.join(args.outputDirectory, capture.outputPath));
      const viewport = batchReport.viewport;
      return {
        path:capture.outputPath,
        sha256:sha256(pngBytes),
        sizeBytes:pngBytes.length,
        png:validateReceiptBearingPng(pngBytes, viewport),
        visualSignal:analyzeReceiptBearingPngVisualSignal(pngBytes, viewport),
      };
    }));
  }

  phase = 'fetch-served-viewer';
  const viewerUrl = new URL('index.html', args.baseUrl).href;
  const response = await fetch(viewerUrl);
  if (!response.ok) throw new Error(`served viewer fetch failed with HTTP ${response.status}`);
  const viewerBytes = Buffer.from(await response.arrayBuffer());

  phase = 'validate-receipts';
  const verification = validateMuscleCompartmentRingCageContactVisualReceipts({
    runReport,
    servedViewer: {
      url: viewerUrl,
      sha256: sha256(viewerBytes),
      html: viewerBytes.toString('utf8'),
    },
    captureReports,
    captureBatch,
    captureReportSha256s,
    currentPngOutputs,
  });
  await writeAtomic(outputPath, {
    ...verification,
    failurePhase: null,
    generation:runReport.generation || null,
    receiptPaths:captureReportPaths,
    captureBatchReceipt:captureBatch ? {
      path:captureBatch.path,
      sha256:captureBatch.sha256,
    } : null,
  });
  process.stdout.write(`${JSON.stringify({
    status: verification.status,
    outputPath,
    bundleIdentity: verification.bundleIdentity.sha256,
    captureHashes: verification.captures.map(capture => capture.sha256),
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (outputPath) {
    await writeAtomic(outputPath, {
      schema:failureSchema,
      status: 'failed',
      failurePhase: phase,
      error: message,
      lastTrustworthyEvidence: phase,
    });
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
