#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  createSharpBreathingRoomComparison,
  sharpBreathingRoomComparisonProfiles,
} from '../lib/sharp-breathing-room-comparison.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const value = process.argv[i + 1];
  if (value && !value.startsWith('--')) {
    args.set(key, value);
    i += 1;
  } else {
    args.set(key, '1');
  }
}

const manifest = resolve(args.get('--manifest') || 'pipelines/asset-pipelines.json');
const witness = resolve(args.get('--witness') || 'pipeline-witness.mjs');
const input = args.get('--input') ? resolve(args.get('--input')) : null;
const outDir = args.get('--out-dir') ? resolve(args.get('--out-dir')) : null;
const report = args.get('--report') ? resolve(args.get('--report')) : null;
const pipelineId = args.get('--pipeline-id') || 'sharp-image-to-splat-live-v0';
const routeId = args.get('--route-id') || 'adapter.sharp-image-to-splat-live.v0';
const flameBudget = parseJsonObject(args.get('--flame-budget') || process.env.KAMINOS_SHARP_BREATHING_ROOM_FLAME_BUDGET);

function parseJsonObject(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function inputEvidence(path) {
  if (!path || !existsSync(path)) return path ? { path, status: 'missing' } : null;
  const stat = statSync(path);
  return {
    path,
    bytes: stat.size,
    sha256: sha256File(path),
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(message, extra = {}) {
  if (report) {
    writeJson(report, {
      schema: 'kaminos.sharp-breathing-room-comparison-failure.v0',
      ok: false,
      phase: extra.phase || 'failed',
      error: message,
      requestedPipelineId: pipelineId,
      routeId,
      input: inputEvidence(input),
      profiles: sharpBreathingRoomComparisonProfiles(),
      ...extra,
    });
  }
  console.error(message);
  process.exit(1);
}

if (!input || !outDir || !report) fail('expected --input, --out-dir, and --report', { phase: 'validating-arguments' });
if (!existsSync(input)) fail(`input does not exist: ${input}`, { phase: 'validating-input' });
if (!existsSync(witness)) fail(`pipeline witness does not exist: ${witness}`, { phase: 'validating-witness' });
if (!existsSync(manifest)) fail(`pipeline manifest does not exist: ${manifest}`, { phase: 'validating-manifest' });
mkdirSync(outDir, { recursive: true });

const profiles = sharpBreathingRoomComparisonProfiles().profiles;
const runs = [];
for (const profile of profiles) {
  const profileOutDir = join(outDir, profile.id);
  const profileReport = join(profileOutDir, 'pipeline-witness.json');
  mkdirSync(profileOutDir, { recursive: true });
  const env = {
    ...process.env,
    ...profile.env,
    KAMINOS_PIPELINE_ID: pipelineId,
    KAMINOS_PIPELINE_ROUTE_ID: routeId,
  };
  const proc = spawnSync(process.execPath, [
    witness,
    '--manifest', manifest,
    '--pipeline-id', pipelineId,
    '--input', input,
    '--out-dir', profileOutDir,
    '--report', profileReport,
  ], {
    encoding: 'utf8',
    env,
  });
  if (proc.status !== 0) {
    fail(`SHARP breathing-room profile ${profile.id} failed via pipeline witness`, {
      phase: 'running-profile',
      failedProfileId: profile.id,
      stdoutTail: proc.stdout.slice(-4000),
      stderrTail: proc.stderr.slice(-4000),
      witnessReportPath: profileReport,
      witnessReport: existsSync(profileReport) ? readJson(profileReport) : null,
      completedRuns: runs,
    });
  }
  runs.push({
    profileId: profile.id,
    profileLabel: profile.label,
    witnessReportPath: profileReport,
    witnessReport: readJson(profileReport),
  });
}

const comparison = createSharpBreathingRoomComparison({
  requestedPipelineId: pipelineId,
  routeId,
  input: inputEvidence(input),
  flameBudget,
  runs,
  notes: [
    'This runner emits the Pipeline SHARP-side default/cooperative bridge. Wake live flame contention evidence must be attached by the flame harness before claiming a valid flame smoke.',
  ],
});
writeJson(report, comparison);
