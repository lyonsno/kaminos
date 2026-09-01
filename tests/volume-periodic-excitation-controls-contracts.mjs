import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));
const cockpitBindingStart = index.indexOf("for (const id of ['volume-scene', 'emitter-assay-family'");
assert.notEqual(cockpitBindingStart, -1, 'cockpit input binding inventory is present');
const cockpitBindingEnd = index.indexOf(']) {', cockpitBindingStart);
assert.notEqual(cockpitBindingEnd, -1, 'cockpit input binding inventory closes');
const cockpitBindingInventory = index.slice(cockpitBindingStart, cockpitBindingEnd);

for (const [id, param, controlKey] of [
  ['volume-procedural-detail-forces', 'volume_procedural_detail_forces', 'proceduralDetailForces'],
  ['volume-procedural-transport-slip', 'volume_procedural_transport_slip', 'proceduralTransportSlip'],
]) {
  assert.match(
    index,
    new RegExp(`<input[^>]+type="checkbox"[^>]+id="${id}"[^>]+checked`),
    `${id} is a live default-on excitation switch`,
  );
  assert.deepEqual(
    schema.controls.find(control => control.key === id),
    { key: id, param, tagName: 'INPUT', type: 'checkbox', additiveDefault: true },
    `${id} is additive and persisted by the strict preset inventory`,
  );
  assert.ok(
    index.includes(`${controlKey}: document.getElementById('${id}').checked`),
    `${id} reaches the runtime control snapshot`,
  );
  assert.ok(index.includes(`params.has('${param}')`), `${id} restores from an exact route`);
  assert.match(index, new RegExp(`'${controlKey}', '${param}'`), `${id} participates in snapshot routes`);
  assert.ok(cockpitBindingInventory.includes(`'${id}'`), `${id} drives the live cockpit on input and change`);
}

assert.equal(schema.controlCount, schema.controls.length, 'schema count derives from the canonical inventory');
assert.match(core, /uniforms\[366\] = controlsSnapshot\.proceduralDetailForces === false \? 0 : 1/);
assert.match(core, /uniforms\[367\] = controlsSnapshot\.proceduralTransportSlip === false \? 0 : 1/);
assert.match(core, /let proceduralDetailForces = step\(0\.5, u\.artistic_motion_controls\.z\);/);
assert.match(core, /let proceduralTransportSlip = step\(0\.5, u\.artistic_motion_controls\.w\);/);
assert.match(
  core,
  /var slip = vec3<f32>\(0\.0\);[\s\S]*if \(proceduralTransportSlip > 0\.5\) \{[\s\S]*let rawSlip = transportedScalarSlip\(/,
  'transport-slip control prevents field-derived slip evaluation at its only advection consumer',
);
const detailGateStart = core.indexOf('if (proceduralDetailForces > 0.5) {');
assert.notEqual(detailGateStart, -1, 'transported detail-force operator gate is present');
for (const force of ['detailForce', 'microForce', 'shredForce', 'fineBreakup']) {
  assert.match(core, new RegExp(`var ${force} = vec3<f32>\\(0\\.0\\);`), `${force} initializes inert`);
}
for (const call of ['transportedDetailDirection', 'interfaceShreddingForce', 'fieldDerivedFineScaleBreakup']) {
  assert.ok(core.indexOf(`${call}(`, detailGateStart) > detailGateStart, `${call} is evaluated only after the detail-force gate`);
}
assert.match(core, /const periodicDetailForceEvaluationsPerCell = 0;/, 'retired periodic detail-force work is explicit in the cost ledger');
assert.match(
  core,
  /vel = vel \+ confinement \* \(0\.35 \+ smoke \* 0\.34 \+ heat \* 0\.52\);/,
  'field-derived vorticity confinement remains independent of procedural detail forces',
);
assert.match(core, /vel = vel \+ heatExpansion;/, 'thermal expansion remains independent of procedural detail forces');

console.log('volume periodic excitation controls: independent persisted detail-force and transport-slip gates pass');
