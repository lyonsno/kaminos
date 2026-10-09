import assert from 'node:assert/strict';

export default async function ({fluid, retain, inputs}) {
  const before = await fluid.hold();
  const pending = await fluid.apply(inputs.controls);
  assert.equal(pending.application, 'pending');
  assert.equal((await fluid.read()).clock.step, before.clock.step);
  await fluid.observe(retain, 'pending');
  const after = await fluid.advanceTo(before.clock.step + inputs.steps);
  assert.equal(after.clock.generation, before.clock.generation);
  assert.equal(after.controls.effectiveGeneration, pending.generation);
  await fluid.observe(retain, 'continued');
  await fluid.view(inputs.view);
  await fluid.observe(retain, 'alternate-view');
}
