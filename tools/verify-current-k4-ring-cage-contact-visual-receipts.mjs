#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_VISUAL_RECEIPT_SCHEMA,
  validateMuscleCompartmentRingCageContactVisualReceipts,
} from '../muscle-compartment-ring-cage-contact-visual-receipts.mjs';

const CAPTURE_REPORTS = [
  'source-crowded-capture-report.json',
  'contact-relieved-capture-report.json',
  'source-crowded-side-capture-report.json',
  'contact-relieved-side-capture-report.json',
];

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

try {
  const args = parseArguments(process.argv.slice(2));
  outputPath = path.join(args.outputDirectory, 'capture-route-verification.json');
  phase = 'read-receipts';
  const [runReportBytes, ...captureBytes] = await Promise.all([
    readFile(path.join(args.outputDirectory, 'run-report.json')),
    ...CAPTURE_REPORTS.map(relative => readFile(path.join(args.outputDirectory, relative))),
  ]);
  const runReport = JSON.parse(runReportBytes);
  const captureReports = captureBytes.map(bytes => JSON.parse(bytes));

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
  });
  await writeAtomic(outputPath, {
    ...verification,
    failurePhase: null,
    receiptPaths: CAPTURE_REPORTS,
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
      schema: MUSCLE_COMPARTMENT_RING_CAGE_CONTACT_VISUAL_RECEIPT_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      error: message,
      lastTrustworthyEvidence: phase,
    });
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
