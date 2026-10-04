import assert from 'node:assert/strict';
import poseComparison from './pose-comparison.mjs';

export default async function waterPose(context) {
  const settle = async page => {
    await page.evaluate(() => window.kaminosPauseLocalLiquid(false));
    const initial = await page.evaluate(() => window.kaminosLocalLiquidState());
    await page.waitForFunction(start => {
      const state = window.kaminosLocalLiquidState();
      if (state.failure) throw Error(state.failure);
      return state.mounted && state.frameCount > start + 30;
    }, initial.frameCount);
    await page.evaluate(() => window.kaminosPauseLocalLiquid(true));
    return initial;
  };
  const observe = async page => {
    const state = await page.evaluate(() => window.kaminosLocalLiquidState());
    assert.equal(state.setup.particleCount, context.document.localLiquid.particleCount);
    assert.equal(state.setup.densityIterations, context.document.localLiquid.densityIterations);
    return { semantics: 'Authored emitters; fresh reopen restarts water. Capture holds this run.', state };
  };
  return poseComparison({ ...context, settle, observe });
}
