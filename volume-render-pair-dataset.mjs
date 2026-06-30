#!/usr/bin/env node
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const DATASET_SCHEMA = 'kaminos.volume.render-pair-dataset.v0';
const EXPECTED_VOLUME_ROUTE_ID = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE_ID = 'kaminos-volume-prototype-v0';
const PAIR_AUTHORITY = 'route-paired-sequential-captures-not-frame-locked';
const DEFAULT_BASE_URL = 'http://127.0.0.1:8097/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=operator_fire_0622&volume_resolution=128&volume_majorant_grid=48&volume_steps=148&volume_adaptive_rays=0.75&volume_density=3.05&volume_fire=0.50&volume_radiance=3&volume_absorption=0&volume_glow=2.5&volume_smoke=2.8&volume_curl=3.5&volume_microdetail=2.5&volume_interface_shred=0&volume_fire_licks=0&volume_projection=1.5&volume_speed=5&volume_fire_scale=0.59&volume_detail_scale=0.45&volume_plume_height=2.2&volume_wind_strength=0&volume_wind_angle=180&volume_wind_height=-0.8&volume_input_radius=0.11&volume_flow_rate=0.35&volume_reaction_fuel=1&volume_majorant_cadence=1&volume_pressure_iterations=2&volume_pressure_strategy=global&volume_sim_profile=1&volume_temporal_accum=0&volume_temporal_jitter=0&volume_history_clamp=1&volume_occupancy_skip=0.1&volume_majorant_skip=0&volume_majorant_smooth=0.1&volume_majorant_guard=0.3';

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

function numberList(value, fallback) {
  const source = String(value || fallback).split(',');
  const numbers = source
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
  return numbers.length ? numbers : String(fallback).split(',').map(Number);
}

function clampRenderScale(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return 0.25;
  return Math.max(0.1, Math.min(1, requested));
}

function scaleSlug(value) {
  return `rs${String(Math.round(clampRenderScale(value) * 100)).padStart(3, '0')}`;
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function gitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function routeWithRenderScale(baseUrl, renderScale) {
  const url = new URL(baseUrl);
  url.searchParams.set('kaminos_volume_smoke', '1');
  url.searchParams.set('volume_render_scale', String(clampRenderScale(renderScale)));
  return url.toString();
}

function makeCapturePlan({ pairId, role, renderScale, route, pairDir, debugPort, settleMs, windowSize, evidenceMode }) {
  const slug = `${pairId}-${role}-${scaleSlug(renderScale)}`;
  const out = resolve(pairDir, `${slug}.png`);
  const report = resolve(pairDir, `${slug}.json`);
  const fullScreenshot = resolve(pairDir, `${slug}.full.png`);
  const stdout = resolve(pairDir, `${slug}.stdout.log`);
  const stderr = resolve(pairDir, `${slug}.stderr.log`);
  const command = [
    process.execPath,
    'volume-witness.mjs',
    '--url', route,
    '--out', out,
    '--report', report,
    '--full-screenshot', fullScreenshot,
    '--debug-port', String(debugPort),
    '--settle-ms', String(settleMs),
    '--window-size', windowSize,
    '--evidence-mode', evidenceMode,
  ];
  return {
    role,
    requestedRenderScale: clampRenderScale(renderScale),
    route,
    out,
    report,
    fullScreenshot,
    stdout,
    stderr,
    command,
  };
}

function validateCapture(plan) {
  const witness = readJson(plan.report);
  const effectiveRoute = witness.effectiveRoute;
  const prototypeIdentity = witness.prototypeIdentity;
  const renderScale = Number(witness.renderScale);
  if (effectiveRoute !== EXPECTED_VOLUME_ROUTE_ID) {
    const error = new Error(`wrong-fallback-route: expected ${EXPECTED_VOLUME_ROUTE_ID}, got ${effectiveRoute || 'none'}`);
    error.code = 'wrong-fallback-route';
    error.failurePhase = 'validation';
    error.details = { expected: EXPECTED_VOLUME_ROUTE_ID, effective: effectiveRoute, report: plan.report };
    throw error;
  }
  if (prototypeIdentity !== EXPECTED_PROTOTYPE_ID) {
    const error = new Error(`absent-effective-identity: expected ${EXPECTED_PROTOTYPE_ID}, got ${prototypeIdentity || 'none'}`);
    error.code = 'absent-effective-identity';
    error.failurePhase = 'validation';
    error.details = { expected: EXPECTED_PROTOTYPE_ID, effective: prototypeIdentity, report: plan.report };
    throw error;
  }
  if (!Number.isFinite(renderScale) || Math.abs(renderScale - plan.requestedRenderScale) > 0.015) {
    const error = new Error(`stale-default-config: requested renderScale ${plan.requestedRenderScale}, got ${witness.renderScale}`);
    error.code = 'stale-default-config';
    error.failurePhase = 'validation';
    error.details = { requested: plan.requestedRenderScale, effective: witness.renderScale, report: plan.report };
    throw error;
  }
  if (!witness.volumeReconstructionStyle || !Number.isFinite(Number(witness.renderPixelRatio))) {
    const error = new Error('missing-primary-report: witness did not preserve reconstruction style and render pixel ratio');
    error.code = 'missing-primary-report';
    error.failurePhase = 'validation';
    error.details = {
      volumeReconstructionStyle: witness.volumeReconstructionStyle,
      renderPixelRatio: witness.renderPixelRatio,
      report: plan.report,
    };
    throw error;
  }
  return {
    path: plan.out,
    fullScreenshot: plan.fullScreenshot,
    report: plan.report,
    requestedRenderScale: plan.requestedRenderScale,
    renderScale,
    renderPixelRatio: witness.renderPixelRatio,
    renderWidth: witness.renderWidth,
    renderHeight: witness.renderHeight,
    displayWidth: witness.displayWidth,
    displayHeight: witness.displayHeight,
    volumeReconstructionStyle: witness.volumeReconstructionStyle,
    effectiveRoute,
    prototypeIdentity,
    backend: witness.backend,
    frameCount: witness.frameCount,
    simStepCount: witness.simStepCount,
    performanceVisualWarnings: witness.performanceVisualWarnings || [],
    timingEvidenceSource: witness.timingEvidenceSource,
    timingDisclaimer: witness.timingDisclaimer,
    simCostLedger: witness.simCostLedger || null,
  };
}

function runCapture(plan, cwd) {
  mkdirSync(dirname(plan.out), { recursive: true });
  const stdoutFd = openSync(plan.stdout, 'w');
  const stderrFd = openSync(plan.stderr, 'w');
  let child;
  try {
    child = spawnSync(plan.command[0], plan.command.slice(1), {
      cwd,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  if (child.status !== 0) {
    const error = new Error(`capture failed for ${plan.role} renderScale ${plan.requestedRenderScale}`);
    error.code = 'capture-failed';
    error.failurePhase = 'capture';
    error.details = {
      status: child.status,
      signal: child.signal,
      spawnError: child.error ? { name: child.error.name, message: child.error.message, code: child.error.code } : null,
      stdout: plan.stdout,
      stderr: plan.stderr,
      report: plan.report,
    };
    throw error;
  }
  return validateCapture(plan);
}

const args = parseArgs(process.argv.slice(2));
const cwd = new URL('.', import.meta.url).pathname;
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-render-pair-dataset');
const manifestPath = resolve(args.get('--manifest') || `${outDir}/manifest.json`);
const baseUrl = args.get('--base-url') || DEFAULT_BASE_URL;
const lowRenderScales = numberList(args.get('--low-render-scales') || args.get('--low-render-scale'), '0.25').map(clampRenderScale);
const highRenderScale = clampRenderScale(args.get('--high-render-scale') || 1);
const settleMs = Number(args.get('--settle-ms') || 8000);
const windowSize = String(args.get('--window-size') || '1280,960');
const debugPort = Number(args.get('--debug-port') || 9600);
const evidenceMode = String(args.get('--evidence-mode') || 'performance');
const dryRun = args.has('--dry-run');
const createdAt = new Date().toISOString();
const gitCommit = gitValue(['rev-parse', 'HEAD']);
const gitBranch = gitValue(['branch', '--show-current']);
const gitStatusShort = gitValue(['status', '--short'], '');
const pairs = lowRenderScales.map((lowRenderScale, index) => {
  const pairId = `pair-${String(index + 1).padStart(3, '0')}-${scaleSlug(lowRenderScale)}-to-${scaleSlug(highRenderScale)}`;
  const pairDir = resolve(outDir, pairId);
  const lowRoute = routeWithRenderScale(baseUrl, lowRenderScale);
  const highRoute = routeWithRenderScale(baseUrl, highRenderScale);
  return {
    pairId,
    pairAuthority: PAIR_AUTHORITY,
    lowRenderScale,
    highRenderScale,
    low: makeCapturePlan({
      pairId,
      role: 'low',
      renderScale: lowRenderScale,
      route: lowRoute,
      pairDir,
      debugPort: debugPort + index * 2,
      settleMs,
      windowSize,
      evidenceMode,
    }),
    high: makeCapturePlan({
      pairId,
      role: 'high',
      renderScale: highRenderScale,
      route: highRoute,
      pairDir,
      debugPort: debugPort + index * 2 + 1,
      settleMs,
      windowSize,
      evidenceMode,
    }),
  };
});

const manifest = {
  schema: DATASET_SCHEMA,
  status: dryRun ? 'dry-run' : 'running',
  createdAt,
  updatedAt: createdAt,
  cwd,
  gitCommit,
  gitBranch,
  gitStatusShort,
  baseUrl,
  outDir,
  manifestPath,
  dryRun,
  pairAuthority: PAIR_AUTHORITY,
  limitation: 'Pairs share route identity and requested controls but are sequential captures; do not treat them as frame-locked supervised pairs.',
  lowRenderScales,
  lowRenderScale: lowRenderScales[0],
  highRenderScale,
  settleMs,
  windowSize,
  evidenceMode,
  pairs,
  failures: [],
};

writeJson(manifestPath, { dataset: manifest });

if (!dryRun) {
  for (const pair of manifest.pairs) {
    try {
      pair.high.effective = runCapture(pair.high, cwd);
      pair.low.effective = runCapture(pair.low, cwd);
      pair.status = 'captured';
    } catch (error) {
      pair.status = 'failed';
      const failure = {
        pairId: pair.pairId,
        code: error.code || 'capture-failed',
        failurePhase: error.failurePhase || 'unknown',
        message: error.message,
        details: error.details || {},
      };
      pair.failure = failure;
      manifest.failures.push(failure);
      break;
    } finally {
      manifest.updatedAt = new Date().toISOString();
      manifest.status = manifest.failures.length ? 'failed' : 'running';
      writeJson(manifestPath, { dataset: manifest });
    }
  }
  if (!manifest.failures.length) {
    manifest.status = 'captured';
    manifest.updatedAt = new Date().toISOString();
    writeJson(manifestPath, { dataset: manifest });
  }
}

console.log(JSON.stringify({ dataset: manifest }, null, 2));
if (manifest.failures.length) process.exit(1);
