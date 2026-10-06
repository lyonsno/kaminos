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
export function experiment({ page, retain }) {
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return {
    async pose(id, patch) {
      const result = await page.evaluate(({ id, patch }) => window.kaminosSetSceneObjectTransform(id, patch), { id, patch });
      if (!result) throw Error(`Pose edit failed: ${id}`);
      return result;
    },
    async camera(view) {
      await page.evaluate(view => window.kaminosSetCameraDebugPose(view), view); await frames();
      return page.evaluate(() => window.kaminosCameraDebugState());
    },
    water: {
      hold: () => page.evaluate(() => window.kaminosLocalLiquidClock.hold()),
      advanceTo: seconds => page.evaluate(seconds => window.kaminosLocalLiquidClock.advanceTo(seconds), seconds),
      read: () => page.evaluate(() => window.kaminosLocalLiquidState()),
    },
    async observe(name, { water = false } = {}) {
      await frames();
      let before;
      const result = await retain({ name, observe: async () => {
        before = await page.evaluate(() => ({ camera: window.kaminosCameraDebugState(), objects: window.kaminosSceneObjectDebugState(),
          water: window.kaminosLocalLiquidState() }));
        if (water) assertHeldWater(before.water);
        return before;
      } });
      const after = await page.evaluate(() => ({ camera: window.kaminosCameraDebugState(), objects: window.kaminosSceneObjectDebugState(), water: window.kaminosLocalLiquidState() }));
      assert.deepEqual(after.camera, before.camera, 'Camera changed during observation');
      assert.deepEqual(after.objects, before.objects, 'Authored objects changed during observation');
      if (water) assert.deepEqual(assertHeldWater(after.water), assertHeldWater(before.water), 'Water runtime/source changed during observation');
      return { ...result, observed: before };
    },
  };
}
