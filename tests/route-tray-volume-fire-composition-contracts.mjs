import assert from 'node:assert/strict';

import {
  addRouteRun,
  createTray,
} from '../route-composition-tray.mjs';
import {
  buildKilnVolumeFireWitness,
} from '../kiln-volume-fire-bridge.mjs';
import {
  volumeUrlForBridge,
} from '../kiln-volume-fire-bench.mjs';

let tray = createTray({ trayId: 'route-fire-composition-tray' });

tray = addRouteRun(tray, {
  runId: 'moge-running-local-webgpu-001',
  requestedRoute: 'moge.depth-normal.webgpu-local.v0',
  effectiveRoute: 'moge.depth-normal.webgpu-local.v0',
  backendClass: 'webgpu-local',
  statusBadge: 'real',
  routePhase: 'running',
  receiptId: 'moge-running-local-webgpu-001-receipt',
  inputArtifactIds: ['red-lerm-beauty'],
  conditioningArtifactIds: ['red-lerm-depth', 'red-lerm-normal'],
  outputArtifactIds: ['red-lerm-depth-live', 'red-lerm-normal-live'],
});

tray = addRouteRun(tray, {
  runId: 'fixture-fallback-001',
  requestedRoute: 'image_conditioned_generation',
  effectiveRoute: 'fixture-generator',
  backendClass: 'fixture',
  statusBadge: 'fallback',
  routePhase: 'running',
  receiptId: 'fixture-fallback-001-receipt',
  inputArtifactIds: ['red-lerm-beauty'],
  conditioningArtifactIds: ['red-lerm-depth'],
  outputArtifactIds: ['fixture-candidate'],
});

const liveRun = tray.routeRuns.find(run => run.runId === 'moge-running-local-webgpu-001');
const fallbackRun = tray.routeRuns.find(run => run.runId === 'fixture-fallback-001');

assert.equal(liveRun.routeActivity.schema, 'kaminos.kiln.route-activity.v0');
assert.equal(liveRun.kilnActivity.activityState, 'burning');
assert.equal(liveRun.kilnActivity.truthMode, 'live');
assert.equal(liveRun.routeActivity.visualAuthority, 'live-compute');
assert.equal(liveRun.routeActivity.fire.allowsFullBurn, true);

assert.equal(fallbackRun.kilnActivity.activityState, 'fallback');
assert.equal(fallbackRun.kilnActivity.truthMode, 'fallback');
assert.equal(fallbackRun.routeActivity.visualAuthority, 'fallback');
assert.equal(fallbackRun.routeActivity.fire.allowsFullBurn, false);
assert.ok(fallbackRun.sourceTruthWarnings.includes('fallback_kiln_not_requested_route'));

const witness = buildKilnVolumeFireWitness({
  witnessId: 'tray-to-volume-fire-composition-001',
  routeRuns: tray.routeRuns,
});

assert.equal(witness.schema, 'beaming.volume-fire.route-activity-witness.v0');
assert.equal(witness.routeRunCount, 2);
assert.equal(witness.fullBurnCount, 1);
assert.equal(witness.enabledCount, 2);
assert.equal(witness.phaseCounts.burn, 1);
assert.equal(witness.phaseCounts.weak_heat, 1);
assert.equal(witness.truthModeCounts.live, 1);
assert.equal(witness.truthModeCounts.fallback, 1);
assert.equal(witness.primaryBridge.routeRunId, 'moge-running-local-webgpu-001');
assert.equal(witness.primaryBridge.visualReceipt.visualBackendId, 'beaming.volume-fire.kiln-v0');
assert.equal(witness.primaryBridge.visualReceipt.allowsFullBurn, true);
assert.ok(witness.truthWarnings.includes('fallback_kiln_not_requested_route'));
assert.deepEqual(witness.falseAuthorityViolations, []);

const liveUrl = new URL(volumeUrlForBridge(witness.primaryBridge, 'http://127.0.0.1:18114/'));
assert.equal(liveUrl.searchParams.get('kaminos_volume_smoke'), '1');
assert.equal(liveUrl.searchParams.get('volume_scene'), 'tall_plume');
assert.equal(liveUrl.searchParams.get('volume_tall_preset'), 'operator_fire_0622');
assert.equal(liveUrl.searchParams.get('volume_fire'), '0.1');
assert.equal(liveUrl.searchParams.get('volume_fire_scale'), '0.42');
