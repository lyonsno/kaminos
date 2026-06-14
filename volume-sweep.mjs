#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, true);
  }
}

const baseUrl = args.get('--base-url') || 'http://127.0.0.1:8097/?kaminos_volume_smoke=1';
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-volume-sweep');
const aggregatePath = resolve(args.get('--aggregate') || `${outDir}/aggregate.json`);
const settleMs = Number(args.get('--settle-ms') || 8000);
const windowSize = args.get('--window-size') || '1280,960';
const debugPort = Number(args.get('--debug-port') || 9500);
const matrixMode = args.get('--matrix') || 'compact';
const dryRun = args.has('--dry-run');

const COMPACT_MATRIX_SCENARIOS = [
  {
    id: 'draft-fast',
    label: 'Draft Fast',
    simGrid: 96,
    majorantGrid: 48,
    raySteps: 64,
    renderScale: 0.75,
    adaptiveRays: 0.80,
    occupancySkip: 0.60,
    majorantSkip: 0.68,
    majorantSmooth: 0.70,
    majorantGuard: 0.70,
    temporalAccum: 0.30,
    temporalJitter: 0.45,
    historyClamp: 0.70,
  },
  {
    id: 'live-balanced',
    label: 'Live Balanced',
    simGrid: 96,
    majorantGrid: 48,
    raySteps: 96,
    renderScale: 0.85,
    adaptiveRays: 0.65,
    occupancySkip: 0.45,
    majorantSkip: 0.60,
    majorantSmooth: 0.80,
    majorantGuard: 0.75,
    temporalAccum: 0.35,
    temporalJitter: 0.40,
    historyClamp: 0.70,
  },
  {
    id: 'rich-fullscreen',
    label: 'Rich Fullscreen',
    simGrid: 128,
    majorantGrid: 48,
    raySteps: 120,
    renderScale: 0.85,
    adaptiveRays: 0.50,
    occupancySkip: 0.30,
    majorantSkip: 0.45,
    majorantSmooth: 0.80,
    majorantGuard: 0.80,
    temporalAccum: 0.30,
    temporalJitter: 0.30,
    historyClamp: 0.80,
  },
  {
    id: 'hero-reference',
    label: 'Hero Reference',
    simGrid: 128,
    majorantGrid: 48,
    raySteps: 160,
    renderScale: 1.0,
    adaptiveRays: 0.30,
    occupancySkip: 0.20,
    majorantSkip: 0.30,
    majorantSmooth: 0.85,
    majorantGuard: 0.85,
    temporalAccum: 0.10,
    temporalJitter: 0.20,
    historyClamp: 0.90,
  },
  {
    id: 'hand-trail-live',
    label: 'Hand Trail Live',
    simGrid: 96,
    majorantGrid: 48,
    raySteps: 72,
    renderScale: 0.80,
    adaptiveRays: 0.70,
    occupancySkip: 0.50,
    majorantSkip: 0.60,
    majorantSmooth: 0.75,
    majorantGuard: 0.75,
    temporalAccum: 0.25,
    temporalJitter: 0.40,
    historyClamp: 0.75,
    externalEmitterMode: 'synthetic_hand_trails',
    flowRate: 0,
    fireScale: 0.45,
    detailScale: 2.35,
    plumeHeight: 1.05,
    radiance: 2.4,
    absorption: 1.1,
  },
];

function numberList(value, fallback) {
  return String(value || fallback)
    .split(',')
    .map(Number)
    .filter(Number.isFinite);
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseScenarioList(value) {
  if (!value || value === 'all') return COMPACT_MATRIX_SCENARIOS;
  const requested = new Set(String(value).split(',').map((entry) => entry.trim()).filter(Boolean));
  const selected = COMPACT_MATRIX_SCENARIOS.filter((scenario) => requested.has(scenario.id));
  if (selected.length !== requested.size) {
    const known = new Set(COMPACT_MATRIX_SCENARIOS.map((scenario) => scenario.id));
    const unknown = [...requested].filter((id) => !known.has(id));
    throw new Error(`Unknown compact matrix scenario(s): ${unknown.join(', ')}`);
  }
  return selected;
}

function gridRuns() {
  const simGrids = numberList(args.get('--sim-grids'), '96,128');
  const majorantGrids = numberList(args.get('--majorant-grids'), '24,32');
  const raySteps = numberList(args.get('--ray-steps'), '72,120');
  const runs = [];
  for (const simGrid of simGrids) {
    for (const majorantGrid of majorantGrids) {
      for (const steps of raySteps) {
        runs.push({
          id: `grid-sim${simGrid}-maj${majorantGrid}-steps${steps}`,
          label: `Grid ${simGrid}/${majorantGrid}/${steps}`,
          simGrid,
          majorantGrid,
          raySteps: steps,
          adaptiveRays: finiteOr(args.get('--adaptive-rays'), 0.40),
          majorantSkip: finiteOr(args.get('--majorant-skip'), 0.45),
          occupancySkip: finiteOr(args.get('--occupancy-skip'), 0.35),
          majorantSmooth: finiteOr(args.get('--majorant-smooth'), 0.75),
          majorantGuard: finiteOr(args.get('--majorant-guard'), 0.75),
          temporalAccum: finiteOr(args.get('--temporal-accum'), 0.25),
          temporalJitter: finiteOr(args.get('--temporal-jitter'), 0.35),
          historyClamp: finiteOr(args.get('--history-clamp'), 0.75),
          renderScale: finiteOr(args.get('--render-scale'), 0.85),
        });
      }
    }
  }
  return runs;
}

function selectedRuns() {
  if (matrixMode === 'grid') return gridRuns();
  if (matrixMode !== 'compact') throw new Error(`Unknown sweep matrix mode: ${matrixMode}`);
  return parseScenarioList(args.get('--scenarios')).map((scenario) => ({ ...scenario }));
}

function applyNumberParam(url, name, value) {
  if (Number.isFinite(value)) url.searchParams.set(name, String(value));
}

function routeFor(run) {
  const url = new URL(baseUrl);
  url.searchParams.set('kaminos_volume_smoke', '1');
  applyNumberParam(url, 'volume_resolution', run.simGrid);
  applyNumberParam(url, 'volume_majorant_grid', run.majorantGrid);
  applyNumberParam(url, 'volume_steps', run.raySteps);
  applyNumberParam(url, 'volume_render_scale', run.renderScale);
  applyNumberParam(url, 'volume_adaptive_rays', run.adaptiveRays);
  applyNumberParam(url, 'volume_occupancy_skip', run.occupancySkip);
  applyNumberParam(url, 'volume_majorant_skip', run.majorantSkip);
  applyNumberParam(url, 'volume_majorant_smooth', run.majorantSmooth);
  applyNumberParam(url, 'volume_majorant_guard', run.majorantGuard);
  applyNumberParam(url, 'volume_temporal_accum', run.temporalAccum);
  applyNumberParam(url, 'volume_temporal_jitter', run.temporalJitter);
  applyNumberParam(url, 'volume_history_clamp', run.historyClamp);
  applyNumberParam(url, 'volume_flow_rate', run.flowRate);
  applyNumberParam(url, 'volume_fire_scale', run.fireScale);
  applyNumberParam(url, 'volume_detail_scale', run.detailScale);
  applyNumberParam(url, 'volume_plume_height', run.plumeHeight);
  applyNumberParam(url, 'volume_radiance', run.radiance);
  applyNumberParam(url, 'volume_absorption', run.absorption);
  if (run.externalEmitterMode) url.searchParams.set('volume_external_emitters', run.externalEmitterMode);
  return url.toString();
}

function slugFor(run) {
  return run.id.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase();
}

function requestedConfig(run) {
  return {
    scenarioId: run.id,
    label: run.label,
    simGrid: run.simGrid,
    majorantGrid: run.majorantGrid,
    raySteps: run.raySteps,
    renderScale: run.renderScale,
    adaptiveRays: run.adaptiveRays,
    occupancySkip: run.occupancySkip,
    majorantSkip: run.majorantSkip,
    majorantSmooth: run.majorantSmooth,
    majorantGuard: run.majorantGuard,
    temporalAccum: run.temporalAccum,
    temporalJitter: run.temporalJitter,
    historyClamp: run.historyClamp,
    externalEmitterMode: run.externalEmitterMode || 'off',
  };
}

function effectiveConfig(witness) {
  return {
    backend: witness.backend,
    effectiveRoute: witness.effectiveRoute,
    simGrid: witness.simGrid,
    majorantGrid: witness.majorantGrid,
    raySteps: witness.raySteps,
    renderScale: witness.renderScale,
    renderPixelRatio: witness.renderPixelRatio,
    displayWidth: witness.displayWidth,
    displayHeight: witness.displayHeight,
    renderWidth: witness.renderWidth,
    renderHeight: witness.renderHeight,
    volumeReconstructionStyle: witness.volumeReconstructionStyle,
    adaptiveRaymarch: witness.adaptiveRaymarch,
    occupancySkip: witness.occupancySkip,
    majorantSkip: witness.majorantSkip,
    majorantSmooth: witness.majorantSmooth,
    majorantGuard: witness.majorantGuard,
    temporalAccum: witness.temporalAccum,
    temporalJitter: witness.temporalJitter,
    historyClamp: witness.historyClamp,
    temporalEvidenceSource: witness.temporalEvidenceSource,
    timingEvidenceSource: witness.timingEvidenceSource,
    timingDisclaimer: witness.timingDisclaimer,
    externalEmitterMode: witness.externalEmitterMode,
    externalEmitterCount: witness.externalEmitterCount,
    externalEmitterCoordinateSpace: witness.externalEmitterCoordinateSpace,
  };
}

function scoreSweepRun(run) {
  const frameP95 = Number(run.frameP95Ms);
  const queueP95 = Number(run.queueDoneP95Ms);
  const metrics = run.metrics || {};
  const litPixels = Number(metrics.litPixels || 0);
  const smokePixels = Number(metrics.smokeLikePixels || 0);
  const firePixels = Number(metrics.fireLikePixels || 0);
  const emissivePixels = Number(metrics.emissiveLikePixels || 0);
  const timingPenalty = (Number.isFinite(frameP95) ? frameP95 : 20) * 0.9 + (Number.isFinite(queueP95) ? queueP95 : 20) * 0.35;
  const visualSignal = Math.log1p(litPixels) * 4 + Math.log1p(smokePixels) * 2 + Math.log1p(firePixels + emissivePixels) * 2.5;
  const resolutionPenalty = Math.max(0, 1 - Number(run.effectiveConfig?.renderPixelRatio || 1)) * 5.5;
  return Number((visualSignal - timingPenalty - resolutionPenalty).toFixed(3));
}

function rankRecommendations(aggregate) {
  const ranked = aggregate.runs
    .map((run) => ({ run, score: scoreSweepRun(run) }))
    .sort((a, b) => b.score - a.score);
  ranked.forEach((entry, index) => {
    entry.run.score = entry.score;
    entry.run.recommendationRank = index + 1;
  });
  aggregate.recommendations = ranked.slice(0, 4).map(({ run, score }) => ({
    recommendationRank: run.recommendationRank,
    scenarioId: run.scenarioId,
    label: run.label,
    score,
    frameP95Ms: run.frameP95Ms,
    queueDoneP95Ms: run.queueDoneP95Ms,
    renderScale: run.effectiveConfig?.renderScale,
    raySteps: run.effectiveConfig?.raySteps,
    adaptiveRaymarch: run.effectiveConfig?.adaptiveRaymarch,
    report: run.report,
    screenshot: run.screenshot,
  }));
}

function writeAggregate(aggregate) {
  rankRecommendations(aggregate);
  writeFileSync(aggregatePath, JSON.stringify({ aggregate }, null, 2));
}

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(aggregatePath), { recursive: true });

const runs = selectedRuns();
const aggregate = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  matrixMode,
  dryRun,
  settleMs,
  windowSize,
  compactScenarioIds: COMPACT_MATRIX_SCENARIOS.map((scenario) => scenario.id),
  runs: [],
  failures: [],
  recommendations: [],
};

if (dryRun) {
  aggregate.runs = runs.map((run) => ({
    scenarioId: run.id,
    label: run.label,
    url: routeFor(run),
    requestedConfig: requestedConfig(run),
  }));
  writeFileSync(aggregatePath, JSON.stringify({ aggregate }, null, 2));
  console.log(JSON.stringify({ aggregate }, null, 2));
  process.exit(0);
}

for (let i = 0; i < runs.length; i += 1) {
  const run = runs[i];
  const slug = slugFor(run);
  const screenshot = `${outDir}/${slug}.png`;
  const report = `${outDir}/${slug}.json`;
  const url = routeFor(run);
  try {
    execFileSync(process.execPath, [
      'volume-witness.mjs',
      '--url', url,
      '--out', screenshot,
      '--report', report,
      '--debug-port', String(debugPort + i),
      '--user-data-dir', `${outDir}/profile-${slug}`,
      '--settle-ms', String(settleMs),
      '--window-size', windowSize,
    ], { cwd: new URL('.', import.meta.url).pathname, stdio: 'pipe' });
    const witness = JSON.parse(readFileSync(report, 'utf8'));
    const effective = effectiveConfig(witness);
    aggregate.runs.push({
      scenarioId: run.id,
      label: run.label,
      url,
      report,
      screenshot,
      requestedConfig: requestedConfig(run),
      effectiveConfig: effective,
      backend: witness.backend,
      effectiveRoute: witness.effectiveRoute,
      raySteps: witness.raySteps,
      adaptiveRaymarch: witness.adaptiveRaymarch,
      occupancySkip: witness.occupancySkip,
      majorantSkip: witness.majorantSkip,
      majorantSmooth: witness.majorantSmooth,
      majorantGuard: witness.majorantGuard,
      simGrid: witness.simGrid,
      majorantGrid: witness.majorantGrid,
      majorantBuilt: witness.majorantBuilt,
      occupiedBricks: witness.majorantReadback?.occupiedBricks,
      renderScale: witness.renderScale,
      renderPixelRatio: witness.renderPixelRatio,
      displayWidth: witness.displayWidth,
      displayHeight: witness.displayHeight,
      renderWidth: witness.renderWidth,
      renderHeight: witness.renderHeight,
      externalEmitterMode: witness.externalEmitterMode,
      externalEmitterCount: witness.externalEmitterCount,
      temporalEvidenceSource: witness.temporalEvidenceSource,
      timingEvidenceSource: witness.timingEvidenceSource,
      timingDisclaimer: witness.timingDisclaimer,
      frameP95Ms: witness.timing?.frameP95Ms,
      queueDoneMs: witness.timing?.queueDoneMs,
      queueDoneP95Ms: witness.timing?.queueDoneP95Ms,
      metrics: witness.metrics,
      simReadback: witness.simReadback,
      majorantReadback: witness.majorantReadback,
    });
  } catch (error) {
    const failure = {
      scenarioId: run.id,
      label: run.label,
      url,
      report,
      screenshot,
      requestedConfig: requestedConfig(run),
      error: error?.message || String(error),
      stdout: String(error?.stdout || ''),
      stderr: String(error?.stderr || ''),
    };
    aggregate.failures.push(failure);
    try {
      failure.partialReport = JSON.parse(readFileSync(report, 'utf8'));
    } catch {}
  } finally {
    writeAggregate(aggregate);
  }
}

writeAggregate(aggregate);
console.log(JSON.stringify({ aggregate }, null, 2));
if (aggregate.failures.length > 0) process.exit(1);
