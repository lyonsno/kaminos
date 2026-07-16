#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSplatRadianceParityReport } from './volume-splat-radiance-parity-contract.mjs';

const CURRENT_ARM = 'current-additive-v0';
const MATCHED_ARM = 'matched-presentation-v0';
const argv = process.argv.slice(2);
const outDir = resolve(readOption(argv, '--out-dir') || '/tmp/kaminos-splat-radiance-parity');
const reportPath = resolve(readOption(argv, '--report') || `${outDir}/report.json`);
const fullReportPath = resolve(readOption(argv, '--full-report') || `${outDir}/full-orbit-report.json`);
const requestedUrl = readOption(argv, '--url');
let failurePhase = 'delegate-launch';
let lastTrustworthyEvidence = {
  requestedArms: [CURRENT_ARM, MATCHED_ARM],
  reportPath,
  fullReportPath,
};

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });

try {
  failurePhase = 'route-preflight';
  if (!requestedUrl) throw new Error('radiance parity witness requires --url');
  const response = await fetch(requestedUrl, { redirect: 'follow' });
  const responseBody = await response.text();
  const effectiveUrl = new URL(response.url);
  lastTrustworthyEvidence.routePreflight = {
    requestedUrl,
    status: response.status,
    effectiveUrl: response.url,
    contentType: response.headers.get('content-type'),
    selectiveHeadDocument: responseBody.includes('<title>Kaminos Selective Head Live Assay</title>'),
  };
  if (!response.ok) throw new Error(`route preflight returned HTTP ${response.status} at ${response.url}`);
  if (effectiveUrl.pathname !== '/volume-selective-head-live.html' || !lastTrustworthyEvidence.routePreflight.selectiveHeadDocument) {
    throw new Error(`route preflight did not resolve the volume-selective-head-live document: ${response.url}`);
  }

  const forwarded = stripOptions(argv, new Set(['--report', '--full-report', '--radiance-parity-report']));
  failurePhase = 'delegate-orbit-capture';
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('./volume-raymarch-filament-orbit-witness.mjs', import.meta.url)),
    ...forwarded,
    '--out-dir', outDir,
    '--report', fullReportPath,
    '--radiance-parity-report', reportPath,
  ], { cwd: process.cwd(), stdio: 'inherit' });
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    delegateStatus: result.status,
    delegateSignal: result.signal,
    fullReportExists: existsSync(fullReportPath),
    radianceReportExists: existsSync(reportPath),
  };
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`radiance parity delegate failed with status ${result.status}${result.signal ? ` signal ${result.signal}` : ''}`);

  failurePhase = 'false-closure-validation';
  if (!existsSync(reportPath)) throw new Error('delegate completed without a radiance parity report');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  validateSplatRadianceParityReport(report);
  lastTrustworthyEvidence.completedReport = reportPath;
  failurePhase = null;
  console.log(JSON.stringify({
    status: report.status,
    report: reportPath,
    fullReport: fullReportPath,
    arms: report.arms.map(arm => ({ id: arm.id, captures: arm.captures.length })),
  }, null, 2));
} catch (error) {
  const failureReport = {
    schema: 'kaminos.volume.splat-radiance-parity.v0',
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    lastTrustworthyEvidence,
  };
  if (failurePhase === 'route-preflight' || !existsSync(reportPath)) writeFileSync(reportPath, JSON.stringify(failureReport, null, 2));
  console.error(JSON.stringify(failureReport, null, 2));
  process.exitCode = 1;
}

function readOption(args, name) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) return args[index + 1] ?? null;
    if (args[index].startsWith(`${name}=`)) return args[index].slice(name.length + 1);
  }
  return null;
}

function stripOptions(args, names) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    const equalsName = [...names].find(name => item.startsWith(`${name}=`));
    if (equalsName) continue;
    if (names.has(item)) {
      index += 1;
      continue;
    }
    if (item === '--out-dir') {
      index += 1;
      continue;
    }
    if (item.startsWith('--out-dir=')) continue;
    result.push(item);
  }
  return result;
}
