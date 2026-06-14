#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const baseUrl = args.get('--base-url') || 'http://127.0.0.1:8097/?kaminos_volume_smoke=1';
const outDir = resolve(args.get('--out-dir') || '/tmp/kaminos-volume-sweep');
const aggregatePath = resolve(args.get('--aggregate') || `${outDir}/aggregate.json`);
const settleMs = Number(args.get('--settle-ms') || 8000);
const windowSize = args.get('--window-size') || '1280,960';
const debugPort = Number(args.get('--debug-port') || 9500);
const simGrids = (args.get('--sim-grids') || '96,128').split(',').map(Number).filter(Number.isFinite);
const majorantGrids = (args.get('--majorant-grids') || '24,32').split(',').map(Number).filter(Number.isFinite);
const raySteps = (args.get('--ray-steps') || '72,120').split(',').map(Number).filter(Number.isFinite);
const majorantSkip = Number(args.get('--majorant-skip') || 0.45);
const occupancySkip = Number(args.get('--occupancy-skip') || 0.35);
const adaptiveRays = Number(args.get('--adaptive-rays') || 0.40);

function routeFor(run) {
  const url = new URL(baseUrl);
  url.searchParams.set('kaminos_volume_smoke', '1');
  url.searchParams.set('volume_resolution', String(run.simGrid));
  url.searchParams.set('volume_majorant_grid', String(run.majorantGrid));
  url.searchParams.set('volume_steps', String(run.raySteps));
  url.searchParams.set('volume_adaptive_rays', String(adaptiveRays));
  url.searchParams.set('volume_majorant_skip', String(majorantSkip));
  url.searchParams.set('volume_occupancy_skip', String(occupancySkip));
  return url.toString();
}

function slugFor(run) {
  return `sim${run.simGrid}-maj${run.majorantGrid}-steps${run.raySteps}`;
}

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(aggregatePath), { recursive: true });

const runs = [];
for (const simGrid of simGrids) {
  for (const majorantGrid of majorantGrids) {
    for (const steps of raySteps) {
      runs.push({ simGrid, majorantGrid, raySteps: steps });
    }
  }
}

const aggregate = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  settleMs,
  windowSize,
  knobs: { adaptiveRays, majorantSkip, occupancySkip },
  runs: [],
  failures: [],
};

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
    aggregate.runs.push({
      ...run,
      url,
      report,
      screenshot,
      backend: witness.backend,
      effectiveRoute: witness.effectiveRoute,
      raySteps: witness.raySteps,
      adaptiveRaymarch: witness.adaptiveRaymarch,
      occupancySkip: witness.occupancySkip,
      majorantSkip: witness.majorantSkip,
      simGrid: witness.simGrid,
      majorantGrid: witness.majorantGrid,
      majorantBuilt: witness.majorantBuilt,
      occupiedBricks: witness.majorantReadback?.occupiedBricks,
      frameP95Ms: witness.timing?.frameP95Ms,
      queueDoneMs: witness.timing?.queueDoneMs,
      queueDoneP95Ms: witness.timing?.queueDoneP95Ms,
      metrics: witness.metrics,
      simReadback: witness.simReadback,
      majorantReadback: witness.majorantReadback,
    });
  } catch (error) {
    const failure = {
      ...run,
      url,
      report,
      screenshot,
      error: error?.message || String(error),
      stdout: String(error?.stdout || ''),
      stderr: String(error?.stderr || ''),
    };
    aggregate.failures.push(failure);
    if (readFileSync) {
      try {
        failure.partialReport = JSON.parse(readFileSync(report, 'utf8'));
      } catch {}
    }
  } finally {
    writeFileSync(aggregatePath, JSON.stringify({ aggregate }, null, 2));
  }
}

writeFileSync(aggregatePath, JSON.stringify({ aggregate }, null, 2));
console.log(JSON.stringify({ aggregate }, null, 2));
if (aggregate.failures.length > 0) process.exit(1);
