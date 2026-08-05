#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPORT_SCHEMA = 'kaminos.volume.layer-coefficient-target-prime-probe-witness.v0';
const CAPTURE_ENGINE = resolve(import.meta.dirname, 'volume-layer-coefficient-corpus-witness.mjs');
const args = parseArgs(process.argv.slice(2));
const requestedUrl = args.get('--url') && args.get('--url') !== true ? String(args.get('--url')) : null;
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-layer-coefficient-target-prime-probe'));
const reportPath = resolve(String(args.get('--report') || join(outDir, 'witness-report.json')));
const captureReportPath = join(outDir, 'capture-report.json');
const manifestPath = join(outDir, 'source-basis-prime-probe-manifest.json');
const stateSteps = String(args.get('--state-steps') || '116,118');
const targetRaySteps = String(args.get('--target-ray-steps') || '160');
const timeoutMs = String(args.get('--timeout-ms') || '900000');
const viewportWidth = String(args.get('--viewport-width') || '1280');
const viewportHeight = String(args.get('--viewport-height') || '960');
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = { requestedUrl, captureEngine: CAPTURE_ENGINE };

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });

try {
  if (!requestedUrl) throw new Error('--url is required');
  if (!existsSync(CAPTURE_ENGINE)) throw new Error(`capture engine missing: ${CAPTURE_ENGINE}`);
  for (const path of [captureReportPath, manifestPath]) unlinkIfExists(path);

  failurePhase = 'single-browser-source-basis-prime-probe';
  const capture = spawnSync(process.execPath, [
    CAPTURE_ENGINE,
    '--motion-capture',
    '--source-basis-probe-only',
    '--target-before-source-probe',
    '--url', requestedUrl,
    '--out-dir', outDir,
    '--report', captureReportPath,
    '--training-manifest', manifestPath,
    '--state-steps', stateSteps,
    '--target-ray-steps', targetRaySteps,
    '--timeout-ms', timeoutMs,
    '--viewport-width', viewportWidth,
    '--viewport-height', viewportHeight,
  ], { stdio: 'inherit' });
  if (existsSync(captureReportPath)) {
    const captureReport = readJson(captureReportPath, 'capture report');
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      captureReportPath,
      captureReportSha256: sha256File(captureReportPath),
      captureReportStatus: captureReport.status,
    };
  }
  if (capture.status !== 0) throw new Error(`source-basis prime probe exited ${capture.status ?? 'without status'}`);
  const captureReport = readJson(captureReportPath, 'capture report');
  if (captureReport.status !== 'captured') throw new Error(`capture report status is ${captureReport.status}`);
  if (!existsSync(manifestPath)) throw new Error('source-basis prime probe completed without a manifest');
  const manifest = readJson(manifestPath, 'source-basis prime probe manifest');
  if (manifest.schema !== 'kaminos.volume.layer-coefficient-source-basis-prime-probe.v0') {
    throw new Error(`source-basis prime probe manifest schema is ${manifest.schema}`);
  }
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    manifestPath,
    manifestSha256: sha256File(manifestPath),
  };

  failurePhase = null;
  writeReport({
    status: 'complete',
    failurePhase,
    authority: 'diagnostic-target-prime-source-basis-only-v0',
    claimCeiling: manifest.claimCeiling,
    stateSteps: manifest.sequence.stateSteps,
    targetBeforeSourceProbe: manifest.sequence.targetBeforeSourceProbe,
    rawOpticalTail: manifest.states.map(state => ({ id: state.id, ...state.rows.rawOpticalTail })),
    lastTrustworthyEvidence,
  });
} catch (error) {
  writeReport({
    status: 'failed',
    failurePhase,
    reason: error?.message || String(error),
    lastTrustworthyEvidence,
  });
  console.error(error?.stack || error);
  process.exitCode = 1;
}

function writeReport(payload) {
  writeFileSync(reportPath, `${JSON.stringify({
    schema: REPORT_SCHEMA,
    identity: 'single-browser-target-prime-source-basis-probe-v0',
    requestedUrl,
    ...payload,
  }, null, 2)}\n`);
}

function unlinkIfExists(path) {
  if (existsSync(path)) unlinkSync(path);
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error?.message || error}`);
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    const value = next && !next.startsWith('--') ? next : true;
    parsed.set(key, value);
    if (value !== true) index += 1;
  }
  return parsed;
}
