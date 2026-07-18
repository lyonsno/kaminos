import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../volume-exact-state-cadence-witness.mjs', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(
  source,
  /exerciseBoundarySplatModeTransition[\s\S]*captureRaymarchTransitionReceipt[\s\S]*raymarchApplied[\s\S]*splatApplied/,
  'raymarch leg requires a submitted GPU pass receipt rather than only an off control bit',
);
assert.match(
  core,
  /explicitRaymarchReadback[\s\S]*boundarySplatRequested\(\) \|\| explicitRaymarchReadback[\s\S]*raymarchApplied[\s\S]*splatApplied/,
  'runtime readback must emit an applied raymarch-only pass receipt while splat mode is off',
);
assert.match(
  core,
  /async function sampleFrame[\s\S]*return \{[\s\S]*boundarySplatRequestedInstanceCount:\s*state\.boundarySplatRequestedInstanceCount[\s\S]*boundarySplatHistoryDepth:\s*state\.boundarySplatHistoryDepth[\s\S]*boundarySplatHistorySlots:\s*state\.boundarySplatHistorySlots/,
  'runtime GPU readback must carry the exact instance and history allocation authority it rendered',
);
const successfulSampleFrameReturn = core.slice(
  core.indexOf('const fireLumaMean'),
  core.indexOf('function compactRenderScaleSample'),
);
assert.match(
  successfulSampleFrameReturn,
  /return \{[\s\S]*boundarySidecarSource:\s*state\.boundarySidecarSource/,
  'runtime GPU readback must carry the effective live, baked, or mix structure-source identity it rendered',
);
assert.match(
  source,
  /splat-mode-transition-raymarch-render-not-effective/,
  'toggle witness must fail loud when the off leg does not submit raymarch without splats',
);

console.log('volume exact-state cadence raymarch transition contracts passed');
