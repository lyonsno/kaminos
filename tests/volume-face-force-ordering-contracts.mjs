import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';
import { effectiveMismatches } from '../volume-arm-capture-checks.mjs';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
const kernelOf = name => source.slice(source.indexOf(`\nfn ${name}(`), source.indexOf('\nfn ', source.indexOf(`\nfn ${name}(`) + 10));
const main = kernelOf('cs');
const facePass = kernelOf('csFaceForces');

// Face-force ordering isolation (emitter report §35, consultation with Sexy
// Fireman, 2026-10-12). Before the face-force pass every force entered the
// velocity inside the main kernel, so the wall sponge and the non-bonfire
// downward floor (vel.y >= -0.015) acted on the forced velocity. Since the pass,
// the centred increment bypasses both. `restored` carries the sponge and the
// floor into the face pass so the pass changes placement only; `deferred` is
// current main. Assay-only override, like the confinement epsilon override: no
// persisted control, default unchanged.

test('the ordering model: deferred is current main; restored sponges the face increment and floors once, after it', () => {
  // Current main: the face pass adds the averaged increment, nothing else.
  assert.deepEqual(core.faceForceOrderingModel({ ordering: 'deferred', stored: [0, -0.012, 0], faceForce: [0, -0.02, 0], sponge: 0.6, floorActive: true }), [0, -0.032, 0]);
  // Restored: the increment is sponged like the stored part and the floor bounds the sum.
  const restored = core.faceForceOrderingModel({ ordering: 'restored', stored: [0, -0.012, 0], faceForce: [0, -0.02, 0], sponge: 0.6, floorActive: true });
  assert.deepEqual(restored.map(v => Number(v.toFixed(9))), [0, -0.015, 0]);
  assert.deepEqual(core.faceForceOrderingModel({ ordering: 'restored', stored: [0.01, 0.02, 0], faceForce: [0.01, 0.01, 0], sponge: 0.5, floorActive: false }).map(v => Number(v.toFixed(9))), [0.015, 0.025, 0], 'bonfire scenes are not floored');
  assert.throws(() => core.faceForceOrderingModel({ ordering: 'sideways', stored: [0, 0, 0], faceForce: [0, 0, 0], sponge: 1, floorActive: true }), /face-force ordering must be deferred or restored/);
  // Composition: under restored the main kernel skips its floor, so the stored part
  // is (transported + local) × sponge, and the composed result is the pre-face-force
  // law with the face placement: max((transported + local + face) × sponge, -0.015).
  for (const [transportedPlusLocal, face, sponge] of [[-0.05, 0.04, 0.6], [-0.01, -0.02, 1], [0.02, 0.01, 0.55], [-0.03, -0.01, 0.8]]) {
    const stored = [0, transportedPlusLocal * sponge, 0];
    const composed = core.faceForceOrderingModel({ ordering: 'restored', stored, faceForce: [0, face, 0], sponge, floorActive: true })[1];
    assert.ok(Math.abs(composed - Math.max((transportedPlusLocal + face) * sponge, -0.015)) < 1e-12, `${transportedPlusLocal}, ${face}, ${sponge}`);
  }
});

test('the kernels: one wall-fade function; the main kernel skips its floor under restored; the face pass sponges and floors', () => {
  const fade = source.slice(source.indexOf('\nfn spongeWallFade('), source.indexOf('\n}\n', source.indexOf('\nfn spongeWallFade(')));
  for (const line of [
    'let expandedTopY = -1.0 + 2.0 * f32(GRID_Y) / f32(GRID);',
    'let floorExempt = select(0.0, inflowApertureWeight(cellI), p.y < -0.8);',
    'let verticalWall = max(mix(-p.y, -1.0, floorExempt), p.y - expandedTopY + 1.0);',
    'let wall = max(max(abs(p.x), verticalWall), abs(p.z));',
    'return max(1.0 - smoothstep(0.86, 1.0, wall), clamp(immersedSourceWeight(cell), 0.0, 1.0));',
  ]) assert.ok(fade.includes(line), `spongeWallFade carries: ${line}`);
  assert.match(main, /let wallFade = spongeWallFade\(cellI\);/, 'the main kernel uses the same function, so both read one sponge');
  assert.ok(!main.includes('let wallFade = max(1.0 - smoothstep(0.86, 1.0, wall)'), 'no second copy in the main kernel');
  assert.match(main, /vel\.y = mix\(max\(vel\.y, -0\.015\), vel\.y, max\(bonfireScene, select\(0\.0, 1\.0, faceForceOrderingRestored\(\)\)\)\);/);
  assert.match(source, /fn faceForceOrderingRestored\(\) -> bool \{\n\s+return faceForcesOn\(\) && u\.velocity_staggering\.z > 0\.5;\n\}/);
  assert.match(facePass, /let restoredOrdering = faceForceOrderingRestored\(\);/);
  assert.match(facePass, /let sponge = select\(1\.0, stepRate\(mix\(0\.55, 1\.0, spongeWallFade\(c\)\)\), restoredOrdering\);/);
  assert.match(facePass, /var completed = boundVelocity\(stored\.xyz \+ faceForce \* sponge\);/);
  assert.match(facePass, /if \(restoredOrdering && sceneBonfireWeight\(\) < 0\.5\) \{ completed\.y = max\(completed\.y, -0\.015\); \}/);
  assert.match(source, /fn sceneBonfireWeight\(\) -> f32 \{\n\s+let sceneMode = clamp\(u\.scene_controls\.x, 0\.0, 3\.0\);\n\s+return step\(1\.5, sceneMode\) \* \(1\.0 - step\(2\.5, sceneMode\)\);\n\}/, 'the same bonfireScene the main kernel computes');
});

test('the override: assay-only, packed into the staggering uniform, receipted, default deferred', () => {
  const stag = core.resolveVelocityStaggeringConfig({ velocityStaggering: 'staggered', pressureSolver: 'converged-open-top' });
  assert.deepEqual(core.velocityStaggeringUniformValues(stag), [1, 1, 0, 0], 'default deferred');
  assert.deepEqual(core.velocityStaggeringUniformValues(stag, { faceForceOrdering: 'restored' }), [1, 1, 1, 0]);
  const collocated = core.resolveVelocityStaggeringConfig({ velocityStaggering: 'collocated', pressureSolver: 'converged-open-top' });
  assert.deepEqual(core.velocityStaggeringUniformValues(collocated, { faceForceOrdering: 'restored' }), [0, 0, 0, 0], 'no face pass, no ordering');
  assert.throws(() => core.velocityStaggeringUniformValues(stag, { faceForceOrdering: 'sideways' }), /face-force ordering must be deferred or restored/);
  const closure = source.slice(source.indexOf('export function createKaminosVolumePrototype('));
  assert.match(closure, /let faceForceOrderingOverride = null;/);
  assert.match(closure, /setFaceForceOrderingOverride\(value\) \{/);
  assert.match(closure, /uniforms\.set\(velocityStaggeringUniformValues\(velocityStaggeringConfig, \{ faceForceOrdering: faceForceOrderingOverride \?\? 'deferred' \}\), VELOCITY_STAGGERING_UNIFORM_OFFSET\);/);
  assert.match(closure, /state\.velocityStaggering = \{ \.\.\.velocityStaggeringConfig, faceForceOrdering: \{ requested: faceForceOrderingOverride \?\? 'deferred', effective: velocityStaggeringConfig\.effective\.faceForces \? \(faceForceOrderingOverride \?\? 'deferred'\) : 'no-face-pass' \} \};/);
});

test('capture: @faceForceOrdering applies the override and the arm fails unless the receipt shows it', () => {
  assert.match(capture, /if \(cid === '@faceForceOrdering'\) \{/);
  assert.match(capture, /setFaceForceOrderingOverride\?\.\(\$\{JSON\.stringify\(requested\)\}\)/);
  const end = effective => ({ velocityStaggering: { effective: { mode: 'staggered', admitted: true, faceForces: true }, faceForceOrdering: { requested: effective, effective } } });
  const check = (value, e) => effectiveMismatches({ set: [['@faceForceOrdering', value]] }, e, null);
  assert.deepEqual(check('restored', end('restored')), []);
  assert.deepEqual(check('deferred', end('deferred')), []);
  assert.deepEqual(check('null', end('deferred')), [], 'null clears to the default');
  assert.equal(check('restored', end('deferred')).length, 1, 'not applied');
  assert.equal(check('restored', { velocityStaggering: { effective: { mode: 'staggered', admitted: true, faceForces: true } } }).length, 1, 'no ordering receipt');
  assert.equal(check('restored', { velocityStaggering: { effective: { mode: 'collocated', admitted: false, faceForces: false }, faceForceOrdering: { requested: 'restored', effective: 'no-face-pass' } } }).length, 1, 'no face pass to order');
});
