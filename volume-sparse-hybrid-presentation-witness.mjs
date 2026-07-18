#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateSparseHybridPresentationReport } from './volume-sparse-hybrid-presentation-report.mjs';

const ORBIT_IDENTITY = '21-camera-frozen-orbit-v0';
const CONCLUSION_SCOPE = 'presentation-only-no-self-transmittance-claim-v0';
const SCALE_LADDER = [0.20, 0.15, 0.10, 0.075, 0.05];
const args = parseArgs(process.argv.slice(2));
const reportPath = resolve(String(args.get('--report') || ''));

if (!reportPath || !existsSync(reportPath)) {
  fail('missing --report for the completed sparse hybrid presentation assay');
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  fail(`cannot read report: ${error.message}`);
}

const validation = validateSparseHybridPresentationReport(report);
if (!validation.ok) fail(`false-closure validation failed: ${validation.errors.join(', ')}`);
if (report.orbit.identity !== ORBIT_IDENTITY) fail('orbit identity substitution');
if (report.conclusionScope !== CONCLUSION_SCOPE) fail('conclusion scope substitution');
if (!SCALE_LADDER.includes(Number(report.resolution.requestedRaymarchScale))) fail('raymarch scale is outside the planned assay ladder');

const mediaPaths = [report.orbit.dynamicWitnessPath, ...report.orbit.nativeFramePaths].map(path => resolve(path));
for (const path of mediaPaths) {
  if (!existsSync(path) || statSync(path).size === 0) fail(`missing or blank witness artifact: ${path}`);
}

const frameCount = probeVideoFrames(resolve(report.orbit.dynamicWitnessPath));
if (frameCount !== 21) fail(`dynamic witness is partial: expected 21 frames, found ${frameCount}`);

console.log(JSON.stringify({
  ok: true,
  report: reportPath,
  treatmentIdentity: report.treatmentIdentity,
  conclusionScope: report.conclusionScope,
  requestedRaymarchScale: report.resolution.requestedRaymarchScale,
  effectiveRaymarchScale: report.resolution.effectiveRaymarchScale,
  orbitIdentity: report.orbit.identity,
  videoFrameCount: frameCount,
  artifacts: mediaPaths.map(path => ({ path, bytes: statSync(path).size, sha256: sha256(readFileSync(path)) })),
}, null, 2));

function probeVideoFrames(path) {
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-count_frames',
    '-show_entries', 'stream=nb_read_frames',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    path,
  ], { encoding: 'utf8' });
  if (result.error) fail(`ffprobe unavailable: ${result.error.message}`);
  if (result.status !== 0) fail(`ffprobe failed: ${result.stderr.trim()}`);
  return Number.parseInt(result.stdout.trim(), 10);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed.set(token, next);
      index += 1;
    } else {
      parsed.set(token, true);
    }
  }
  return parsed;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

