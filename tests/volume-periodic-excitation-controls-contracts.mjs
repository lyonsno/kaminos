import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertWgslCallsOwnedByBlock } from './helpers/wgsl-guard-ownership.mjs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));

assert.match(index, /<input[^>]+type="checkbox"[^>]+id="volume-procedural-detail-forces"[^>]+checked/, 'procedural detail forces remain a live default-on excitation switch');
assert.deepEqual(schema.controls.find(control => control.key === 'volume-procedural-detail-forces'), {
  key: 'volume-procedural-detail-forces',
  param: 'volume_procedural_detail_forces',
  tagName: 'INPUT',
  type: 'checkbox',
  additiveDefault: true,
}, 'procedural detail forces remain additive and persisted');
assert.ok(index.includes("proceduralDetailForces: document.getElementById('volume-procedural-detail-forces').checked"));
assert.ok(index.includes("params.has('volume_procedural_detail_forces')"));
assert.match(index, /'proceduralDetailForces', 'volume_procedural_detail_forces'/);

assert.doesNotMatch(index, /id="volume-procedural-transport-slip"/, 'retired transport slip is absent from the live cockpit');
assert.doesNotMatch(index, /volume_procedural_transport_slip/, 'retired transport slip has no live route authority');
assert.equal(schema.controls.some(control => control.key === 'volume-procedural-transport-slip'), false);
assert.deepEqual(schema.retiredControls.find(control => control.key === 'volume-procedural-transport-slip'), {
  axis: 'domControls',
  key: 'volume-procedural-transport-slip',
  param: 'volume_procedural_transport_slip',
  tagName: 'INPUT',
  type: 'checkbox',
}, 'historical preset data crosses an explicit retirement boundary');

assert.equal(schema.controlCount, schema.controls.length, 'schema count derives from the canonical inventory');
assert.match(core, /uniforms\[366\] = controlsSnapshot\.proceduralDetailForces === false \? 0 : 1/);
assert.match(core, /uniforms\[367\] = 0;/, 'retired ABI slot remains reserved at zero authority');
assert.match(core, /let proceduralDetailForces = step\(0\.5, u\.artistic_motion_controls\.z\);/);
assert.doesNotMatch(core, /let proceduralTransportSlip =|fn transportedScalarSlip\(/);

const detailGateStart = core.indexOf('if (proceduralDetailForces > 0.5) {');
assert.notEqual(detailGateStart, -1, 'transported detail-force operator gate is present');
for (const force of ['detailForce', 'microForce', 'shredForce', 'fineBreakup']) {
  assert.match(core, new RegExp(`var ${force} = vec3<f32>\\(0\\.0\\);`), `${force} initializes inert`);
}
for (const call of ['transportedDetailDirection', 'interfaceShreddingForce', 'fieldDerivedFineScaleBreakup']) {
  assert.ok(core.indexOf(`${call}(`, detailGateStart) > detailGateStart, `${call} is evaluated only after the detail-force gate`);
}
assertWgslCallsOwnedByBlock(core, 'if (proceduralDetailForces > 0.5) {', {
  transportedDetailDirection: 2,
  interfaceShreddingForce: 1,
  fieldDerivedFineScaleBreakup: 1,
}, { label: 'persisted procedural detail-force control guard' });
assert.match(core, /const periodicDetailForceEvaluationsPerCell = 0;/, 'retired periodic detail-force work is explicit in the cost ledger');
assert.match(core, /vel = vel \+ confinement \* \(0\.35 \+ smoke \* 0\.34 \+ heat \* 0\.52\);/, 'field-derived vorticity confinement remains independent');
assert.match(core, /vel = vel \+ heatExpansion;/, 'thermal expansion remains independent');

console.log('volume periodic excitation controls: detail forces remain inspectable and microdetail transport slip is retired');
