import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';
import { effectiveMismatches } from '../volume-arm-capture-checks.mjs';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));

// The converged solve reads the stored velocity as the upper face of each axis
// (compact backward divergence, forward gradient) while the transport read it
// as the cell centre: a half-cell shift along +x and +z that leaned every
// plume toward -x -z (report section 25). Staggered transport, opt-in, reads it
// as faces: the characteristic uses the two-face mean per component, and the
// carried velocity is sampled at the plain foot (its destination is a face too).
test('velocity staggering resolves from the control and is admitted only under the converged solver', () => {
  const off = core.resolveVelocityStaggeringConfig({});
  assert.equal(off.identity, 'kaminos.volume.velocity-staggering.v1');
  assert.deepEqual(off.effective, { mode: 'collocated', admitted: false, reason: 'velocity-staggering-not-requested' });
  const legacy = core.resolveVelocityStaggeringConfig({ velocityStaggering: 'staggered', pressureSolver: 'legacy' });
  assert.deepEqual(legacy.effective, { mode: 'collocated', admitted: false, reason: 'velocity-staggering-requires-converged-pressure-solver' });
  assert.deepEqual(legacy.requested, { mode: 'staggered', pressureSolver: 'legacy' });
  const on = core.resolveVelocityStaggeringConfig({ velocityStaggering: 'staggered', pressureSolver: 'converged-open-top' });
  assert.deepEqual(on.effective, { mode: 'staggered', admitted: true, reason: null });
  const onClosed = core.resolveVelocityStaggeringConfig({ velocityStaggering: 'staggered', pressureSolver: 'converged' });
  assert.equal(onClosed.effective.admitted, true, 'the closed-top converged solve uses the same compact pair');
  assert.deepEqual(core.resolveVelocityStaggeringConfig({ velocityStaggering: 'nonsense', pressureSolver: 'converged-open-top' }).effective.mode, 'collocated');
});

test('the staggering uniform follows the heat-release block and packs 1 only when admitted', () => {
  assert.equal(core.VELOCITY_STAGGERING_UNIFORM_OFFSET, core.HEAT_RELEASE_UNIFORM_OFFSET + 4);
  assert.equal(core.VOLUME_UNIFORM_FLOATS, core.VELOCITY_STAGGERING_UNIFORM_OFFSET + 4);
  assert.deepEqual(core.velocityStaggeringUniformValues(core.resolveVelocityStaggeringConfig({ velocityStaggering: 'staggered', pressureSolver: 'converged-open-top' })), [1, 0, 0, 0]);
  assert.deepEqual(core.velocityStaggeringUniformValues(core.resolveVelocityStaggeringConfig({ velocityStaggering: 'staggered', pressureSolver: 'legacy' })), [0, 0, 0, 0]);
  assert.match(source, /heat_release: vec4<f32>,\n(?:\s*\/\/[^\n]*\n)*\s*velocity_staggering: vec4<f32>,/, 'uniform struct field after heat_release');
  assert.match(source, /uniforms\.set\(velocityStaggeringUniformValues\(velocityStaggeringConfig\), VELOCITY_STAGGERING_UNIFORM_OFFSET\);\s*state\.velocityStaggering = velocityStaggeringConfig;/);
});

test('the shader builds the characteristic from the two-face mean when staggered and samples the carried velocity at the plain foot', () => {
  const centre = source.slice(source.indexOf('fn centreVelocityAt('), source.indexOf('\n}\n', source.indexOf('fn centreVelocityAt(')));
  assert.match(centre, /if \(!velocityStaggered\(\)\) \{ return stored; \}/);
  assert.match(centre, /compactFaceVelocity\(c, 0u\) \+ compactFaceVelocity\(c - vec3<i32>\(1, 0, 0\), 0u\)/);
  assert.match(centre, /compactFaceVelocity\(c, 1u\) \+ compactFaceVelocity\(c - vec3<i32>\(0, 1, 0\), 1u\)/);
  assert.match(centre, /compactFaceVelocity\(c, 2u\) \+ compactFaceVelocity\(c - vec3<i32>\(0, 0, 1\), 2u\)/);
  // Both kernels build the characteristic from the centre velocity.
  const predictor = source.slice(source.indexOf('fn csTransportPredict('), source.indexOf('\n}\n', source.indexOf('fn csTransportPredict(')));
  assert.match(predictor, /let centreVelocity = centreVelocityAt\(vec3<i32>\(gid\)\);/);
  assert.match(predictor, /let advectVelocity = vec3<f32>\(centreVelocity\.x \* bonfireAdvectionLateralDamping, centreVelocity\.y, centreVelocity\.z \* bonfireAdvectionLateralDamping\);/);
  const main = source.slice(source.indexOf('\nfn cs(@builtin'), source.indexOf('let macCormack = u.transport_controls.x > 1.5;'));
  assert.match(main, /let centreVelocity = centreVelocityAt\(cellI\);/);
  assert.match(main, /let advectVelocity = vec3<f32>\(centreVelocity\.x \* bonfireAdvectionLateralDamping, centreVelocity\.y, centreVelocity\.z \* bonfireAdvectionLateralDamping\);/);
  // The carried velocity is sampled at the plain foot: destination face and
  // sampler offset cancel (a −½ per-component sample offset flipped the lean to +x).
  assert.doesNotMatch(source, /sampleCarriedVelocity|samplePredictVelocity/, 'no per-component sample offset');
  assert.match(source, /advected = sampleFluidSlotInflow\(backCell, 0u\);/);
  assert.match(predictor, /fluidPredict\[base \+ slot\] = sampleFluidSlotInflow\(backCell, slot\);/);
});

test('cockpit: the staggering select with help, snapshot, listener, route restore, receipt; schema additive 235', () => {
  assert.match(index, /<select id="volume-velocity-staggering" class="select-input" data-volume-settings-param="volume_velocity_staggering">\s*<option value="collocated" selected>/);
  assert.match(index, /<option value="staggered">/);
  assert.match(index, /velocityStaggering: document\.getElementById\('volume-velocity-staggering'\)\.value/);
  assert.match(index, /getElementById\('volume-velocity-staggering-val'\)\.textContent = /);
  const listenerList = index.slice(index.indexOf("'volume-emitter-source-law',"), index.indexOf("'volume-wind-gust-veer',") + 600);
  assert.ok(listenerList.includes("'volume-velocity-staggering',"), 'change listener');
  const init = index.slice(index.indexOf('async function initKaminosVolumeRoute()'), index.indexOf('\n}\n', index.indexOf('async function initKaminosVolumeRoute()')));
  assert.match(init, /VOLUME_ROUTE_RESTORED_CONTROL_IDS = \[[^\]]*'volume-velocity-staggering'/, 'restored from a saved route');
  const rowEnd = index.indexOf('</div>', index.indexOf('id="volume-velocity-staggering"'));
  assert.match(index.slice(rowEnd, rowEnd + 400), /^<\/div>\s*<span class="slider-help">/, 'help follows the row');
  assert.match(index, /half a cell/, 'the help names the shift');
  assert.match(index, /id="volume-velocity-staggering-state"/, 'receipt field');
  assert.match(index, /staggered — NOT ADMITTED \(\$\{/, 'a refused request is named');
  const control = schema.controls.find(c => c.key === 'volume-velocity-staggering');
  assert.deepEqual(control, { key: 'volume-velocity-staggering', param: 'volume_velocity_staggering', tagName: 'SELECT', type: 'select-one', additiveDefault: 'collocated', additiveSinceControlCount: 235 });
  assert.ok(schema.controlCount >= 235);
  assert.equal(schema.controls.length, schema.controlCount);
});

test('the capture carries the staggering receipt and its check cannot be satisfied by a refused or absent receipt', () => {
  assert.match(capture, /velocityStaggering: s\.velocityStaggering \?\? null/);
  const on = { set: [['volume-velocity-staggering', 'staggered']] };
  assert.deepEqual(effectiveMismatches(on, { velocityStaggering: { effective: { mode: 'staggered', admitted: true, reason: null } } }, null), []);
  assert.equal(effectiveMismatches(on, { velocityStaggering: { effective: { mode: 'collocated', admitted: false, reason: 'velocity-staggering-requires-converged-pressure-solver' } } }, null).length, 1);
  assert.equal(effectiveMismatches(on, {}, null).length, 1, 'no receipt fails');
  const off = { set: [['volume-velocity-staggering', 'collocated']] };
  assert.deepEqual(effectiveMismatches(off, { velocityStaggering: { effective: { mode: 'collocated', admitted: false, reason: 'velocity-staggering-not-requested' } } }, null), []);
  assert.equal(effectiveMismatches(off, { velocityStaggering: { effective: { mode: 'staggered', admitted: true, reason: null } } }, null).length, 1, 'requested collocated must reject a staggered receipt');
  // Review LS-01: the complete pair is checked, so a contradictory or partial receipt cannot pass either arm.
  assert.equal(effectiveMismatches(on, { velocityStaggering: { effective: { mode: 'collocated', admitted: true } } }, null).length, 1, 'a collocated effective mode must fail a staggered arm even when admitted');
  assert.equal(effectiveMismatches(on, { velocityStaggering: { effective: { admitted: true } } }, null).length, 1, 'a receipt without a mode fails a staggered arm');
  assert.equal(effectiveMismatches(off, { velocityStaggering: { effective: { mode: 'collocated', admitted: true } } }, null).length, 1, 'active admission fails a collocated arm');
  assert.equal(effectiveMismatches(off, { velocityStaggering: { effective: { admitted: false } } }, null).length, 1, 'a receipt without a mode fails a collocated arm');
});
