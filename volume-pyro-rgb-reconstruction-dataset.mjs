#!/usr/bin/env node
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const DATASET_SCHEMA = 'kaminos.volume.pyro-rgb-reconstruction-dataset.v0';
const DATASET_IDENTITY = 'pyro-rgb-reconstruction-sequential-capture-dataset-v0';
const EXPECTED_VOLUME_ROUTE_ID = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_PROTOTYPE_ID = 'kaminos-volume-prototype-v0';
const PAIR_AUTHORITY = 'sequential-route-captures-not-frame-locked';
const DEBUG_FLOW_PYRO_CARRIER_IDENTITY = 'debug-flow-pyro-fire-authority-carrier-v0';
const LOW_CARRIER_INPUT_ROLE = 'lowCarrierInput';
const RGB_TARGET_ROLE = 'rgbTarget';
const DEFAULT_BASE_URL = 'http://127.0.0.1:8099/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=pyro_flow_small_bonfire_gamut_0707&volume_resolution=48&volume_majorant_grid=24&volume_steps=128&volume_adaptive_rays=0.75&volume_density=6&volume_fire=0&volume_smoke=2.8&volume_curl=3.5&volume_speed=5&volume_input_radius=0.19&volume_flow_rate=0.85&volume_pressure_strategy=global&volume_pressure_iterations=3&volume_majorant_cadence=1&volume_render_scale=0.75&volume_flow_debug=1&volume_pyro_flow_bite=3&volume_pyro_flow_radiance=4&volume_pyro_flow_spikes=1';

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

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integerParam(value, fallback) {
  const number = Math.round(finiteNumber(value, fallback));
  return Math.max(1, number);
}

function boolParam(value, fallback) {
  if (value === true) return true;
  if (value === false) return false;
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function gitValue(cwd, args, fallback = null) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function scalarActivitySourceName(route) {
  return route.searchParams.get('volume_oracle_activity_source') || 'none';
}

function normalizeRoute(baseUrl, overrides) {
  const url = new URL(baseUrl);
  url.searchParams.set('kaminos_volume_smoke', '1');
  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function routeIdentity(route) {
  return {
    volumeResolution: integerParam(route.searchParams.get('volume_resolution'), 0),
    majorantGrid: integerParam(route.searchParams.get('volume_majorant_grid'), 0),
    renderScale: finiteNumber(route.searchParams.get('volume_render_scale'), null),
    flowDebug: finiteNumber(route.searchParams.get('volume_flow_debug'), null),
    pyroFlowBite: finiteNumber(route.searchParams.get('volume_pyro_flow_bite'), null),
    pyroFlowRadiance: finiteNumber(route.searchParams.get('volume_pyro_flow_radiance'), null),
    pyroFlowSpikes: finiteNumber(route.searchParams.get('volume_pyro_flow_spikes'), null),
    scalarActivitySource: scalarActivitySourceName(route),
  };
}

function buildRoutes(args) {
  const inputResolution = integerParam(args.get('--input-resolution'), 48);
  const targetResolution = integerParam(args.get('--target-resolution'), 96);
  const inputMajorantGrid = integerParam(args.get('--input-majorant-grid'), Math.max(8, Math.round(inputResolution / 2)));
  const targetMajorantGrid = integerParam(args.get('--target-majorant-grid'), Math.max(8, Math.round(targetResolution / 2)));
  const inputRenderScale = finiteNumber(args.get('--input-render-scale'), 0.75);
  const targetRenderScale = finiteNumber(args.get('--target-render-scale'), 0.75);
  const inputFlowDebug = boolParam(args.get('--input-flow-debug'), true) ? 1 : 0;
  const targetFlowDebug = boolParam(args.get('--target-flow-debug'), false) ? 1 : 0;
  const baseUrl = args.get('--base-url') || DEFAULT_BASE_URL;
  const inputUrl = args.get('--input-url') || normalizeRoute(baseUrl, {
    volume_resolution: inputResolution,
    volume_majorant_grid: inputMajorantGrid,
    volume_render_scale: inputRenderScale,
    volume_flow_debug: inputFlowDebug,
  }).toString();
  const targetUrl = args.get('--target-url') || normalizeRoute(baseUrl, {
    volume_resolution: targetResolution,
    volume_majorant_grid: targetMajorantGrid,
    volume_render_scale: targetRenderScale,
    volume_flow_debug: targetFlowDebug,
  }).toString();
  return {
    baseUrl,
    inputUrl,
    targetUrl,
    inputRouteIdentity: routeIdentity(new URL(inputUrl)),
    targetRouteIdentity: routeIdentity(new URL(targetUrl)),
  };
}

function makeCapturePlan({ role, route, outDir, debugPort, settleMs, windowSize, evidenceMode }) {
  const slug = role.replace(/[^a-z0-9_-]/gi, '-');
  const out = resolve(outDir, `${slug}.png`);
  const report = resolve(outDir, `${slug}.json`);
  const fullScreenshot = resolve(outDir, `${slug}.full.png`);
  const stdout = resolve(outDir, `${slug}.stdout.log`);
  const stderr = resolve(outDir, `${slug}.stderr.log`);
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
    requestedRoute: route,
    out,
    report,
    fullScreenshot,
    stdout,
    stderr,
    command,
  };
}

function witnessTiming(witness) {
  return {
    frameCount: witness.frameCount,
    simStepCount: witness.simStepCount,
    timingEvidenceSource: witness.timingEvidenceSource,
    timingDisclaimer: witness.timingDisclaimer,
    timing: witness.timing || null,
    simCostLedger: witness.simCostLedger || null,
  };
}

function validateCapture(plan, expectedRouteIdentity) {
  const witness = readJson(plan.report);
  if (witness.effectiveRoute !== EXPECTED_VOLUME_ROUTE_ID) {
    const error = new Error(`wrong-fallback-route: expected ${EXPECTED_VOLUME_ROUTE_ID}, got ${witness.effectiveRoute || 'none'}`);
    error.code = 'wrong-fallback-route';
    error.failurePhase = 'validation';
    error.details = { role: plan.role, expected: EXPECTED_VOLUME_ROUTE_ID, effective: witness.effectiveRoute, report: plan.report };
    throw error;
  }
  if (witness.prototypeIdentity !== EXPECTED_PROTOTYPE_ID) {
    const error = new Error(`absent-effective-identity: expected ${EXPECTED_PROTOTYPE_ID}, got ${witness.prototypeIdentity || 'none'}`);
    error.code = 'absent-effective-identity';
    error.failurePhase = 'validation';
    error.details = { role: plan.role, expected: EXPECTED_PROTOTYPE_ID, effective: witness.prototypeIdentity, report: plan.report };
    throw error;
  }
  const controls = witness.controls || {};
  const effectiveResolution = Number(controls.resolution ?? controls.volumeResolution);
  if (Number.isFinite(expectedRouteIdentity.volumeResolution) && expectedRouteIdentity.volumeResolution > 0 && effectiveResolution !== expectedRouteIdentity.volumeResolution) {
    const error = new Error(`stale-default-config: requested volume_resolution ${expectedRouteIdentity.volumeResolution}, got ${effectiveResolution || 'none'}`);
    error.code = 'stale-default-config';
    error.failurePhase = 'validation';
    error.details = { role: plan.role, requested: expectedRouteIdentity.volumeResolution, effective: effectiveResolution, report: plan.report };
    throw error;
  }
  if (!Number.isFinite(Number(witness.frameCount)) || Number(witness.frameCount) < 1 || !witness.renderWidth || !witness.renderHeight) {
    const error = new Error('missing-primary-output: witness did not report rendered frame dimensions');
    error.code = 'missing-primary-output';
    error.failurePhase = 'validation';
    error.details = { role: plan.role, frameCount: witness.frameCount, renderWidth: witness.renderWidth, renderHeight: witness.renderHeight, report: plan.report };
    throw error;
  }
  return {
    role: plan.role,
    path: plan.out,
    fullScreenshot: plan.fullScreenshot,
    report: plan.report,
    requestedRoute: plan.requestedRoute,
    requestedRouteIdentity: expectedRouteIdentity,
    effectiveRoute: witness.effectiveRoute,
    prototypeIdentity: witness.prototypeIdentity,
    backend: witness.backend,
    renderWidth: witness.renderWidth,
    renderHeight: witness.renderHeight,
    displayWidth: witness.displayWidth,
    displayHeight: witness.displayHeight,
    renderPixelRatio: witness.renderPixelRatio,
    volumeReconstructionStyle: witness.volumeReconstructionStyle,
    controls,
    scalarActivityReceiver: witness.scalarActivityReceiver || null,
    scalarActivityCueProjection: witness.scalarActivityCueProjection || null,
    hiddenScalarActivitySource: witness.hiddenScalarActivitySource || null,
    timing: witnessTiming(witness),
    performanceVisualWarnings: witness.performanceVisualWarnings || [],
  };
}

function runCapture(plan, cwd, expectedRouteIdentity) {
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
    const error = new Error(`capture failed for ${plan.role}`);
    error.code = 'capture-failed';
    error.failurePhase = 'capture';
    error.details = {
      role: plan.role,
      status: child.status,
      signal: child.signal,
      spawnError: child.error ? { name: child.error.name, message: child.error.message, code: child.error.code } : null,
      stdout: plan.stdout,
      stderr: plan.stderr,
      report: plan.report,
    };
    throw error;
  }
  return validateCapture(plan, expectedRouteIdentity);
}

const args = parseArgs(process.argv.slice(2));
const cwd = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-pyro-rgb-reconstruction-dataset');
const manifestPath = resolve(args.get('--manifest') || `${outDir}/manifest.json`);
const settleMs = finiteNumber(args.get('--settle-ms'), 5000);
const windowSize = String(args.get('--window-size') || '960,720');
const debugPort = integerParam(args.get('--debug-port'), 9800);
const evidenceMode = String(args.get('--evidence-mode') || 'performance');
const dryRun = args.has('--dry-run');
const createdAt = new Date().toISOString();
const routes = buildRoutes(args);
const captureDir = resolve(outDir, 'captures');

const lowCarrierInput = makeCapturePlan({
  role: LOW_CARRIER_INPUT_ROLE,
  route: routes.inputUrl,
  outDir: captureDir,
  debugPort,
  settleMs,
  windowSize,
  evidenceMode,
});
const rgbTarget = makeCapturePlan({
  role: RGB_TARGET_ROLE,
  route: routes.targetUrl,
  outDir: captureDir,
  debugPort: debugPort + 1,
  settleMs,
  windowSize,
  evidenceMode,
});

const manifest = {
  schema: DATASET_SCHEMA,
  identity: DATASET_IDENTITY,
  status: dryRun ? 'dry-run' : 'running',
  createdAt,
  updatedAt: createdAt,
  cwd,
  gitCommit: gitValue(cwd, ['rev-parse', 'HEAD']),
  gitBranch: gitValue(cwd, ['branch', '--show-current']),
  gitStatusShort: gitValue(cwd, ['status', '--short'], ''),
  outDir,
  manifestPath,
  dryRun,
  pairAuthority: PAIR_AUTHORITY,
  limitation: 'Sequential route captures are not frame-locked. Use this for visual RGB reconstruction evidence and basin comparison, not exact timestep-supervised truth unless a later same-state capture hook proves frame custody.',
  carrierIdentity: DEBUG_FLOW_PYRO_CARRIER_IDENTITY,
  carrierInputRole: LOW_CARRIER_INPUT_ROLE,
  rgbTargetRole: RGB_TARGET_ROLE,
  visualEvidenceMode: 'low/debug-flow-pyro-carrier-to-higher-resolution-rgb-reference',
  sourceCarrierFields: [
    'volume_flow_debug',
    'volume_pyro_flow_bite',
    'volume_pyro_flow_radiance',
    'volume_pyro_flow_spikes',
    'fire-authority-gated-pyro-flow-carriers',
  ],
  routes,
  settleMs,
  windowSize,
  evidenceMode,
  captures: {
    [LOW_CARRIER_INPUT_ROLE]: lowCarrierInput,
    [RGB_TARGET_ROLE]: rgbTarget,
  },
  failures: [],
};

writeJson(manifestPath, { dataset: manifest });

if (!dryRun) {
  try {
    manifest.captures[LOW_CARRIER_INPUT_ROLE].effective = runCapture(lowCarrierInput, cwd, routes.inputRouteIdentity);
    manifest.updatedAt = new Date().toISOString();
    writeJson(manifestPath, { dataset: manifest });
    manifest.captures[RGB_TARGET_ROLE].effective = runCapture(rgbTarget, cwd, routes.targetRouteIdentity);
    manifest.status = 'captured';
  } catch (error) {
    manifest.status = 'failed';
    manifest.failurePhase = error.failurePhase || 'unknown';
    manifest.failures.push({
      code: error.code || 'capture-failed',
      failurePhase: error.failurePhase || 'unknown',
      message: error.message,
      details: error.details || {},
    });
  } finally {
    manifest.updatedAt = new Date().toISOString();
    writeJson(manifestPath, { dataset: manifest });
  }
}

console.log(JSON.stringify({ dataset: manifest }, null, 2));
if (manifest.failures.length) process.exit(1);
