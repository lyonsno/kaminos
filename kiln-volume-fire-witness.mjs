#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildKilnVolumeFireWitness } from './kiln-volume-fire-bridge.mjs';

const TOOL_ID = 'beaming-kiln-volume-fire-witness-v0';
const REPORT_SCHEMA = 'beaming.volume-fire.route-activity-witness-report.v0';
const EFFECTIVE_FIXTURE = 'wake-route-activity-bridge-fixture-v0';

function routeActivity(overrides = {}) {
  const fire = {
    heatClass: 'burn',
    fuelClass: 'local-webgpu',
    truthClass: 'live',
    visualAuthority: 'live-compute',
    allowsFullBurn: true,
    spendIntensity: 1,
    custodyStrength: 0.8,
    failureSharpness: 0,
    cacheWarmth: 0,
    outputSlotCount: 1,
    warningLoad: 0,
    ...overrides.fire,
  };
  return {
    schema: 'kaminos.kiln.route-activity.v0',
    activityId: 'live-run-route-activity',
    routeRunId: 'live-run',
    activityState: 'burning',
    routePhase: 'running',
    truthMode: 'live',
    visualAuthority: 'live-compute',
    requestedRoute: 'adapter.moge-local-webgpu.v0',
    effectiveRoute: 'adapter.moge-local-webgpu.v0',
    backendClass: 'browser-webgpu',
    receiptId: 'receipt-live-001',
    sourceArtifactIds: ['source-image-a'],
    conditioningArtifactIds: ['depth-a'],
    outputSlots: [{ role: 'output', artifactId: 'mesh-slot-a', status: 'pending' }],
    sourceTruthWarnings: [],
    falseAuthorityViolations: [],
    fire,
    ...overrides,
  };
}

function routeRun(routeActivityPayload, overrides = {}) {
  return {
    schema: 'kaminos.kiln.tray-route-run.v0',
    runId: routeActivityPayload.routeRunId,
    requestedRoute: routeActivityPayload.requestedRoute,
    effectiveRoute: routeActivityPayload.effectiveRoute,
    backendClass: routeActivityPayload.backendClass,
    statusBadge: overrides.statusBadge || 'real',
    routePhase: routeActivityPayload.routePhase,
    receiptId: routeActivityPayload.receiptId,
    inputArtifactIds: routeActivityPayload.sourceArtifactIds,
    conditioningArtifactIds: routeActivityPayload.conditioningArtifactIds,
    outputArtifactIds: (routeActivityPayload.outputSlots || []).map(slot => slot.artifactId),
    routeActivity: routeActivityPayload,
    sourceTruthWarnings: routeActivityPayload.sourceTruthWarnings,
    ...overrides,
  };
}

function fixtureRouteRuns() {
  const live = routeActivity();
  const queued = routeActivity({
    activityId: 'queued-run-route-activity',
    routeRunId: 'queued-run',
    activityState: 'queued',
    routePhase: 'preheating',
    truthMode: 'live',
    visualAuthority: 'preheat',
    outputSlots: [{ role: 'output', artifactId: 'mesh-slot-a', status: 'waiting' }],
    fire: {
      heatClass: 'preheat',
      fuelClass: 'route-queued',
      truthClass: 'live',
      visualAuthority: 'preheat',
      allowsFullBurn: false,
      spendIntensity: 0.12,
    },
  });
  const cached = routeActivity({
    activityId: 'cached-run-route-activity',
    routeRunId: 'cached-run',
    activityState: 'cached',
    routePhase: 'completed',
    truthMode: 'cached',
    visualAuthority: 'cached',
    backendClass: 'cache',
    receiptId: 'receipt-cached-001',
    sourceTruthWarnings: ['cached_not_fresh_compute'],
    fire: {
      heatClass: 'glow',
      fuelClass: 'cached',
      truthClass: 'cached',
      visualAuthority: 'cached',
      allowsFullBurn: false,
      spendIntensity: 0,
      cacheWarmth: 0.8,
    },
  });
  const complete = routeActivity({
    activityId: 'complete-run-route-activity',
    routeRunId: 'complete-run',
    activityState: 'complete',
    routePhase: 'completed',
    truthMode: 'live',
    visualAuthority: 'completion-blaze',
    outputSlots: [{ role: 'output', artifactId: 'mesh-slot-a', status: 'linked' }],
    fire: {
      heatClass: 'completion-blaze',
      fuelClass: 'settled-output',
      truthClass: 'live',
      visualAuthority: 'completion-blaze',
      allowsFullBurn: false,
      spendIntensity: 0,
      outputSlotCount: 1,
    },
  });
  const fallback = routeActivity({
    activityId: 'fallback-run-route-activity',
    routeRunId: 'fallback-run',
    activityState: 'fallback',
    routePhase: 'running',
    truthMode: 'fallback',
    visualAuthority: 'fallback',
    effectiveRoute: 'fixture-generator',
    backendClass: 'fixture',
    receiptId: 'receipt-fallback-001',
    sourceTruthWarnings: ['fallback_kiln_not_requested_route'],
    fire: {
      heatClass: 'burn',
      fuelClass: 'fixture',
      truthClass: 'fallback',
      visualAuthority: 'fallback',
      allowsFullBurn: true,
      spendIntensity: 1,
      warningLoad: 1,
    },
  });
  const failed = routeActivity({
    activityId: 'failed-run-route-activity',
    routeRunId: 'failed-run',
    activityState: 'failed',
    routePhase: 'failed',
    truthMode: 'failed',
    visualAuthority: 'failure-snuff',
    sourceTruthWarnings: ['route_failed_after_backend_error'],
    fire: {
      heatClass: 'snuff',
      fuelClass: 'failed-route',
      truthClass: 'failed',
      visualAuthority: 'failure-snuff',
      allowsFullBurn: false,
      failureSharpness: 1,
    },
  });
  const unavailable = routeActivity({
    activityId: 'missing-run-route-activity',
    routeRunId: 'missing-run',
    activityState: 'unavailable',
    routePhase: 'queued',
    truthMode: 'unavailable',
    visualAuthority: 'none',
    effectiveRoute: null,
    backendClass: 'missing',
    receiptId: null,
    sourceArtifactIds: [],
    conditioningArtifactIds: [],
    outputSlots: [],
    sourceTruthWarnings: ['kiln_backend_unavailable'],
    fire: {
      heatClass: 'cold',
      fuelClass: 'unknown',
      truthClass: 'unavailable',
      visualAuthority: 'none',
      allowsFullBurn: false,
    },
  });

  return [
    routeRun(live),
    routeRun(queued, { statusBadge: 'queued' }),
    routeRun(cached, { statusBadge: 'cached' }),
    routeRun(complete, { statusBadge: 'complete' }),
    routeRun(fallback, { statusBadge: 'fallback' }),
    routeRun(failed, { statusBadge: 'failed' }),
    routeRun(unavailable, { statusBadge: 'missing-backend' }),
  ];
}

function parseArgs(argv) {
  const args = { out: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--out') {
      args.out = argv[++index] || null;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.out) {
  console.error('Usage: node kiln-volume-fire-witness.mjs --out <path>');
  process.exit(2);
}

const requestedOut = args.out;
const out = resolve(requestedOut);
const report = {
  schema: REPORT_SCHEMA,
  toolId: TOOL_ID,
  effectiveFixture: EFFECTIVE_FIXTURE,
  requestedOut,
  outputPath: out,
  witness: buildKilnVolumeFireWitness({
    witnessId: 'route-tray-fire-witness-001',
    routeRuns: fixtureRouteRuns(),
  }),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(out);
