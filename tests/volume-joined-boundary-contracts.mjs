// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const shaderStart = source.indexOf('const WGSL = ');
const shader = source.slice(source.indexOf('`', shaderStart) + 1, source.indexOf('`;\n', source.indexOf('`', shaderStart) + 1));

// Joined boundary (Noah 2026-10-13: "get going on the fine sim side of sexy
// joint pressure"; Sexy's stationary two-way fine/coarse candidate). Opt-in and
// off by default: the fine box's boundary becomes an interface to Sexy's
// exterior. Lower faces read her corrected lower planes, the far upper faces
// are open, the in-kernel wall sponges and floor clamp are off, and the fine
// step stops before its own projection so her shared solve owns pressure.
// First live composition is the immersed source; the inflow-boundary aperture
// is refused in joined mode until its fixed-flux treatment exists.

test('uniform block: joined boundary after the reactant block, off by default', () => {
  assert.equal(core.JOINED_BOUNDARY_UNIFORM_OFFSET, core.REACTANT_COMBUSTION_UNIFORM_OFFSET + core.REACTANT_COMBUSTION_UNIFORM_FLOATS, 'after the reactant combustion block');
  assert.equal(core.JOINED_BOUNDARY_UNIFORM_FLOATS, 4);
  assert.equal(core.VOLUME_UNIFORM_FLOATS, core.JOINED_BOUNDARY_UNIFORM_OFFSET + core.JOINED_BOUNDARY_UNIFORM_FLOATS);
  assert.match(shader, /  reactant_combustion_d: vec4<f32>,\n  joined_boundary: vec4<f32>,\n\}/);
  assert.match(shader, /fn joinedBoundary\(\) -> bool \{\n  return u\.joined_boundary\.x > 0\.5;\n\}/);
  assert.deepEqual(core.joinedBoundaryUniformValues(null), [0, 0, 0, 0]);
  assert.deepEqual(core.joinedBoundaryUniformValues({ admitted: true }), [1, 0, 0, 0]);
  assert.deepEqual(core.joinedBoundaryUniformValues({ admitted: false }), [0, 0, 0, 0]);
});

// Sexy's lower planes (volume-composite-storage.mjs): plane `a` holds the
// lowest `a`-faces, indexed q[b] + n_b * q[d] with b = (a+1)%3, d = (a+2)%3.
// The fine side reads them from a three-layer r32float texture: layer a,
// texel (q[b], q[d]) — the same ordering, row by row.
test('lower planes: a three-layer texture in Sexy\'s plane ordering', () => {
  const dims = [4, 6, 4];
  const seen = new Set();
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, d = (a + 2) % 3;
    for (let qd = 0; qd < dims[d]; qd++) for (let qb = 0; qb < dims[b]; qb++) {
      const cell = [0, 0, 0]; cell[b] = qb; cell[d] = qd;
      const texel = core.joinedLowerFaceTexel(a, cell, dims);
      assert.deepEqual(texel, { layer: a, x: qb, y: qd });
      assert.equal(texel.x + dims[b] * texel.y, qb + dims[b] * qd, 'row-major equals Sexy\'s flat index within the plane');
      seen.add(`${a}:${qb}:${qd}`);
    }
  }
  assert.equal(seen.size, 6 * 4 + 4 * 4 + 4 * 6, 'every lower face once');
  assert.deepEqual(core.joinedLowerFaceTextureSize([48, 144, 48]), [144, 144, 3], 'square layers of the largest dimension');
  assert.match(shader, /@group\(0\) @binding\(25\) var joinedLowerFaces: texture_2d_array<f32>;/);
  assert.match(shader, /fn joinedLowerFace\(c: vec3<i32>, axis: u32\) -> f32 \{\n  let b = \(axis \+ 1u\) % 3u;\n  let d = \(axis \+ 2u\) % 3u;\n  return textureLoad\(joinedLowerFaces, vec2<i32>\(c\[b\], c\[d\]\), i32\(axis\), 0\)\.x;\n\}/);
});

test('compactFaceVelocity: joined lower faces read the planes; joined far upper faces are open', () => {
  const fn = shader.slice(shader.indexOf('fn compactFaceVelocity('), shader.indexOf('\n}\n', shader.indexOf('fn compactFaceVelocity(')));
  assert.match(fn, /  if \(c\[axis\] < 0\) \{\n    if \(joinedBoundary\(\)\) \{ return joinedLowerFace\(c, axis\); \}/);
  assert.match(fn, /    if \(joinedBoundary\(\) \|\| \(axis == 1u && pressureSolverOpenTop\(\)\)\) \{\n      return readSlot\(c, 0u\)\[axis\];\n    \}/);
});

test('walls: the in-kernel sponges, top fades and floor clamp are off in joined mode', () => {
  assert.match(shader, /let wallFade = select\(max\(1\.0 - smoothstep\(0\.86, 1\.0, wall\), clamp\(immersedSlabWeight, 0\.0, 1\.0\)\), 1\.0, joinedBoundary\(\)\);/);
  for (const name of ['smokeTopFade', 'heatTopFade', 'fireTopFade']) {
    assert.match(shader, new RegExp(`let ${name} = select\\(${name}Standalone, 1\\.0, joinedBoundary\\(\\)\\);`), `${name} off in joined mode`);
  }
  assert.match(shader, /vel\.y = mix\(max\(vel\.y, -0\.015\), vel\.y, max\(bonfireScene, select\(0\.0, 1\.0, joinedBoundary\(\)\)\)\);/);
  const face = shader.slice(shader.indexOf('fn csFaceForces('), shader.indexOf('\n}\n', shader.indexOf('fn csFaceForces(')));
  assert.match(face, /let openX = sceneFaceOpen\(c, 0u\) && \(gid\.x \+ 1u < GRID \|\| joinedBoundary\(\)\);/);
  assert.match(face, /let openZ = sceneFaceOpen\(c, 2u\) && \(gid\.z \+ 1u < GRID \|\| joinedBoundary\(\)\);/);
  assert.match(face, /let openY = select\(sceneFaceOpen\(c, 1u\), pressureSolverOpenTop\(\) \|\| joinedBoundary\(\), topRow\);/);
  assert.match(face, /let upX = select\(here\.x, forceDeltaLoad\(c \+ vec3<i32>\(1, 0, 0\), 0\), openX && !topRowX\);/);
  assert.match(face, /let upZ = select\(here\.z, forceDeltaLoad\(c \+ vec3<i32>\(0, 0, 1\), 2\), openZ && !topRowZ\);/);
});

test('admission: joined mode needs the immersed source and the converged solver; the inflow aperture is refused for now', () => {
  const ok = core.resolveJoinedBoundary({ requested: true, sourceLaw: 'immersed-source', pressureSolver: 'converged' });
  assert.deepEqual({ ...ok }, { requested: true, admitted: true, reason: null });
  assert.deepEqual({ ...core.resolveJoinedBoundary({ requested: true, sourceLaw: 'inflow-boundary', pressureSolver: 'converged' }) },
    { requested: true, admitted: false, reason: 'inflow-boundary-joined-pending-fixed-flux' });
  assert.deepEqual({ ...core.resolveJoinedBoundary({ requested: true, sourceLaw: 'immersed-source', pressureSolver: 'legacy' }) },
    { requested: true, admitted: false, reason: 'joined-boundary-needs-converged-solver' });
  assert.deepEqual({ ...core.resolveJoinedBoundary({ requested: false }) }, { requested: false, admitted: false, reason: null });
});

test('the fine step stops before its own projection in joined mode; the producer state is exposed', () => {
  const sim = source.slice(source.indexOf('  function encodeSim(encoder, options = {}) {'), source.indexOf('\n  }\n', source.indexOf('  function encodeSim(encoder, options = {}) {')));
  assert.match(sim, /    encodeAnalyticEmitterInjection\(encoder\);\n    if \(state\.joinedBoundary\?\.admitted\) \{\n      state\.simStepCount \+= 1;\n      updateSimCostLedger\(\);\n      return false;\n    \}\n    const finalTimestampWritten = encodePressureProjection\(encoder, \{/);
  assert.match(source, /    setJoinedBoundary\(request = \{\}\) \{/);
  assert.match(source, /    joinedProducerState\(\) \{/);
  const api = source.slice(source.indexOf('    joinedProducerState() {'), source.indexOf('    joinedProducerState() {') + 2400);
  for (const field of ['dims', 'pitch', 'timeStep', 'transportScheme', 'fluidBuffer', 'fluidReadIndex', 'frontBuffer', 'burnRateTexture', 'solidMask', 'lowerFaceTexture', 'prescribedInlet']) {
    assert.ok(new RegExp(`\\b${field}(:|,)`).test(api), `producer state exposes ${field}`);
  }
});

// Capture: @joinedBoundary=1|0 sets the joined boundary through the API, keeps
// the receipt and a producer-state summary, and fails a requested join that is
// not admitted. It changes the simulation, so it counts as configuration.
test('capture: @joinedBoundary sets the mode, records the receipt and fails an unadmitted request', async () => {
  const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
  const { joinedBoundaryMismatch, armSetsConfiguration } = await import('../volume-arm-capture-checks.mjs');
  assert.match(capture, /if \(cid === '@joinedBoundary'\) \{/);
  assert.match(capture, /joinedBoundary: arm\.joinedBoundary \|\| \[\]/);
  assert.equal(armSetsConfiguration([['@joinedBoundary', '1']]), true);
  const good = { receipt: { requested: true, admitted: true, reason: null }, producer: { dims: [48, 96, 48], lowerFaceTextureSize: [96, 96, 3], fluidBuffer: true, burnRateTexture: true } };
  assert.equal(joinedBoundaryMismatch('1', good), null);
  assert.match(joinedBoundaryMismatch('1', { ...good, receipt: { requested: true, admitted: false, reason: 'inflow-boundary-joined-pending-fixed-flux' } }), /not admitted \(inflow-boundary-joined-pending-fixed-flux\)/);
  assert.match(joinedBoundaryMismatch('1', { ...good, producer: { ...good.producer, lowerFaceTextureSize: [1, 1, 3] } }), /lower-plane texture 1,1,3, expected 96,96,3/);
  assert.equal(joinedBoundaryMismatch('0', { receipt: { requested: false, admitted: false, reason: null }, producer: { dims: [48, 96, 48], lowerFaceTextureSize: [1, 1, 3] } }), null);
  assert.match(joinedBoundaryMismatch('1', null), /missing/);
});
