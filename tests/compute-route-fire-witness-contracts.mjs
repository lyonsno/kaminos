import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildActiveComputeRouteRun,
  buildRouteRunFromPipelineReport,
  buildComputeRouteFireWitness,
} from '../compute-route-fire-witness.mjs';

const baseReport = {
  schema: 'kaminos.pipeline-witness.v0',
  ok: true,
  requestedPipelineId: 'sharp-image-to-splat-live-v0',
  effectivePipelineId: 'sharp-image-to-splat-live-v0',
  phase: 'complete',
  effectiveRouteConfig: {
    routeId: 'adapter.sharp-image-to-splat-live.v0',
    outputRoot: '/tmp/kaminos-real-route/out',
  },
  artifacts: {
    input: {
      role: 'source-image',
      status: 'requested',
      path: '/tmp/kaminos/source.png',
      sha256: 'sha256:source',
    },
    splat: {
      role: 'splat-candidate',
      status: 'real',
      path: '/tmp/kaminos-real-route/out/artifacts/sharp-output.ply',
      bytes: 66060836,
      sha256: 'sha256:splat',
    },
    depthMap: {
      role: 'depth-map',
      status: 'real',
      path: '/tmp/kaminos-real-route/out/artifacts/sharp-webgpu-depth.png',
      bytes: 507322,
      sha256: 'sha256:depth',
    },
    metadata: {
      role: 'sharp-webgpu-metadata',
      status: 'real',
      path: '/tmp/kaminos-real-route/out/artifacts/sharp-webgpu-metadata.json',
      bytes: 1024,
      sha256: 'sha256:metadata',
    },
    autoCropEvidence: {
      role: 'splat-autocrop-evidence',
      schema: 'kaminos.splat-autocrop-evidence.v0',
      status: 'real',
      path: '/tmp/kaminos-real-route/out/artifacts/sharp-output.splat-autocrop-evidence.json',
      bytes: 3347,
      sha256: 'sha256:autocrop',
    },
    sidecar: {
      role: 'kaminos-import-sidecar',
      status: 'real',
      path: '/tmp/kaminos-real-route/out/artifacts/sharp-output.kaminos-pipeline.json',
      bytes: 4096,
      sha256: 'sha256:sidecar',
    },
  },
  stages: [
    {
      id: 'run-sharp-image-to-splat',
      status: 'real',
      requestedRoute: 'adapter.sharp-image-to-splat.v0',
      effectiveRoute: {
        id: 'adapter.sharp-image-to-splat.v0',
        tool: 'SHARP-WebGPU',
        effectiveBackend: 'browser-webgpu',
        realModel: true,
        requestedRealModel: true,
        adapterReportPath: '/tmp/kaminos-real-route/out/artifacts/run-sharp-image-to-splat.adapter-report.json',
      },
    },
    {
      id: 'write-live-sharp-sidecar',
      status: 'real',
      requestedRoute: 'local.kaminos-import-sidecar.v0',
      effectiveRoute: {
        id: 'local.kaminos-import-sidecar.v0',
        effectiveBackend: 'local-sidecar-writer',
      },
    },
  ],
  bundleIndex: {
    path: '/tmp/kaminos-real-route/out/pipeline-run.index.json',
  },
};

const witnessSource = readFileSync(fileURLToPath(new URL('../compute-route-fire-witness.mjs', import.meta.url)), 'utf8');

const activeRun = buildActiveComputeRouteRun({
  pipelineId: 'sharp-image-to-splat-live-v0',
  routeId: 'adapter.sharp-image-to-splat-live.v0',
  backendClass: 'browser-webgpu',
  reportPath: '/tmp/kaminos-real-route/pipeline-witness.json',
  inputPath: '/tmp/kaminos/source.png',
});

assert.equal(activeRun.schema, 'kaminos.kiln.tray-route-run.v0');
assert.equal(activeRun.statusBadge, 'real');
assert.equal(activeRun.routePhase, 'running');
assert.equal(activeRun.kilnActivity.activityState, 'burning');
assert.equal(activeRun.routeActivity.visualAuthority, 'live-compute');
assert.equal(activeRun.routeActivity.fire.allowsFullBurn, true);
assert.equal(activeRun.routeActivity.requestedRoute, 'adapter.sharp-image-to-splat-live.v0');
assert.equal(activeRun.routeActivity.backendClass, 'browser-webgpu');
assert.deepEqual(activeRun.inputArtifactIds, ['/tmp/kaminos/source.png']);

const completedRun = buildRouteRunFromPipelineReport(baseReport, {
  reportPath: '/tmp/kaminos-real-route/pipeline-witness.json',
});
assert.equal(completedRun.statusBadge, 'real');
assert.equal(completedRun.routePhase, 'completed');
assert.equal(completedRun.kilnActivity.activityState, 'cooled');
assert.equal(completedRun.routeActivity.visualAuthority, 'settled-output');
assert.equal(completedRun.routeActivity.fire.allowsFullBurn, false);
assert.ok(completedRun.outputArtifactIds.includes('splat:/tmp/kaminos-real-route/out/artifacts/sharp-output.ply'));
assert.ok(completedRun.outputArtifactIds.includes('autoCropEvidence:/tmp/kaminos-real-route/out/artifacts/sharp-output.splat-autocrop-evidence.json'));
assert.ok(completedRun.sourceTruthWarnings.includes('pipeline_route_completed_not_active_compute'));

const failedRun = buildRouteRunFromPipelineReport({
  ...baseReport,
  ok: false,
  phase: 'failed:adapter',
  error: 'live model adapter exited 1',
  artifacts: {
    input: baseReport.artifacts.input,
  },
  stages: [
    {
      ...baseReport.stages[0],
      status: 'failed',
      effectiveRoute: {
        ...baseReport.stages[0].effectiveRoute,
        realModel: true,
        failurePhase: 'adapter',
      },
    },
  ],
}, {
  reportPath: '/tmp/kaminos-failed-route/pipeline-witness.json',
});
assert.equal(failedRun.statusBadge, 'failed');
assert.equal(failedRun.kilnActivity.activityState, 'failed');
assert.equal(failedRun.routeActivity.visualAuthority, 'failure-report');
assert.equal(failedRun.routeActivity.fire.allowsFullBurn, false);
assert.ok(failedRun.sourceTruthWarnings.includes('pipeline_route_failed'));

const mockFixtureRun = buildRouteRunFromPipelineReport({
  ...baseReport,
  stages: [
    {
      ...baseReport.stages[0],
      status: 'fixture',
      effectiveRoute: {
        ...baseReport.stages[0].effectiveRoute,
        realModel: false,
        requestedRealModel: true,
        fixtureMode: 'mock-adapter',
      },
    },
  ],
  artifacts: Object.fromEntries(Object.entries(baseReport.artifacts).map(([key, artifact]) => [
    key,
    { ...artifact, status: key === 'input' ? artifact.status : 'fixture' },
  ])),
}, {
  reportPath: '/tmp/kaminos-mock-route/pipeline-witness.json',
});
assert.equal(mockFixtureRun.statusBadge, 'fixture');
assert.equal(mockFixtureRun.kilnActivity.activityState, 'fixture');
assert.equal(mockFixtureRun.routeActivity.fire.allowsFullBurn, false);
assert.ok(mockFixtureRun.sourceTruthWarnings.includes('pipeline_route_fixture_or_mock_adapter'));

const activeWitness = buildComputeRouteFireWitness({
  witnessId: 'actual-compute-route-fire-test',
  routeRun: activeRun,
  baseUrl: 'http://127.0.0.1:18119/',
});
assert.equal(activeWitness.schema, 'kaminos.compute-route-fire-witness.v0');
assert.equal(activeWitness.routeActivityWitness.schema, 'beaming.volume-fire.route-activity-witness.v0');
assert.equal(activeWitness.routeActivityWitness.fullBurnCount, 1);
assert.equal(activeWitness.primaryBridge.routeRunId, 'sharp-image-to-splat-live-v0-active');
assert.equal(activeWitness.primaryBridge.visualReceipt.visualPhase, 'burn');
assert.equal(activeWitness.primaryBridge.visualReceipt.allowsFullBurn, true);
assert.equal(new URL(activeWitness.volumeWitnessUrl).searchParams.get('kaminos_volume_smoke'), '1');

const completedWitness = buildComputeRouteFireWitness({
  witnessId: 'completed-compute-route-fire-test',
  routeRun: completedRun,
  baseUrl: 'http://127.0.0.1:18119/',
});
assert.equal(completedWitness.routeActivityWitness.fullBurnCount, 0);
assert.equal(completedWitness.primaryBridge.visualReceipt.visualPhase, 'cooled');

const dryRunDir = mkdtempSync(join(tmpdir(), 'kaminos-compute-route-fire-dry-run-'));
const dryRunReportPath = join(dryRunDir, 'dry-run-report.json');
const dryRunStdout = execFileSync(process.execPath, [
  fileURLToPath(new URL('../compute-route-fire-witness.mjs', import.meta.url)),
  '--dry-run',
  '--run-pipeline',
  '--report', dryRunReportPath,
  '--out-dir', join(dryRunDir, 'pipeline-out'),
], {
  encoding: 'utf8',
});
assert.equal(dryRunStdout.trim(), dryRunReportPath);
const dryRunReport = JSON.parse(readFileSync(dryRunReportPath, 'utf8'));
assert.equal(dryRunReport.phase, 'dry-run');
assert.equal(dryRunReport.runPipeline, true);
assert.equal(dryRunReport.input, null);
assert.equal(dryRunReport.pipelineExit, null);
assert.equal(dryRunReport.activeWitness.routeRun.routePhase, 'running');
assert.equal(dryRunReport.activeWitness.routeActivityWitness.fullBurnCount, 1);
assert.equal(dryRunReport.smokePayload.schema, 'kaminos.compute-route-fire-smoke-payload.v0');
assert.equal(dryRunReport.smokePayload.pipelineId, 'sharp-image-to-splat-live-v0');
assert.equal(dryRunReport.smokePayload.active.visualPhase, 'burn');
assert.equal(dryRunReport.smokePayload.active.allowsFullBurn, true);
assert.match(dryRunReport.smokeUrl, /kaminos_compute_route_fire=1/);
assert.match(dryRunReport.smokeUrl, /compute_route_fire_payload=/);
assert.match(witnessSource, /buildComputeRouteContentionWitnessFromReport/, 'compute route fire witness emits Wake contention reports from the same run report');
assert.match(witnessSource, /--contention-report/, 'compute route fire witness accepts an explicit contention report path');
assert.match(witnessSource, /startedAt/, 'compute route fire witness records pipeline process start time as route telemetry');
assert.match(witnessSource, /finishedAt/, 'compute route fire witness records pipeline process finish time as route telemetry');
assert.match(witnessSource, /durationMs/, 'compute route fire witness records pipeline process duration as route telemetry');
assert.match(witnessSource, /contentionWitnessReportPath/, 'primary visual report records the contention report path');
assert.match(witnessSource, /contentionWitness/, 'primary visual report embeds a compact contention witness summary');
assert.match(witnessSource, /requestedVisualBudget/, 'contention emission preserves requested visual budget identity');
