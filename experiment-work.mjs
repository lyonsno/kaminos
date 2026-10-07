import assert from 'node:assert/strict';

export function pausedWaterUrl(url) {
  const params = new URLSearchParams(url.hash.slice(1)); params.set('water_paused', '1'); url.hash = params.toString(); return url;
}
export function assertHeldWater(state) {
  assert.ok(state?.mounted && state.effectiveRoute === state.requestedRoute && state.effectiveRoute
    && !state.failure && !state.clock?.failure, 'Live water route unavailable');
  const clock = state.clock;
  assert.ok(clock?.runId && clock.paused && !clock.busy && clock.completedSteps === clock.submittedSteps,
    'Water observation requires a held, drained runtime');
  assert.ok(state.lastFrame?.submittedSteps === clock.completedSteps, 'Water display has not presented the held step');
  return { runId: clock.runId, completedSteps: clock.completedSteps, sourceGeneration: state.sourceGeneration };
}

// An ordinary experiment can use any of these independently, alongside custom
// feature operations and decisions based on returned observations.
export function workbenchRuntime(page) {
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return {
    settle: frames,
    async camera(view) {
      await page.evaluate(view => window.kaminosSetCameraDebugPose(view), view); await frames();
      return page.evaluate(() => window.kaminosCameraDebugState());
    },
    read: () => page.evaluate(() => ({ camera: window.kaminosCameraDebugState(), objects: window.kaminosSceneObjectDebugState(),
      water: window.kaminosLocalLiquidState() })),
    assertStable(before, after, { water = false } = {}) {
      assert.deepEqual(after.camera, before.camera, 'Camera changed during observation');
      assert.deepEqual(after.objects, before.objects, 'Authored objects changed during observation');
      if (water) assert.deepEqual(assertHeldWater(after.water), assertHeldWater(before.water), 'Water runtime/source changed during observation');
    },
    validate(state, { water = false } = {}) { if (water) assertHeldWater(state.water); },
  };
}

export function experiment({ page, retain, runtime = workbenchRuntime(page) }) {
  for (const name of ['settle', 'read', 'camera', 'assertStable']) assert.equal(typeof runtime[name], 'function', `runtime.${name} required`);
  return {
    runtime,
    async pose(id, patch) {
      const result = await page.evaluate(({ id, patch }) => window.kaminosSetSceneObjectTransform(id, patch), { id, patch });
      if (!result) throw Error(`Pose edit failed: ${id}`);
      return result;
    },
    camera: view => runtime.camera(view),
    water: {
      hold: () => page.evaluate(() => window.kaminosLocalLiquidClock.hold()),
      advanceTo: seconds => page.evaluate(seconds => window.kaminosLocalLiquidClock.advanceTo(seconds), seconds),
      read: () => page.evaluate(() => window.kaminosLocalLiquidState()),
    },
    async observe(name, options = {}) {
      await runtime.settle();
      let before, verified = false;
      const result = await retain({ name, observe: async () => {
        before = structuredClone(await runtime.read());
        assert.ok(before && typeof before === 'object', 'Runtime observation missing');
        await runtime.validate?.(before, options);
        return before;
      }, verify: async () => {
        const after = await runtime.read();
        assert.ok(after && typeof after === 'object', 'Runtime observation missing');
        await runtime.validate?.(after, options);
        await runtime.assertStable(before, after, options);
        verified = true;
      } });
      assert.ok(verified, 'Retention must verify the runtime after capture');
      return { ...result, observed: before };
    },
  };
}
