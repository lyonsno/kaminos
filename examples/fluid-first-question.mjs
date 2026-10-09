export default async function ({fluid, retain, inputs}) {
  const held = await fluid.hold();
  await fluid.advanceTo(held.clock.step + inputs.steps);
  await fluid.observe(retain, 'initial');
}
