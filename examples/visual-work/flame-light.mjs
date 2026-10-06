import assert from 'node:assert/strict';

export default async function flameLight({ page, open, retain, inputs }) {
  const settle = async page => {
    const start = await page.evaluate(() => window.__kaminosVolumePrototype.debugState().frameCount);
    await page.waitForFunction(start => {
      const state = window.__kaminosVolumePrototype.debugState();
      if (state.error) throw Error(state.error);
      return state.active && state.frameCount > start + 2;
    }, start);
  };
  const observe = page => page.evaluate(() => ({ semantics: 'Live evolving field, authored light-gain comparison',
    volume: window.__kaminosVolumePrototype.debugState(),
    lightGain: Number(document.getElementById('fire-light-gain-stops').value) }));
  const targets = await page.evaluate(() => window.kaminosAuthoringParameters.list());
  const a = await retain({ name: 'a', settle, observe });
  const gain = a.document.composition.lightGainStops + (inputs.deltaStops ?? 1);
  await page.evaluate(gain => window.kaminosAuthoringParameters.set('@parameter:fire-light-gain-stops', { value: gain }), gain);
  const b = await retain({ name: 'b', settle, observe });
  assert.equal(b.document.composition.lightGainStops, gain);
  assert.deepEqual(b.document.camera, a.document.camera);
  assert.deepEqual(b.document.objects, a.document.objects);
  await open(b.filename);
  await settle(page);
  assert.equal(await page.locator('#fire-light-gain-stops').inputValue(), String(gain));
  return { targets, handoff: { filename: b.filename, url: b.url } };
}
