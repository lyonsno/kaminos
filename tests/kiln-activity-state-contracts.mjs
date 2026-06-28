import { strict as assert } from 'node:assert';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`FAIL: ${name}\n  ${err.message}`);
  }
}

let mod;
try {
  mod = await import('../route-composition-tray.mjs');
} catch (err) {
  console.error(`FAIL: route-composition-tray.mjs import failed\n  ${err.message}`);
  process.exit(1);
}

const {
  KILN_ACTIVITY_STATE_SCHEMA,
  KILN_ACTIVITY_STATES,
  KILN_TRUTH_MODES,
  deriveKilnActivityState,
  createTray,
  addRouteRun,
  updateRouteRun,
  buildFixtureWitnessTray,
  trayWitness,
} = mod;

test('kiln activity schema and state vocabulary are exported', () => {
  assert.equal(KILN_ACTIVITY_STATE_SCHEMA, 'kaminos.kiln.activity-state.v0');
  for (const state of ['cold', 'queued', 'warming', 'burning', 'banking', 'cooled', 'failed', 'cached', 'fixture', 'fallback', 'unavailable']) {
    assert.ok(KILN_ACTIVITY_STATES.includes(state), `missing kiln state ${state}`);
  }
  for (const mode of ['live', 'cached', 'fixture', 'fallback', 'unavailable', 'failed']) {
    assert.ok(KILN_TRUTH_MODES.includes(mode), `missing kiln truth mode ${mode}`);
  }
});

test('real running route is the only default path to burning authority', () => {
  const state = deriveKilnActivityState({
    statusBadge: 'real',
    routePhase: 'running',
    backendClass: 'local-command',
    requestedRoute: 'sharp_image_to_splat',
    effectiveRoute: 'sharp_image_to_splat',
  });
  assert.equal(state.schema, KILN_ACTIVITY_STATE_SCHEMA);
  assert.equal(state.activityState, 'burning');
  assert.equal(state.truthMode, 'live');
  assert.equal(state.visualAuthority, 'live-compute');
  assert.equal(state.allowsFullBurn, true);
  assert.equal(state.claimsLiveCompute, true);
});

test('real completed route cools instead of continuing to burn', () => {
  const state = deriveKilnActivityState({
    statusBadge: 'real',
    routePhase: 'completed',
    backendClass: 'local-command',
  });
  assert.equal(state.activityState, 'cooled');
  assert.equal(state.truthMode, 'live');
  assert.equal(state.allowsFullBurn, false);
  assert.equal(state.claimsLiveCompute, false);
});

test('cached route gets warm recall but cannot masquerade as burning', () => {
  const state = deriveKilnActivityState({
    statusBadge: 'cached',
    routePhase: 'completed',
    backendClass: 'cache',
  });
  assert.equal(state.activityState, 'cached');
  assert.equal(state.truthMode, 'cached');
  assert.equal(state.visualAuthority, 'warm-recall');
  assert.equal(state.allowsFullBurn, false);
  assert.equal(state.claimsLiveCompute, false);
  assert.ok(state.sourceTruthWarnings.includes('cached_not_fresh_compute'));
});

test('fixture route gets demo burn authority only', () => {
  const state = deriveKilnActivityState({
    statusBadge: 'fixture',
    routePhase: 'running',
    backendClass: 'fixture',
  });
  assert.equal(state.activityState, 'fixture');
  assert.equal(state.truthMode, 'fixture');
  assert.equal(state.visualAuthority, 'demo-fixture');
  assert.equal(state.allowsFullBurn, false);
  assert.equal(state.claimsLiveCompute, false);
  assert.ok(state.sourceTruthWarnings.includes('fixture_kiln_not_live_compute'));
});

test('missing backend is unavailable and cannot ignite', () => {
  const state = deriveKilnActivityState({
    statusBadge: 'missing-backend',
    routePhase: 'queued',
    backendClass: 'missing',
  });
  assert.equal(state.activityState, 'unavailable');
  assert.equal(state.truthMode, 'unavailable');
  assert.equal(state.visualAuthority, 'none');
  assert.equal(state.allowsFullBurn, false);
  assert.equal(state.claimsLiveCompute, false);
  assert.ok(state.sourceTruthWarnings.includes('kiln_backend_unavailable'));
});

test('fallback route is visibly weaker than live burn', () => {
  const state = deriveKilnActivityState({
    statusBadge: 'fallback',
    routePhase: 'running',
    backendClass: 'local-command',
  });
  assert.equal(state.activityState, 'fallback');
  assert.equal(state.truthMode, 'fallback');
  assert.equal(state.visualAuthority, 'degraded-fallback');
  assert.equal(state.allowsFullBurn, false);
  assert.equal(state.claimsLiveCompute, false);
  assert.ok(state.sourceTruthWarnings.includes('fallback_kiln_not_requested_route'));
});

test('route run carries kiln state beside source and route identity', () => {
  let tray = createTray({ trayId: 'kiln-test-tray' });
  tray = addRouteRun(tray, {
    runId: 'run-burning',
    requestedRoute: 'sharp_image_to_splat',
    effectiveRoute: 'sharp_image_to_splat',
    backendClass: 'local-command',
    statusBadge: 'real',
    routePhase: 'running',
    receiptId: 'receipt-burning',
    inputArtifactIds: ['src-001'],
  });
  const run = tray.routeRuns[0];
  assert.equal(run.kilnActivity.schema, KILN_ACTIVITY_STATE_SCHEMA);
  assert.equal(run.kilnActivity.activityState, 'burning');
  assert.equal(run.kilnActivity.requestedRoute, 'sharp_image_to_splat');
  assert.equal(run.kilnActivity.effectiveRoute, 'sharp_image_to_splat');
  assert.equal(run.kilnActivity.backendClass, 'local-command');
  assert.equal(run.kilnActivity.statusBadge, 'real');
  assert.equal(run.kilnActivity.receiptId, 'receipt-burning');
});

test('route run lifecycle updates progress from SHARP preheat to live burn to cooling output', () => {
  let tray = createTray({ trayId: 'kiln-lifecycle-test-tray' });
  tray = updateRouteRun(tray, {
    runId: 'sharp-run-001',
    requestedRoute: 'adapter.sharp-image-to-splat-live.v0',
    effectiveRoute: 'adapter.sharp-image-to-splat-live.v0',
    backendClass: 'browser-webgpu',
    statusBadge: 'real',
    routePhase: 'queued',
    receiptId: 'sharp-run-001',
    inputArtifactIds: ['source-red-lerm-001'],
  });
  assert.equal(tray.routeRuns.length, 1);
  assert.equal(tray.routeRuns[0].kilnActivity.activityState, 'queued');
  assert.equal(tray.routeRuns[0].kilnActivity.allowsFullBurn, false);

  tray = updateRouteRun(tray, {
    runId: 'sharp-run-001',
    routePhase: 'running',
  });
  assert.equal(tray.routeRuns.length, 1, 'lifecycle update must not duplicate the route run');
  assert.equal(tray.routeRuns[0].displayStatus, 'Running');
  assert.equal(tray.routeRuns[0].kilnActivity.activityState, 'burning');
  assert.equal(tray.routeRuns[0].kilnActivity.truthMode, 'live');
  assert.equal(tray.routeRuns[0].kilnActivity.allowsFullBurn, true);
  assert.equal(tray.routeRuns[0].kilnActivity.claimsLiveCompute, true);

  tray = updateRouteRun(tray, {
    runId: 'sharp-run-001',
    routePhase: 'banking',
    receiptId: '/tmp/kaminos/sharp-run-001/report.json',
    outputArtifactIds: ['sharp-run-001-splat'],
  });
  assert.equal(tray.routeRuns[0].displayStatus, 'Banking');
  assert.equal(tray.routeRuns[0].kilnActivity.activityState, 'banking');
  assert.equal(tray.routeRuns[0].kilnActivity.allowsFullBurn, false);
  assert.deepEqual(tray.routeRuns[0].outputArtifactIds, ['sharp-run-001-splat']);

  tray = updateRouteRun(tray, {
    runId: 'sharp-run-001',
    routePhase: 'completed',
  });
  assert.equal(tray.routeRuns[0].displayStatus, 'Completed');
  assert.equal(tray.routeRuns[0].kilnActivity.activityState, 'cooled');
  assert.equal(tray.routeRuns[0].kilnActivity.claimsLiveCompute, false);
});

test('failed lifecycle update snuffs a real SHARP run without live burn authority', () => {
  let tray = createTray({ trayId: 'kiln-failure-test-tray' });
  tray = updateRouteRun(tray, {
    runId: 'sharp-run-failed',
    requestedRoute: 'adapter.sharp-image-to-splat-live.v0',
    effectiveRoute: 'adapter.sharp-image-to-splat-live.v0',
    backendClass: 'browser-webgpu',
    statusBadge: 'real',
    routePhase: 'running',
    receiptId: 'sharp-run-failed',
  });
  assert.equal(tray.routeRuns[0].kilnActivity.activityState, 'burning');

  tray = updateRouteRun(tray, {
    runId: 'sharp-run-failed',
    statusBadge: 'failed',
    routePhase: 'failed',
    receiptId: '/tmp/kaminos/sharp-run-failed/report.json',
  });
  assert.equal(tray.routeRuns[0].kilnActivity.activityState, 'failed');
  assert.equal(tray.routeRuns[0].kilnActivity.truthMode, 'failed');
  assert.equal(tray.routeRuns[0].kilnActivity.allowsFullBurn, false);
  assert.ok(tray.routeRuns[0].sourceTruthWarnings.includes('route_execution_failed'));
  assert.ok(tray.routeRuns[0].sourceTruthWarnings.includes('kiln_route_failed'));
});

test('non-real lifecycle updates cannot claim full burn while running', () => {
  let tray = createTray({ trayId: 'kiln-fallback-test-tray' });
  tray = updateRouteRun(tray, {
    runId: 'sharp-run-fallback',
    requestedRoute: 'adapter.sharp-image-to-splat-live.v0',
    effectiveRoute: 'fixture_generator',
    backendClass: 'fixture',
    statusBadge: 'fixture',
    routePhase: 'running',
    receiptId: 'fixture-run',
  });
  assert.equal(tray.routeRuns[0].kilnActivity.activityState, 'fixture');
  assert.equal(tray.routeRuns[0].kilnActivity.allowsFullBurn, false);
  assert.equal(tray.routeRuns[0].kilnActivity.claimsLiveCompute, false);
});

test('fixture witness tray exposes non-live kiln warnings in witness summary', () => {
  const tray = buildFixtureWitnessTray();
  assert.ok(tray.routeRuns.every(run => run.kilnActivity), 'fixture route runs must carry kiln activity');
  assert.ok(tray.routeRuns.some(run => run.kilnActivity.activityState === 'fixture'));
  assert.ok(tray.routeRuns.some(run => run.kilnActivity.activityState === 'unavailable'));

  const witness = trayWitness(tray);
  assert.ok(witness.kilnActivityStateCounts.fixture >= 1, 'witness must count fixture kiln states');
  assert.ok(witness.kilnActivityStateCounts.unavailable >= 1, 'witness must count unavailable kiln states');
  assert.ok(witness.sourceTruthWarnings.includes('fixture_kiln_not_live_compute'));
  assert.ok(witness.sourceTruthWarnings.includes('kiln_backend_unavailable'));
});

console.log(`\nkiln activity state contracts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
