#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPORT_SCHEMA = 'kaminos.volume.layer-coefficient-bilinear-motion-witness.v0';
const CAPTURE_ENGINE = resolve(import.meta.dirname, 'volume-layer-coefficient-corpus-witness.mjs');
const RENDERER = resolve(import.meta.dirname, 'volume-layer-coefficient-bilinear-motion-render.py');
const args = parseArgs(process.argv.slice(2));
const requestedUrl = args.get('--url') && args.get('--url') !== true ? String(args.get('--url')) : null;
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-layer-coefficient-bilinear-motion'));
const reportPath = resolve(String(args.get('--report') || join(outDir, 'witness-report.json')));
const captureReportPath = join(outDir, 'capture-report.json');
const manifestPath = join(outDir, 'motion-manifest.json');
const renderReportPath = join(outDir, 'render-report.json');
const renderOutDir = join(outDir, 'render');
const stateSteps = String(args.get('--state-steps') || '98,100,102,104,106,108,110,112,114,116,118,120');
const targetRaySteps = String(args.get('--target-ray-steps') || '160');
const timeoutMs = String(args.get('--timeout-ms') || '900000');
const viewportWidth = String(args.get('--viewport-width') || '1280');
const viewportHeight = String(args.get('--viewport-height') || '960');
const coefficientPython = String(args.get('--python') || process.env.KAMINOS_COEFFICIENT_PYTHON || (
  existsSync('/private/tmp/kaminos-mlx-residual-venv/bin/python')
    ? '/private/tmp/kaminos-mlx-residual-venv/bin/python'
    : 'python3'
));
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = {
  requestedUrl,
  captureEngine: CAPTURE_ENGINE,
  renderer: RENDERER,
};

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });

try {
  if (!requestedUrl) throw new Error('--url is required');
  if (!existsSync(CAPTURE_ENGINE)) throw new Error(`capture engine missing: ${CAPTURE_ENGINE}`);
  if (!existsSync(RENDERER)) throw new Error(`renderer missing: ${RENDERER}`);
  for (const path of [captureReportPath, manifestPath, renderReportPath]) unlinkIfExists(path);

  failurePhase = 'single-browser-sequence-capture';
  const capture = spawnSync(process.execPath, [
    CAPTURE_ENGINE,
    '--motion-capture',
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
    const captureReport = readJsonReport(captureReportPath, 'capture report');
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      captureReportPath,
      captureReportSha256: sha256File(captureReportPath),
      captureReportStatus: captureReport.status,
    };
  }
  if (capture.status !== 0) throw new Error(`single-browser capture exited ${capture.status ?? 'without status'}`);
  const captureReport = readJsonReport(captureReportPath, 'capture report');
  if (captureReport.status !== 'captured') throw new Error(`single-browser capture report status is ${captureReport.status}`);
  if (!existsSync(manifestPath)) throw new Error('single-browser capture completed without a motion manifest');
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    manifestPath,
    manifestSha256: sha256File(manifestPath),
  };

  failurePhase = 'offline-temporal-render';
  const render = spawnSync(coefficientPython, [
    RENDERER,
    '--manifest', manifestPath,
    '--out-dir', renderOutDir,
    '--report', renderReportPath,
  ], { stdio: 'inherit' });
  if (existsSync(renderReportPath)) {
    const renderReport = readJsonReport(renderReportPath, 'render report');
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      renderReportPath,
      renderReportSha256: sha256File(renderReportPath),
      renderReportStatus: renderReport.status,
    };
  }
  if (render.status !== 0) throw new Error(`offline temporal render exited ${render.status ?? 'without status'}`);
  const renderReport = readJsonReport(renderReportPath, 'render report');
  if (renderReport.status !== 'complete') throw new Error(`offline temporal render report status is ${renderReport.status}`);

  failurePhase = null;
  writeReport({
    status: 'complete',
    failurePhase,
    lastTrustworthyEvidence,
    authority: 'single-browser-multi-state-exact-bilinear-motion-v0',
    stateSteps: stateSteps.split(',').map(Number),
    captureInvocationCount: 1,
  });
  console.log(JSON.stringify({ status: 'complete', reportPath, manifestPath, renderReportPath }, null, 2));
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
    identity: 'single-browser-multi-state-exact-bilinear-motion-v0',
    requestedUrl,
    ...payload,
  }, null, 2)}\n`);
}

function unlinkIfExists(path) {
  if (existsSync(path)) unlinkSync(path);
}

function readJsonReport(path, label) {
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
