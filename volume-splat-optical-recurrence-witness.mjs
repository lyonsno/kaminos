#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSplatOpticalCockpitManifest,
  validateSplatOpticalCockpitManifest,
  validateSplatOpticalRecurrenceReport,
  writeSplatOpticalRecurrenceFailureReport,
} from './volume-splat-optical-recurrence-contract.mjs';

const PRESENTATION_ARM = 'matched-presentation-v0';
const OPTICAL_ARM = 'matched-optical-recurrence-v0';
const argv = process.argv.slice(2);
const outDir = resolve(readOption(argv, '--out-dir') || '/tmp/kaminos-splat-optical-recurrence');
const reportPath = resolve(readOption(argv, '--report') || `${outDir}/optical-recurrence-report.json`);
const manifestPath = resolve(readOption(argv, '--manifest') || `${outDir}/pyro-cockpit-manifest.json`);
const fullReportPath = resolve(readOption(argv, '--full-report') || `${outDir}/full-orbit-report.json`);
const authoredForkOutputPath = readOption(argv, '--authored-fork-output')
  || 'authored-forks/matched-optical-recurrence.json';
const requestedUrl = readOption(argv, '--url');
let failurePhase = 'delegate-launch';
let lastTrustworthyEvidence = {
  requestedArms: [PRESENTATION_ARM, OPTICAL_ARM],
  reportPath,
  manifestPath,
  fullReportPath,
};

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });
mkdirSync(dirname(manifestPath), { recursive: true });

try {
  failurePhase = 'route-preflight';
  if (!requestedUrl) throw new Error('optical recurrence witness requires --url');
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

  const forwarded = stripOptions(argv, new Set([
    '--report',
    '--manifest',
    '--full-report',
    '--authored-fork-output',
    '--optical-recurrence-report',
  ]));
  failurePhase = 'delegate-orbit-capture';
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('./volume-raymarch-filament-orbit-witness.mjs', import.meta.url)),
    ...forwarded,
    '--out-dir', outDir,
    '--report', fullReportPath,
    '--optical-recurrence-report', reportPath,
  ], { cwd: process.cwd(), stdio: 'inherit' });
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    delegateStatus: result.status,
    delegateSignal: result.signal,
    fullReportExists: existsSync(fullReportPath),
    opticalReportExists: existsSync(reportPath),
  };
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`optical recurrence delegate failed with status ${result.status}${result.signal ? ` signal ${result.signal}` : ''}`);

  failurePhase = 'false-closure-validation';
  if (!existsSync(reportPath)) throw new Error('delegate completed without an optical recurrence report');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  validateSplatOpticalRecurrenceReport(report);
  lastTrustworthyEvidence.completedReport = artifact(reportPath, dirname(manifestPath));

  failurePhase = 'dynamic-witness-encoding';
  const presentationCaptures = report.arms.find(arm => arm.id === PRESENTATION_ARM).captures;
  const opticalCaptures = report.arms.find(arm => arm.id === OPTICAL_ARM).captures;
  const media = [
    encodeOrbitMedia('presentation', presentationCaptures),
    encodeOrbitMedia('optical', opticalCaptures),
  ];
  const artifacts = media.flatMap(({ id, route, videoPath, sheetPath }) => [
    { id: id === 'presentation' ? 'original-presentation' : 'matched-optical', ...artifact(videoPath, dirname(manifestPath)), mediaType: 'video/mp4', loadRoute: route },
    { id: `${id}-contact-sheet`, ...artifact(sheetPath, dirname(manifestPath)), mediaType: 'image/png', loadRoute: route },
  ]);
  lastTrustworthyEvidence.encodedArtifacts = artifacts;

  failurePhase = 'manifest-validation';
  const manifest = buildSplatOpticalCockpitManifest({ report, artifacts, authoredForkOutputPath });
  validateSplatOpticalCockpitManifest(manifest);
  atomicWriteJson(manifestPath, manifest);
  lastTrustworthyEvidence.completedManifest = artifact(manifestPath, dirname(manifestPath));
  failurePhase = null;
  console.log(JSON.stringify({
    status: report.status,
    report: reportPath,
    manifest: manifestPath,
    fullReport: fullReportPath,
    arms: report.arms.map(arm => ({ id: arm.id, captures: arm.captures.length })),
    artifacts,
  }, null, 2));
} catch (error) {
  const failure = {
    schema: 'kaminos.volume.splat-optical-recurrence.v0',
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    lastTrustworthyEvidence,
  };
  const writtenFailure = writeSplatOpticalRecurrenceFailureReport(reportPath, failure);
  writeFailureManifest(manifestPath, failure);
  console.error(JSON.stringify(writtenFailure, null, 2));
  process.exitCode = 1;
}

function encodeOrbitMedia(id, captures) {
  const route = id === 'presentation' ? PRESENTATION_ARM : OPTICAL_ARM;
  const imagePaths = captures.map(capture => resolve(capture.imagePath));
  if (imagePaths.length !== 21 || new Set(imagePaths).size !== 21 || imagePaths.some(path => !existsSync(path))) {
    throw new Error(`${id} media input is missing, partial, or duplicated`);
  }
  const concatPath = resolve(outDir, `${id}-current-captures.ffconcat`);
  writeFileSync(concatPath, `ffconcat version 1.0\n${imagePaths.map(path => `file '${escapeConcatPath(path)}'`).join('\n')}\n`);
  const videoPath = resolve(outDir, `${id}-orbit.mp4`);
  const sheetPath = resolve(outDir, `${id}-contact-sheet.png`);
  runFfmpeg([
    '-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-r', '6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath,
  ]);
  runFfmpeg([
    '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
    '-vf', 'tile=7x3', '-frames:v', '1', sheetPath,
  ]);
  return { id, route, videoPath, sheetPath };
}

function escapeConcatPath(path) {
  return path.replaceAll("'", "'\\''");
}

function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg failed with status ${result.status}`);
}

function artifact(path, relativeTo) {
  const bytes = readFileSync(path);
  const relativePath = relative(relativeTo, path);
  return {
    path: relativePath && !relativePath.startsWith('..') ? relativePath : basename(path),
    bytes: statSync(path).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function writeFailureManifest(path, failure) {
  const priorBytes = existsSync(path) ? readFileSync(path) : null;
  atomicWriteJson(path, {
    schema: 'kaminos.pyro-cockpit-manifest.v0',
    status: 'failed',
    failurePhase: failure.failurePhase,
    error: failure.error,
    lastTrustworthyEvidence: {
      ...(failure.lastTrustworthyEvidence || {}),
      ...(priorBytes ? {
        displacedPrimaryManifest: {
          path,
          byteLength: priorBytes.byteLength,
          sha256: createHash('sha256').update(priorBytes).digest('hex'),
        },
      } : {}),
    },
  });
}

function atomicWriteJson(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
  renameSync(temporaryPath, path);
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
    if ([...names].some(name => item.startsWith(`${name}=`))) continue;
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
