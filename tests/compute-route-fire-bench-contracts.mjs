import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  COMPUTE_ROUTE_FIRE_BENCH_SCHEMA,
  COMPUTE_ROUTE_FIRE_PAYLOAD_SCHEMA,
  buildComputeRouteFireBenchModel,
  computeRouteFirePayloadFromSearch,
  computeRouteFireSmokeUrl,
} from '../compute-route-fire-bench.mjs';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');

const payload = {
  schema: COMPUTE_ROUTE_FIRE_PAYLOAD_SCHEMA,
  pipelineId: 'sharp-image-to-splat-live-v0',
  requestedRoute: 'adapter.sharp-image-to-splat-live.v0',
  effectiveRoute: 'adapter.sharp-image-to-splat-live.v0',
  backendClass: 'browser-webgpu',
  pipelineReportPath: '/tmp/kaminos-actual-compute-route-fire-0629/report.json',
  inputPath: '/Users/noahlyons/.local/state/kaminos/assets/images/inbox/evil_orb_outer_shell_source_image.png',
  active: {
    routeRunId: 'sharp-image-to-splat-live-v0-active',
    routePhase: 'running',
    visualPhase: 'burn',
    fullBurnCount: 1,
    allowsFullBurn: true,
  },
  final: {
    statusBadge: 'real',
    routePhase: 'completed',
    visualPhase: 'cooled',
    fullBurnCount: 0,
    allowsFullBurn: false,
  },
  artifacts: [
    {
      id: 'splat',
      role: 'splat-candidate',
      status: 'real',
      path: '/tmp/kaminos-actual-compute-route-fire-0629/pipeline-out/artifacts/sharp-output.ply',
      bytes: 66060836,
    },
    {
      id: 'depthMap',
      role: 'depth-map',
      status: 'real',
      path: '/tmp/kaminos-actual-compute-route-fire-0629/pipeline-out/artifacts/sharp-webgpu-depth.png',
      bytes: 507322,
    },
    {
      id: 'autoCropEvidence',
      role: 'splat-autocrop-evidence',
      status: 'real',
      schema: 'kaminos.splat-autocrop-evidence.v0',
      path: '/tmp/kaminos-actual-compute-route-fire-0629/pipeline-out/artifacts/sharp-output.splat-autocrop-evidence.json',
      bytes: 3343,
    },
  ],
  warnings: ['pipeline_route_completed_not_active_compute', 'pipeline_autocrop_evidence_present'],
};

const smokeUrl = computeRouteFireSmokeUrl(payload, {
  baseUrl: 'http://127.0.0.1:18121/',
  volumeWitnessUrl: 'http://127.0.0.1:18121/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=operator_fire_0622&volume_resolution=128',
});
const url = new URL(smokeUrl);
assert.equal(url.searchParams.get('kaminos_compute_route_fire'), '1');
assert.equal(url.searchParams.get('kaminos_volume_smoke'), '1');
assert.equal(url.searchParams.get('volume_scene'), 'tall_plume');
assert.ok(url.searchParams.get('compute_route_fire_payload')?.length > 100);

const decodedPayload = computeRouteFirePayloadFromSearch(url.search);
assert.deepEqual(decodedPayload, payload);

const model = buildComputeRouteFireBenchModel({
  payload: decodedPayload,
  launchUrl: smokeUrl,
});
assert.equal(COMPUTE_ROUTE_FIRE_BENCH_SCHEMA, 'kaminos.compute-route-fire-bench.v0');
assert.equal(model.schema, COMPUTE_ROUTE_FIRE_BENCH_SCHEMA);
assert.equal(model.pipelineId, 'sharp-image-to-splat-live-v0');
assert.equal(model.routeLabel, 'sharp-image-to-splat-live-v0');
assert.equal(model.requestedRoute, 'adapter.sharp-image-to-splat-live.v0');
assert.equal(model.effectiveRoute, 'adapter.sharp-image-to-splat-live.v0');
assert.equal(model.backendClass, 'browser-webgpu');
assert.equal(model.pipelineReportPath, '/tmp/kaminos-actual-compute-route-fire-0629/report.json');
assert.equal(model.inputPath.endsWith('evil_orb_outer_shell_source_image.png'), true);
assert.equal(model.active.routeRunId, 'sharp-image-to-splat-live-v0-active');
assert.equal(model.active.visualPhase, 'burn');
assert.equal(model.active.allowsFullBurn, true);
assert.equal(model.final.visualPhase, 'cooled');
assert.equal(model.final.allowsFullBurn, false);
assert.equal(model.artifactRows.length, 3);
assert.ok(model.artifactRows.some(row => row.id === 'splat' && row.path.endsWith('sharp-output.ply') && row.status === 'real'));
assert.ok(model.artifactRows.some(row => row.id === 'autoCropEvidence' && row.schema === 'kaminos.splat-autocrop-evidence.v0'));
assert.ok(model.warningRows.includes('pipeline_route_completed_not_active_compute'));
assert.equal(model.sourceTruthSummary, 'active burn from real SHARP route; final cooled after real output');

const activeOnlyModel = buildComputeRouteFireBenchModel({
  payload: {
    ...payload,
    final: null,
    artifacts: [],
    warnings: [],
  },
});
assert.equal(activeOnlyModel.active.visualPhase, 'burn');
assert.equal(activeOnlyModel.final.visualPhase, null);
assert.equal(activeOnlyModel.final.allowsFullBurn, false);
assert.equal(activeOnlyModel.sourceTruthSummary, 'active burn from compute route evidence');

assert.match(index, /id="compute-route-fire-evidence"/, 'Volume tab hosts compute-route evidence panel');
assert.match(index, /data-compute-route-fire-bench-schema="kaminos\.compute-route-fire-bench\.v0"/, 'DOM preserves compute-route bench schema');
assert.match(index, /id="compute-route-fire-route"/, 'visible panel names the actual compute route');
assert.match(index, /id="compute-route-fire-report"/, 'visible panel exposes the report path');
assert.match(index, /id="compute-route-fire-artifacts"/, 'visible panel exposes real output artifacts');
assert.match(index, /data-compute-route-fire-field="autoCropEvidence"/, 'visible panel preserves autocrop evidence as a named field');
assert.match(index, /buildComputeRouteFireBenchModel/, 'Volume tab derives compute-route evidence from shared bench model');
assert.match(index, /renderComputeRouteFireBench/, 'Volume tab renders compute-route evidence explicitly');
