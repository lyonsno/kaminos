import test from 'node:test';
import assert from 'node:assert/strict';
import {createFluidWorkingSession, assertFluidObservationStable} from '../fluid-working-session.mjs';
import {createIPBFPressureControlState} from '../finger-fluid-pressure-controls.mjs';

// Local policy fixture; native conformance uses the real mounted bench.
function fixture() {
  const clock = {generation: 1, step: 30, available: true, paused: false, running: true};
  const controls = createIPBFPressureControlState({baseRadius: .185, pressureRadiusScale: 1,
    beta: 60, densityIterations: 2, capillaryStrength: 0});
  const runtime = {available: true, solver_backend: 'webgpu_compute', particleCount: 1};
  let target = null, stale = false, partial = false, resetOnRead = false, reads = 0;
  let camera = {yaw: 0};
  const host = {
    kaminosFingerFluidBenchSessionState: () => ({...clock}),
    kaminosFingerFluidBenchDebugState: () => ({config: {effectiveRendererMode: 'screen_space_refraction'}, runtime}),
    kaminosFingerFluidPressureCockpitState: controls.read,
    kaminosFingerFluidCompositionCameraState: () => camera,
    kaminosFingerFluidBenchViewportState: () => ({effective: 'shared', lastFrame: {presentedByHost: true}}),
    kaminosFingerFluidBenchSetSimulationPausedForWitness: paused => {clock.paused = paused;},
    kaminosFingerFluidBenchRequestDiagnostics: async () => {
      reads++;
      if (resetOnRead) clock.generation++;
      runtime.diagnostics = {stepCount: clock.step, particleSnapshot: {stepCount: clock.step, words: Array(partial ? 15 : 16).fill(17)}};
      return {diagnosticsStepCount: stale ? clock.step - 1 : clock.step};
    },
    kaminosFingerFluidBenchRenderCurrentStateForWitness: () => {},
    kaminosFingerFluidBenchAdvanceToStepForWitness: step => {
      if (target !== null && step > target) throw Error('exceeds routed target');
      assert.equal(clock.paused, true); clock.step = step; controls.submit(step);
      return {endStep: step};
    },
    kaminosFingerFluidPressureCockpitApply: controls.request,
    kaminosFingerFluidBenchSetCameraForWitness: patch => {camera = {...camera, ...patch};},
  };
  return {host, clock, runtime, controls, get reads() {return reads;},
    target: value => {target = value;}, stale: () => {stale = true;}, partial: () => {partial = true;},
    resetDuringRead: () => {resetOnRead = true;}};
}

test('held same-water followup exposes pending controls then applies on deliberate advance', async () => {
  const f = fixture(), session = createFluidWorkingSession(f.host);
  const first = await session.hold();
  assert.equal(first.clock.step, 30);
  assert.equal((await session.apply({beta: 12})).application, 'pending');
  assert.equal(f.clock.step, 30);
  assert.equal(f.controls.read().effective.beta, 60);
  const next = await session.advanceTo(300);
  assert.equal(next.clock.generation, first.clock.generation);
  assert.equal(next.controls.effective.beta, 12);
  assert.equal(next.controls.effectiveGeneration, next.controls.generation);
  assert.equal(next.clock.step, 300);
  const seen = await session.view({yaw: .6});
  assert.equal(seen.clock.step, 300);
  assert.equal(seen.camera.yaw, .6);
  assert.equal(f.reads, 2);
});

test('bounded route keeps its stop and invalid control leaves current state intact', async () => {
  const f = fixture(), session = createFluidWorkingSession(f.host);
  await session.hold(); f.target(40);
  await assert.rejects(session.advanceTo(41), /exceeds routed target/);
  await assert.rejects(session.apply({beta: 0}), /finite and positive/);
  assert.equal(f.clock.step, 30);
  assert.equal(f.controls.read().generation, 0);
});

test('reset/replaced water fails an existing binding', async () => {
  const f = fixture(), session = createFluidWorkingSession(f.host);
  await session.hold(); f.clock.generation++;
  await assert.rejects(session.advanceTo(40), /runtime changed/);
});

for (const [kind, expected] of [['stale', /stale/], ['partial', /partial/], ['resetDuringRead', /runtime changed/]]) {
  test(`${kind} readback cannot be a held observation`, async () => {
    const f = fixture(), session = createFluidWorkingSession(f.host); f[kind]();
    await assert.rejects(session.hold(), expected);
  });
}
test('fallback backend, unpaused water and changed camera cannot silently pass', async () => {
  const f = fixture(), session = createFluidWorkingSession(f.host);
  await assert.rejects(session.apply({beta: 12}), /paused/);
  const a = await session.hold();
  await session.view({yaw: 1});
  assert.throws(() => assertFluidObservationStable(a, session.read()), /camera changed/);
  f.runtime.solver_backend = 'cpu_fallback';
  await assert.rejects(session.hold(), /GPU route/);
});
