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
  assert.deepEqual(off.effective, { mode: 'collocated', admitted: false, reason: 'velocity-staggering-not-requested', faceForces: false });
  const legacy = core.resolveVelocityStaggeringConfig({ velocityStaggering: 'staggered', pressureSolver: 'legacy' });
  assert.deepEqual(legacy.effective, { mode: 'collocated', admitted: false, reason: 'velocity-staggering-requires-converged-pressure-solver', faceForces: false });
  assert.deepEqual(legacy.requested, { mode: 'staggered', pressureSolver: 'legacy' });
  const on = core.resolveVelocityStaggeringConfig({ velocityStaggering: 'staggered', pressureSolver: 'converged-open-top' });
  assert.deepEqual(on.effective, { mode: 'staggered', admitted: true, reason: null, faceForces: true });
  const onClosed = core.resolveVelocityStaggeringConfig({ velocityStaggering: 'staggered', pressureSolver: 'converged' });
  assert.equal(onClosed.effective.admitted, true, 'the closed-top converged solve uses the same compact pair');
  assert.deepEqual(core.resolveVelocityStaggeringConfig({ velocityStaggering: 'nonsense', pressureSolver: 'converged-open-top' }).effective.mode, 'collocated');
});

test('the staggering uniform follows the heat-release block and packs 1 only when admitted', () => {
  assert.equal(core.VELOCITY_STAGGERING_UNIFORM_OFFSET, core.HEAT_RELEASE_UNIFORM_OFFSET + 4);
  assert.equal(core.VOLUME_UNIFORM_FLOATS, core.VELOCITY_STAGGERING_UNIFORM_OFFSET + 4);
  assert.deepEqual(core.velocityStaggeringUniformValues(core.resolveVelocityStaggeringConfig({ velocityStaggering: 'staggered', pressureSolver: 'converged-open-top' })), [1, 1, 0, 0]);
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
  assert.equal(schema.controlCount, 235);
  assert.equal(schema.controls.length, 235);
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

// Force side of the same half-cell shift (report section 29): forces are
// evaluated at the cell centre and were added straight to the face-stored
// velocity. Under the staggered reading the main kernel now stores the
// transported velocity and writes the step's force increment to a per-cell
// buffer; a face-force pass adds, per component, the mean of this cell's and
// the upper neighbour's increment, then applies the velocity bound.
test('staggered: the main kernel separates the force increment and the face-force pass averages it onto the faces', () => {
  const on = core.resolveVelocityStaggeringConfig({ velocityStaggering: 'staggered', pressureSolver: 'converged-open-top' });
  assert.deepEqual(core.velocityStaggeringUniformValues(on), [1, 1, 0, 0], 'y flags the face-force pass');
  assert.deepEqual(core.velocityStaggeringUniformValues(core.resolveVelocityStaggeringConfig({})), [0, 0, 0, 0]);
  assert.equal(on.effective.faceForces, true);
  assert.match(source, /@group\(0\) @binding\(20\) var forceDelta: texture_storage_3d<r32float, read_write>;/, 'one r32float storage texture, components stacked along depth (compute is at its storage-buffer limit)');
  assert.match(source, /\{ binding: 20, visibility: GPUShaderStage\.FRAGMENT \| GPUShaderStage\.COMPUTE, storageTexture: \{ access: 'read-write', format: 'r32float', viewDimension: '3d' \} \}/, 'fluid layout carries the force texture');
  assert.match(source, /size: \[gridSize, gridHeight, gridSize \* 3\],/, 'three components along depth');
  const main = source.slice(source.indexOf('\nfn cs(@builtin'), source.indexOf('\nfn ', source.indexOf('\nfn cs(@builtin') + 10));
  assert.match(main, /let forceIncrement = \(vel - velTransported\) \* timeStep;/);
  assert.match(main, /var centredForce = vec3<f32>\(0\.0\);/);
  const pass = source.slice(source.indexOf('fn csFaceForces('), source.indexOf('\n}\n', source.indexOf('fn csFaceForces(')));
  assert.match(pass, /let here = vec3<f32>\(forceDeltaLoad\(c, 0\), forceDeltaLoad\(c, 1\), forceDeltaLoad\(c, 2\)\);/);
  assert.match(pass, /forceDeltaLoad\(c \+ vec3<i32>\(1, 0, 0\), 0\), sceneFaceOpen\(c, 0u\) && gid\.x \+ 1u < GRID\)/);
  assert.match(pass, /forceDeltaLoad\(c \+ vec3<i32>\(0, 1, 0\), 1\), sceneFaceOpen\(c, 1u\) && gid\.y \+ 1u < GRID_Y\)/);
  assert.match(pass, /forceDeltaLoad\(c \+ vec3<i32>\(0, 0, 1\), 2\), sceneFaceOpen\(c, 2u\) && gid\.z \+ 1u < GRID\)/);
  assert.match(pass, /fluidDst\[base\] = vec4<f32>\(boundVelocity\(stored\.xyz \+ faceForce\), stored\.w\);/, 'the bound applies once, after the face force');
  // The pass runs after the sim pass, before the buffers flip, only when admitted.
  const step = source.slice(source.indexOf("label: 'kaminos fluid sim pass'"), source.indexOf('encodeAnalyticEmitterInjection(encoder);', source.indexOf("label: 'kaminos fluid sim pass'")));
  assert.match(step, /if \(state\.velocityStaggering\?\.effective\?\.faceForces && faceForcesPipeline\) \{[\s\S]*label: 'kaminos face force pass'[\s\S]*\}\s*currentFluid = 1 - currentFluid;/);
  assert.match(capture, /velocityStaggering: s\.velocityStaggering \?\? null/);
});

// CPU model of the staggered fold and the face pass (review FA-01..03): the
// main kernel stores the unbounded intermediate (transported + everything that
// is not a centred additive force) and writes the centred increment; the face
// pass averages that increment with the open upper neighbour per component and
// bounds once. The model mirrors the two kernels so their arithmetic can be
// checked without a GPU; it is not the shader.
test('face-force fold model: bound once, centred forces averaged, velocity effects local, blocked faces and solids contribute nothing', () => {
  const legacy = v => v.map(x => Math.min(0.52, Math.max(-0.34, x)));
  // FA-01: opposing increments that cross the intermediate bound leave the completed velocity inside it.
  const r = core.faceForceFoldModel({ transported: [0.6, 0, 0], localIncrement: [0, 0, 0], centredIncrement: [-0.2, 0, 0], upperCentredIncrement: [[-0.2, 0, 0], [0, 0, 0], [0, 0, 0]], bound: legacy });
  assert.deepEqual(r.stored, [0.6, 0, 0], 'the main kernel stores the unbounded intermediate');
  assert.deepEqual(r.completed.map(x => Number(x.toFixed(6))), [0.4, 0, 0], 'one bound after the face increment');
  // Magnitude bound: same single application.
  const mag = v => { const m = Math.hypot(...v); return m > 0.5 ? v.map(x => x * 0.5 / m) : v; };
  const r2 = core.faceForceFoldModel({ transported: [0.6, 0, 0], localIncrement: [0, 0, 0], centredIncrement: [-0.2, 0, 0], upperCentredIncrement: [[-0.2, 0, 0], [0, 0, 0], [0, 0, 0]], bound: mag });
  assert.deepEqual(r2.completed.map(x => Number(x.toFixed(6))), [0.4, 0, 0]);
  // FA-02: a centred force with an unequal upper value is averaged per component; a velocity-delta term is not.
  const r3 = core.faceForceFoldModel({ transported: [0, 0, 0], localIncrement: [0, 0, 0], centredIncrement: [0.1, 0, 0], upperCentredIncrement: [[0.3, 0, 0], [0, 0, 0], [0, 0, 0]], bound: legacy });
  assert.deepEqual(r3.completed.map(x => Number(x.toFixed(6))), [0.2, 0, 0], 'x takes the mean of here and the +x neighbour');
  const r4 = core.faceForceFoldModel({ transported: [0, 0, 0], localIncrement: [0.1, 0, 0], centredIncrement: [0, 0, 0], upperCentredIncrement: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bound: legacy });
  assert.deepEqual(r4.completed, [0.1, 0, 0], 'a local (velocity-derived) increment is not averaged');
  const r4b = core.faceForceFoldModel({ transported: [0, 0, 0], localIncrement: [0.1, 0, 0], centredIncrement: [0, 0, 0], upperCentredIncrement: [[0.3, 0, 0], [0, 0, 0], [0, 0, 0]], bound: legacy });
  assert.deepEqual(r4b.completed.map(x => Number(x.toFixed(6))), [0.25, 0, 0], 'while the neighbour\'s centred increment still reaches this face');
  // Damping of the assembled velocity stays local: here T=0.10 damped by 0.82 → 0.082, independent of the neighbour.
  const r5 = core.faceForceFoldModel({ transported: [0.1, 0, 0], localIncrement: [-0.018, 0, 0], centredIncrement: [0, 0, 0], upperCentredIncrement: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bound: legacy });
  assert.deepEqual(r5.completed.map(x => Number(x.toFixed(6))), [0.082, 0, 0]);
  // FA-03: a blocked upper face or a solid neighbour contributes nothing; a solid cell writes zero.
  const r6 = core.faceForceFoldModel({ transported: [0, 0.19, 0], localIncrement: [0, 0, 0], centredIncrement: [0, 0, 0], upperCentredIncrement: [[0.4, 0, 0], [0, 0, 0], [0, 0, 0]], upperFaceOpen: [false, true, true], bound: mag });
  assert.deepEqual(r6.completed, [0, 0.19, 0], 'a stale increment behind a blocked face cannot scale the tangential components');
  assert.deepEqual(core.faceForceFoldModel({ solid: true, transported: [1, 1, 1], localIncrement: [1, 1, 1], centredIncrement: [1, 1, 1], upperCentredIncrement: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], bound: legacy }), { stored: [0, 0, 0], written: [0, 0, 0], completed: [0, 0, 0] }, 'a solid cell stores and writes zero');
  // Source mirrors the model.
  const main = source.slice(source.indexOf('\nfn cs(@builtin'), source.indexOf('\nfn ', source.indexOf('\nfn cs(@builtin') + 10));
  assert.match(main, /var centredForce = vec3<f32>\(0\.0\);/);
  assert.doesNotMatch(main, /velocityDerivedForce/);
  for (const term of ['heatExpansion', 'canonicalRadialSpread', 'bonfireNonWindCenteringForce']) assert.match(main, new RegExp(`centredForce = centredForce [+] ${term}`), `${term} is centred`);
  assert.match(main, /centredForce = centredForce \+ thermalBuoyancyForce\(/, 'buoyancy is centred');
  assert.match(main, /centredForce = centredForce \+ windDirection \* windStrength/, 'wind is centred');
  for (const term of ['confinement', 'shredForce', 'canonicalEntrainmentVelocity']) assert.doesNotMatch(main, new RegExp(`centredForce = centredForce [+] ${term};`), `${term} stays local`);
  assert.match(main, /let centredIncrement = centredForce \* timeStep;\s*forceDeltaStore\(cellI, centredIncrement\);\s*vel = velTransported \+ forceIncrement - centredIncrement;/);
  assert.match(main, /fluidDst\[base\] = vec4<f32>\(select\(boundVelocity\(vel\), vel, faceForcesOn\(\)\), density\);/, 'the bound waits for the face pass under the staggered reading');
  assert.match(main, /if \(sceneSolidAt\(cellI\)\) \{\s*forceDeltaStore\(cellI, vec3<f32>\(0\.0\)\);/, 'solids write a zero increment');
  const pass = source.slice(source.indexOf('fn csFaceForces('), source.indexOf('\n}\n', source.indexOf('fn csFaceForces(')));
  assert.match(pass, /sceneFaceOpen\(c, 0u\) && gid\.x \+ 1u < GRID/);
  assert.match(pass, /sceneFaceOpen\(c, 1u\) && gid\.y \+ 1u < GRID_Y/);
  assert.match(pass, /sceneFaceOpen\(c, 2u\) && gid\.z \+ 1u < GRID/);
});
