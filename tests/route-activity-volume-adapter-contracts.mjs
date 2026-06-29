import assert from 'node:assert/strict';
import {
  deriveRouteActivity,
} from '../route-composition-tray.mjs';
import {
  KAMINOS_ROUTE_ACTIVITY_VOLUME_ADAPTER_SCHEMA,
  deriveRouteActivityVolumeAdapter,
} from '../route-activity-volume-adapter.mjs';

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function liveActivity() {
  return deriveRouteActivity({
    runId: 'live-run-001',
    requestedRoute: 'sharp.image-to-splat.live.v0',
    effectiveRoute: 'sharp.image-to-splat.live.v0',
    backendClass: 'browser-webgpu',
    statusBadge: 'real',
    routePhase: 'running',
    receiptId: 'receipt-live-001',
    inputArtifactIds: ['source-live'],
    outputArtifactIds: [],
  });
}

test('live route activity derives a full volumetric burn adapter payload', () => {
  const adapter = deriveRouteActivityVolumeAdapter(liveActivity());

  assert.equal(adapter.schema, KAMINOS_ROUTE_ACTIVITY_VOLUME_ADAPTER_SCHEMA);
  assert.equal(adapter.routeActivitySchema, 'kaminos.kiln.route-activity.v0');
  assert.equal(adapter.routeRunId, 'live-run-001');
  assert.equal(adapter.adapterMode, 'volumetric-burn');
  assert.equal(adapter.activationState, 'active');
  assert.equal(adapter.visualAuthority, 'live-compute');
  assert.equal(adapter.allowsVolumetricBurn, true);
  assert.equal(adapter.falseAuthorityViolations.length, 0);
  assert.equal(adapter.volumePrimitive.id, 'live-run-001-route-volume');
  assert.equal(adapter.volumePrimitive.couplingSource, 'route-activity');
  assert.equal(adapter.volumePrimitive.topologyAuthority, 'status-volume-proxy');
  assert.equal(adapter.volumePrimitive.routeActivity.activityId, 'live-run-001-route-activity');
  assert.ok(adapter.volumeControls.fire >= 1.2, 'live burn should drive a real fire control');
  assert.ok(adapter.volumeControls.flowRate >= 0.12, 'live burn should drive a visible source flow');
  assert.ok(adapter.volumeControls.radiance >= 1.2, 'live burn should drive radiance');
});

test('partial output maps to ember volume without full burn authority', () => {
  const partial = deriveRouteActivity({
    runId: 'partial-run-001',
    requestedRoute: 'moge.depth-normal.webgpu-local.v0',
    effectiveRoute: 'moge.depth-normal.webgpu-local.v0',
    backendClass: 'webgpu-local',
    statusBadge: 'partial',
    routePhase: 'completed',
    receiptId: 'receipt-partial-001',
    inputArtifactIds: ['source-partial'],
    outputArtifactIds: ['partial-depth', 'partial-normal'],
  });
  const adapter = deriveRouteActivityVolumeAdapter(partial);

  assert.equal(adapter.adapterMode, 'volumetric-ember');
  assert.equal(adapter.activationState, 'active');
  assert.equal(adapter.visualAuthority, 'partial-output');
  assert.equal(adapter.allowsVolumetricBurn, false);
  assert.ok(adapter.volumeControls.fire > 0, 'partial output should still glow');
  assert.ok(adapter.volumeControls.fire < 1.0, 'partial output must be weaker than live burn');
  assert.ok(adapter.sourceTruthWarnings.includes('partial_output_not_promoted_artifact'));
  assert.equal(adapter.volumePrimitive.simulation.flowRate < deriveRouteActivityVolumeAdapter(liveActivity()).volumePrimitive.simulation.flowRate, true);
});

test('weak and failed evidence cannot activate full volumetric burn', () => {
  const cases = [
    ['fixture', { statusBadge: 'fixture', routePhase: 'completed', backendClass: 'fixture', expectedMode: 'volumetric-pilot' }],
    ['fallback', { statusBadge: 'fallback', routePhase: 'completed', backendClass: 'local-command', expectedMode: 'volumetric-weak-heat' }],
    ['failed', { statusBadge: 'failed', routePhase: 'failed', backendClass: 'browser-webgpu', expectedMode: 'volumetric-snuff' }],
    ['missing-backend', { statusBadge: 'missing-backend', routePhase: 'completed', backendClass: 'local-command', expectedMode: 'volumetric-cold' }],
  ];

  for (const [name, opts] of cases) {
    const activity = deriveRouteActivity({
      runId: `${name}-run-001`,
      requestedRoute: 'requested.route.v0',
      effectiveRoute: name === 'fallback' ? 'fallback.route.v0' : 'requested.route.v0',
      receiptId: `${name}-receipt`,
      inputArtifactIds: [`${name}-source`],
      ...opts,
    });
    const adapter = deriveRouteActivityVolumeAdapter(activity);
    assert.equal(adapter.adapterMode, opts.expectedMode, name);
    assert.equal(adapter.allowsVolumetricBurn, false, name);
    assert.notEqual(adapter.volumeControls.fire >= 1.2, true, `${name} must not get live fire`);
    assert.ok(!adapter.falseAuthorityViolations.includes('volume_full_burn_without_route_authority'), name);
  }
});

test('route activity false-authority violations block volume activation', () => {
  const poisoned = {
    ...liveActivity(),
    visualAuthority: 'live-compute',
    fire: {
      ...liveActivity().fire,
      allowsFullBurn: true,
    },
    falseAuthorityViolations: ['full_burn_without_live_running_route'],
  };

  const adapter = deriveRouteActivityVolumeAdapter(poisoned);
  assert.equal(adapter.activationState, 'blocked');
  assert.equal(adapter.allowsVolumetricBurn, false);
  assert.ok(adapter.falseAuthorityViolations.includes('route_activity_false_authority_blocked_volume'));
  assert.equal(adapter.volumeControls.fire, 0);
  assert.equal(adapter.volumePrimitive, null);
});

let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(err);
  }
}

console.log(`\nroute activity volume adapter contracts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
