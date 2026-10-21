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
  assert.equal(core.JOINED_BOUNDARY_UNIFORM_FLOATS, 12);
  assert.equal(core.WAVELET_TURBULENCE_UNIFORM_OFFSET, core.JOINED_BOUNDARY_UNIFORM_OFFSET + core.JOINED_BOUNDARY_UNIFORM_FLOATS, 'wavelet turbulence follows the joined boundary');
  assert.equal(core.OPEN_WORLD_UNIFORM_OFFSET, core.WAVELET_TURBULENCE_UNIFORM_OFFSET + core.WAVELET_TURBULENCE_UNIFORM_FLOATS);
  assert.equal(core.VOLUME_UNIFORM_FLOATS, core.OPEN_WORLD_UNIFORM_OFFSET + 4);
  assert.match(shader, /  reactant_combustion_d: vec4<f32>,\n  joined_boundary: vec4<f32>,\n  joined_ghost_geometry: vec4<f32>,\n  joined_ghost_dims: vec4<f32>,\n  wavelet_turbulence: vec4<f32>,\n  wavelet_octave_weights: vec4<f32>,\n  open_world_boundary: vec4<f32>,\n\}/);
  assert.match(shader, /fn joinedBoundary\(\) -> bool \{\n  return u\.joined_boundary\.x > 0\.5;\n\}/);
  const m = core.JOINED_GHOST_MARGIN_CELLS;
  assert.deepEqual(core.joinedBoundaryUniformValues(null), [0, 0, 0, m, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(core.joinedBoundaryUniformValues({ admitted: true }), [1, 0, 0, m, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(core.joinedBoundaryUniformValues({ admitted: false }), [0, 0, 0, m, 0, 0, 0, 0, 0, 0, 0, 0]);
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
  assert.match(shader, /@group\(0\) @binding\(28\) var joinedLowerFaces: texture_2d_array<f32>;/);
  assert.match(shader, /fn joinedLowerFace\(c: vec3<i32>, axis: u32\) -> f32 \{\n  let b = \(axis \+ 1u\) % 3u;\n  let d = \(axis \+ 2u\) % 3u;\n  return textureLoad\(joinedLowerFaces, vec2<i32>\(c\[b\], c\[d\]\), i32\(axis\), 0\)\.x;\n\}/);
});

test('compactFaceVelocity: joined lower faces read the planes; joined far upper faces are open', () => {
  const fn = shader.slice(shader.indexOf('fn compactFaceVelocity('), shader.indexOf('\n}\n', shader.indexOf('fn compactFaceVelocity(')));
  assert.match(fn, /  if \(c\[axis\] < 0\) \{\n    if \(joinedBoundary\(\) \|\| openWorldBoundary\(\)\) \{ return joinedLowerFace\(c, axis\); \}/);
  assert.match(fn, /    if \(joinedBoundary\(\) \|\| openWorldBoundary\(\) \|\| \(axis == 1u && pressureSolverOpenTop\(\)\)\) \{\n      return readSlot\(c, 0u\)\[axis\];\n    \}/);
});

test('walls: the in-kernel sponges, top fades and floor clamp are off in joined mode', () => {
  assert.match(shader, /let wallFade = select\(max\(1\.0 - smoothstep\(0\.86, 1\.0, wall\), clamp\(immersedSlabWeight, 0\.0, 1\.0\)\), 1\.0, joinedBoundary\(\) \|\| openWorldBoundary\(\)\);/);
  for (const name of ['smokeTopFade', 'heatTopFade', 'fireTopFade']) {
    assert.match(shader, new RegExp(`let ${name} = select\\(${name}Standalone, 1\\.0, joinedBoundary\\(\\)\\);`), `${name} off in joined mode`);
  }
  assert.match(shader, /vel\.y = mix\(max\(vel\.y, -0\.015\), vel\.y, max\(bonfireScene, select\(0\.0, 1\.0, joinedBoundary\(\) \|\| openWorldBoundary\(\)\)\)\);/);
  const face = shader.slice(shader.indexOf('fn csFaceForces('), shader.indexOf('\n}\n', shader.indexOf('fn csFaceForces(')));
  assert.match(face, /let openX = sceneFaceOpen\(c, 0u\) && \(gid\.x \+ 1u < GRID \|\| joinedBoundary\(\) \|\| openWorldBoundary\(\)\);/);
  assert.match(face, /let openZ = sceneFaceOpen\(c, 2u\) && \(gid\.z \+ 1u < GRID \|\| joinedBoundary\(\) \|\| openWorldBoundary\(\)\);/);
  assert.ok(face.includes('let openY = sceneFaceOpen(c, 1u) && (!topRow || pressureSolverOpenTop() || joinedBoundary() || openWorldBoundary());'));
  assert.match(face, /let upX = select\(here\.x, forceDeltaLoad\(c \+ vec3<i32>\(1, 0, 0\), 0\), openX && !topRowX\);/);
  assert.match(face, /let upZ = select\(here\.z, forceDeltaLoad\(c \+ vec3<i32>\(0, 0, 1\), 2\), openZ && !topRowZ\);/);
});

test('admission: only an admitted immersed source under the converged solver; everything else is refused with a reason (JH-01, JH-03)', () => {
  const base = { requested: true, sourceLaw: 'immersed-source', pressureSolver: 'converged', immersedAdmitted: true, immersedReason: null };
  assert.deepEqual({ ...core.resolveJoinedBoundary(base) }, { requested: true, admitted: true, reason: null });
  assert.deepEqual({ ...core.resolveJoinedBoundary({ ...base, sourceLaw: 'inflow-boundary' }) }, { requested: true, admitted: false, reason: 'inflow-boundary-joined-pending-fixed-flux' });
  for (const sourceLaw of ['legacy-volume', 'shallow-primary', 'bogus', null]) {
    assert.deepEqual({ ...core.resolveJoinedBoundary({ ...base, sourceLaw }) }, { requested: true, admitted: false, reason: 'joined-boundary-needs-immersed-source' }, `refuses ${sourceLaw}`);
  }
  assert.deepEqual({ ...core.resolveJoinedBoundary({ ...base, pressureSolver: 'legacy' }) }, { requested: true, admitted: false, reason: 'joined-boundary-needs-converged-solver' });
  assert.deepEqual({ ...core.resolveJoinedBoundary({ ...base, immersedAdmitted: false, immersedReason: 'immersed-source-requires-open-top-pressure-solver' }) },
    { requested: true, admitted: false, reason: 'joined-boundary-needs-admitted-immersed-source:immersed-source-requires-open-top-pressure-solver' });
  assert.deepEqual({ ...core.resolveJoinedBoundary({ requested: false }) }, { requested: false, admitted: false, reason: null });
});

// JH-02: admission follows the effective controls. The request is kept; every
// control change recomputes admission before the next step is encoded.
test('admission tracks control changes through the real API (JH-02)', () => {
  const stub = () => new Proxy(function () {}, {
    get(target, prop) { if (prop === Symbol.toPrimitive) return () => 0; if (prop === 'then') return undefined; return target[prop] ?? (target[prop] = stub()); },
    set(target, prop, value) { target[prop] = value; return true; },
    apply() { return stub(); }, construct() { return stub(); },
  });
  globalThis.document = stub(); globalThis.window = globalThis.window || stub();
  globalThis.requestAnimationFrame = () => 0; globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const p = core.createKaminosVolumePrototype({ THREE: stub(), viewport: stub(), camera: stub(), controls: stub(),
    getControls: () => ({ resolution: 48, emitterSourceLaw: 'immersed-source', pressureSolver: 'converged-open-top' }), onStatus: () => {} });
  assert.equal(p.setJoinedBoundary({ enabled: true }).admitted, true);
  p.setControls({ emitterSourceLaw: 'inflow-boundary' });
  assert.deepEqual({ ...p.joinedProducerState().joined }, { requested: true, admitted: false, reason: 'inflow-boundary-joined-pending-fixed-flux' }, 'a source-law change revokes admission');
  p.setControls({ emitterSourceLaw: 'immersed-source' });
  assert.equal(p.joinedProducerState().joined.admitted, true, 'the kept request is admitted again');
  p.setControls({ pressureSolver: 'legacy' });
  assert.equal(p.joinedProducerState().joined.reason, 'joined-boundary-needs-converged-solver');
  p.setControls({ pressureSolver: 'converged' });
  assert.match(p.joinedProducerState().joined.reason, /^joined-boundary-needs-admitted-immersed-source:/, 'a closed top refuses the immersed source and so the join');
  p.setControls({ pressureSolver: 'converged-open-top' });
  assert.equal(p.setJoinedBoundary({ enabled: false }).admitted, false);
  p.setControls({ emitterSourceLaw: 'immersed-source' });
  assert.equal(p.joinedProducerState().joined.requested, false, 'a release stays released');
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

// Slice 2 — transport ghosts (agreed with Sexy, 2026-10-13). Outside the fine
// box every active transport sampler reads the exterior: the predictor,
// backtrace and limiter extrema read the OLD snapshot, the MacCormack reverse
// reads the PREDICTED (transport-only) snapshot. Each snapshot arrives as two
// Kaminos-owned rgba32float 3-D textures at site resolution (N+1 per axis,
// Sexy's padded x-fast sites): A = lower-face velocities (local distance per
// reference tick) + raw soot, B = legacy optical smoke, heat, passive fuel,
// passive oxidizer; scalars are cell-centred.
test('ghost geometry: the joined block carries geometry and generation; fine points map into coarse coordinates', () => {
  assert.equal(core.JOINED_BOUNDARY_UNIFORM_FLOATS, 12);
  const geometry = { originFine: [-16, 0, -16], cellWidthFine: 4, dims: [32, 64, 32], finePitchLocal: 0.0625, generation: 7 };
  assert.deepEqual(core.joinedBoundaryUniformValues({ admitted: true }, { bound: true, ...geometry }), [1, 1, 7, core.JOINED_GHOST_MARGIN_CELLS, -16, 0, -16, 4, 32, 64, 32, 0.0625]);
  assert.deepEqual(core.joinedBoundaryUniformValues({ admitted: true }, null).slice(0, 4), [1, 0, 0, core.JOINED_GHOST_MARGIN_CELLS]);
  assert.ok(core.JOINED_GHOST_MARGIN_CELLS >= 10, 'covers the 8-cell backtrace bound plus the trilinear stencil');
  // A fine cell centre maps to coarse cell coordinates (cells span [i, i+1)).
  assert.deepEqual(core.joinedGhostCoarsePoint([-1, 5, 2], geometry), [(-0.5 + 16) / 4, (5.5 - 0) / 4, (2.5 + 16) / 4]);
  // Sexy's padded site index, x fastest, N+1 sites per axis.
  assert.equal(core.joinedGhostSiteIndex([2, 3, 4], [32, 64, 32]), 2 + 33 * (3 + 65 * 4));
  assert.deepEqual(core.joinedGhostTextureSize([32, 64, 32]), [33, 65, 33]);
});

test('ghost admission: refused for the reactant law until the oxidizer ghost exists; a stale generation stops the step', () => {
  assert.equal(core.resolveJoinedGhosts({ geometry: null, reactantOn: false }).bound, false);
  const g = { originFine: [-16, 0, -16], cellWidthFine: 4, dims: [32, 64, 32], finePitchLocal: 0.0625 };
  assert.deepEqual({ ...core.resolveJoinedGhosts({ geometry: g, reactantOn: false }) }, { bound: true, reason: null });
  assert.deepEqual({ ...core.resolveJoinedGhosts({ geometry: g, reactantOn: true }) }, { bound: false, reason: 'joined-ghosts-reactant-oxidizer-pending' });
  assert.throws(() => core.resolveJoinedGhosts({ geometry: { ...g, cellWidthFine: 0 }, reactantOn: false }), /positive/);
  const sim = source.slice(source.indexOf('  function encodeSim(encoder, options = {}) {'), source.indexOf('\n  }\n', source.indexOf('  function encodeSim(encoder, options = {}) {')));
  assert.match(sim, /if \(state\.joinedBoundary\?\.admitted && state\.joinedGhosts\?\.bound && !joinedGhostSynthetic && state\.joinedGhosts\.generation !== state\.simStepCount\) \{\n\s+state\.joinedGhosts\.reason = 'stale-ghost-generation';\n\s+return false;\n\s+\}/);
});

test('ghost reads: one exterior sample per transport call, blended beyond the last fine cell centre; MacCormack stays first order where the backtrace leaves the box', () => {
  for (const [binding, name] of [[29, 'ghostA'], [30, 'ghostB']]) {
    assert.match(shader, new RegExp(`@group\\(0\\) @binding\\(${binding}\\) var ${name}: texture_3d<f32>;`));
  }
  assert.ok(!/ghostPred|ghostOld|var ghostC|var ghostD/.test(shader), 'no predicted snapshot');
  assert.match(shader, /fn joinedGhosts\(\) -> bool \{\n  return joinedBoundary\(\) && u\.joined_boundary\.y > 0\.5;\n\}/);
  // Every transport path funnels through sampleFluidSlotMasked (main kernel,
  // advection helpers, and the predictor through sampleFluidSlotInflow).
  // The masked read carries the stored flag through the slot seam (Snuffbox's
  // appearance model); the ghost blend wraps it in the same function.
  const masked = shader.slice(shader.indexOf('fn sampleFluidSlotMaskedWith('), shader.indexOf('\n}\n', shader.indexOf('fn sampleFluidSlotMaskedWith(')));
  assert.match(shader, /fn sampleFluidSlotMasked\(cellCenter: vec3<f32>, slot: u32\) -> vec4<f32> \{\n  return sampleFluidSlotMaskedWith\(cellCenter, slot, false\);\n\}/);
  assert.match(masked, /fine = weighted \/ max\(weightSum, 1e-12\);\n  \}\n  if \(openWorldBoundary\(\)\) \{ return openWorldAmbient\(cellCenter, slot, fine\); \}\n  if \(!joinedGhosts\(\)\) \{ return fine; \}\n  let outside = ghostOutsideAmount\(cellCenter\);\n  if \(outside <= 0\.0\) \{ return fine; \}\n  return mix\(fine, ghostSlotAt\(cellCenter, slot\), clamp\(outside \* 2\.0, 0\.0, 1\.0\)\);/);
  // The general samplers are untouched (the raymarch uses them; no ghost
  // texture reaches a fragment stage).
  for (const fn of ['sampleFluidSlot', 'slotExtrema', 'samplePredictSlot']) {
    const body = shader.slice(shader.indexOf(`fn ${fn}(`), shader.indexOf('\n}\n', shader.indexOf(`fn ${fn}(`)));
    assert.ok(!/joinedGhosts|ghostSlotAt|ghostA|ghostB/.test(body), `${fn} has no joined ghost path`);
  }
  const mc = shader.slice(shader.indexOf('fn macCormackSlot('), shader.indexOf('\n}\n', shader.indexOf('fn macCormackSlot(')));
  assert.match(mc, /if \(joinedGhosts\(\) && ghostOutsideAmount\(backCell\) > 0\.0\) \{\n    return predicted;\n  \}/);
  const ghost = shader.slice(shader.indexOf('fn ghostSlotAt('), shader.indexOf('\n}\n', shader.indexOf('fn ghostSlotAt(')));
  assert.match(ghost, /if \(slot == 1u\) \{ return vec4<f32>\(s\.x, s\.y, s\.z, 0\.0\); \}/);
  assert.match(ghost, /if \(slot >= 2u\) \{ return vec4<f32>\(0\.0\); \}/);
  // Compute-only bindings in every group-0 layout.
  for (const b of [29, 30]) assert.ok(!new RegExp(`binding: ${b}, visibility: GPUShaderStage\\.FRAGMENT`).test(source), `binding ${b} is compute-only`);
});

// Synthetic exterior for witnesses (before Sexy's export is wired): fill the
// four ghost textures with a constant exterior and let the generation follow
// the step; the receipt names it synthetic so it can never pass for her data.
test('synthetic ghosts: a constant exterior for witnesses, receipted as synthetic', async () => {
  assert.match(source, /    debugFillJoinedGhosts\(\{ heat = 0, soot = 0, fuel = 0, velocityLocal = \[0, 0, 0\] \} = \{\}\) \{/);
  const sim = source.slice(source.indexOf('  function encodeSim(encoder, options = {}) {'), source.indexOf('\n  }\n', source.indexOf('  function encodeSim(encoder, options = {}) {')));
  assert.match(sim, /state\.joinedGhosts\?\.bound && !joinedGhostSynthetic && state\.joinedGhosts\.generation !== state\.simStepCount/);
  const api = source.slice(source.indexOf('    joinedProducerState() {'), source.indexOf('    joinedProducerState() {') + 3000);
  assert.match(api, /synthetic: joinedGhostSynthetic/);
  const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
  assert.match(capture, /if \(cid === '@joinedGhostsSynthetic'\) \{/);
  const { parseSyntheticGhosts } = await import('../volume-arm-capture-checks.mjs');
  assert.deepEqual(parseSyntheticGhosts('0.5:0.02'), { heat: 0.5, velocityY: 0.02 });
  assert.equal(parseSyntheticGhosts('x:1'), null);
});


// Joined witness readout: the residual probe runs inside the fine projection,
// which joined mode skips, so its height profile goes stale. A direct readback
// of the fine field reports mean heat (slot 1 .y) in the boundary band (the
// outer cells of every face, two deep in the witness) and in the interior.
test('fluid band stats: a direct readback for joined witnesses; a read-only capture arm', async () => {
  const stats = core.fluidBandHeatStats(new Float32Array(16 * 4 * 4 * 4).map((_, i) => ((i % 16) === 5 ? 1 : 0)), [4, 4, 4], 1);
  assert.deepEqual({ ...stats }, { bandCells: 56, interiorCells: 8, bandHeatMean: 1, interiorHeatMean: 1 });
  assert.match(source, /    async debugFluidBandStats\(\) \{/);
  const { NON_CONFIGURING_CAPTURE_CONTROLS } = await import('../volume-arm-capture-checks.mjs');
  assert.ok(NON_CONFIGURING_CAPTURE_CONTROLS.has('@fluidBandStats'));
  const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
  assert.match(capture, /if \(cid === '@fluidBandStats'\) \{/);
});

// A joined arm has no fine projection and so no residual of its own; the
// capture records that explicitly instead of failing (or passing) the
// freshness check.
test('capture: a joined arm records an unmeasured residual instead of the freshness check', () => {
  const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
  assert.match(capture, /joinedAdmitted: Boolean\(w\.__kaminosVolumePrototype\?\.joinedProducerState\?\.\(\)\?\.joined\?\.admitted\)/);
  assert.match(capture, /if \(end\.joinedAdmitted\) \{ entry\.residualSkipped = 'joined-boundary-no-fine-projection'; \} else if \(!\(end\.residual\?\.step > freshnessFloor\)\)/);
});

// Review of ea5ac0c96 (slice 2): JG-01..04.
test('JG-01: a ghost allocation or geometry change invalidates the stamp and the synthetic provenance', () => {
  const alloc = source.slice(source.indexOf("      joinedGhostTextures = ['A', 'B'].map(name => {"), source.indexOf("      joinedGhostTextures = ['A', 'B'].map(name => {") + 1400);
  assert.match(alloc, /\n      \}\);\n      \/\/ Fresh ghost textures hold no exterior yet: the stamp and any synthetic\n      \/\/ provenance belong to the destroyed allocation \(review JG-01\)\.\n      joinedGhostSynthetic = null;\n      if \(state\.joinedGhosts\) state\.joinedGhosts = \{ \.\.\.state\.joinedGhosts, generation: -1 \};/);
  const setter = source.slice(source.indexOf('    setJoinedGhosts(geometry = null) {'), source.indexOf('    setJoinedGhosts(geometry = null) {') + 1200);
  assert.match(setter, /if \(state\.joinedGhosts\) state\.joinedGhosts = \{ \.\.\.state\.joinedGhosts, generation: -1 \};/);
});

test('JG-02: the synthetic arm fails unless the ghost route is admitted after resolution and at settlement', () => {
  const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
  assert.match(capture, /const route = await waitForJoinedGhostRoute\(\);/);
  assert.match(capture, /if \(!route\?\.bound \|\| !route\?\.joined\) \{ report\.lastTrustworthyEvidence\.joinedGhosts = \{ \.\.\.sample, route \}; fail\(report\.failurePhase, `synthetic ghosts filled but not consumed \(\$\{route\?\.reason \?\? \(route\?\.joined \? 'ghosts not bound' : 'joined boundary not admitted'\)\}\)`\); \}/);
  assert.match(capture, /joinedGhostsBound: Boolean\(w\.__kaminosVolumePrototype\?\.joinedProducerState\?\.\(\)\?\.ghosts\?\.bound\)/);
  assert.match(capture, /joinedGhostsSynthetic: w\.__kaminosVolumePrototype\?\.joinedProducerState\?\.\(\)\?\.ghosts\?\.synthetic \?\? null/);
  assert.match(capture, /const ghostSettlement = syntheticGhostSettlementMismatch\(arm\.set\.find\(\(\[id\]\) => id === '@joinedGhostsSynthetic'\)\?\.\[1\], end\);\n    if \(ghostSettlement\) \{ report\.lastTrustworthyEvidence\.joinedGhostSettlement = \{ joined: end\.joinedAdmitted, bound: end\.joinedGhostsBound, synthetic: end\.joinedGhostsSynthetic \}; fail\(report\.failurePhase, `arm \$\{arm\.name\}: \$\{ghostSettlement\}`\); \}/);
});

// Review JG-02-C: geometry eligibility (`bound`) is not consumption; the shader
// reads the ghosts only while the join is admitted, and a rebuilt fill must
// still be the requested one.
test('JG-02-C: settlement requires the join admitted, the ghosts bound and the requested synthetic fill', async () => {
  const { syntheticGhostSettlementMismatch } = await import('../volume-arm-capture-checks.mjs');
  const fill = { heat: 2, soot: 0, fuel: 0, velocityLocal: [0, 0.5, 0] };
  assert.equal(syntheticGhostSettlementMismatch(undefined, { joinedAdmitted: false }), null);
  assert.equal(syntheticGhostSettlementMismatch('2:0.5', { joinedAdmitted: true, joinedGhostsBound: true, joinedGhostsSynthetic: fill }), null);
  assert.match(syntheticGhostSettlementMismatch('2:0.5', { joinedAdmitted: false, joinedGhostsBound: true, joinedGhostsSynthetic: fill }), /joined boundary no longer admitted/);
  assert.match(syntheticGhostSettlementMismatch('2:0.5', { joinedAdmitted: true, joinedGhostsBound: false, joinedGhostsSynthetic: fill }), /ghosts no longer bound/);
  assert.match(syntheticGhostSettlementMismatch('2:0.5', { joinedAdmitted: true, joinedGhostsBound: true, joinedGhostsSynthetic: null }), /synthetic fill gone/);
  assert.match(syntheticGhostSettlementMismatch('2:0.5', { joinedAdmitted: true, joinedGhostsBound: true, joinedGhostsSynthetic: { ...fill, heat: 0 } }), /synthetic fill .* requested/);
  assert.match(syntheticGhostSettlementMismatch('2:0.5', { joinedAdmitted: true, joinedGhostsBound: true, joinedGhostsSynthetic: { ...fill, velocityLocal: [0.1, 0.5, 0] } }), /synthetic fill .* requested/);
});

test('JG-03: the front-topology field blends to the exterior appearance (0) beyond the box like the appearance slots', () => {
  assert.match(shader, /fn sampleFrontFieldTransport\(p: vec3<f32>\) -> f32 \{\n  let fine = sampleFrontFieldMasked\(p\);\n  if \(openWorldBoundary\(\)\) \{[^\n]+\}\n  if \(!joinedGhosts\(\)\) \{ return fine; \}\n  return mix\(fine, 0\.0, clamp\(ghostOutsideAmount\(p\) \* 2\.0, 0\.0, 1\.0\)\);\n\}/);
  assert.match(shader, /var combustionFrontTopology = sampleFrontFieldTransport\(backCell\) \* stepRate\(0\.936\);/);
});

test('JG-04: the band readback is labelled from the queued snapshot and refuses nonfinite results', () => {
  const api = source.slice(source.indexOf('    async debugFluidBandStats() {'), source.indexOf('    async debugFluidBandStats() {') + 1800);
  assert.match(api, /const snapshot = \{ dims: \[gridSize, gridHeight, gridSize\], simStepCount: state\.simStepCount, joined: Boolean\(state\.joinedBoundary\?\.admitted\), ghosts: \{ bound: Boolean\(state\.joinedGhosts\?\.bound\), generation: state\.joinedGhosts\?\.generation \?\? null, synthetic: joinedGhostSynthetic \} \};/);
  assert.match(api, /if \(values\.length !== snapshot\.dims\[0\] \* snapshot\.dims\[1\] \* snapshot\.dims\[2\] \* 16\) return \{ status: 'invalid', reason: 'readback-size-mismatch', \.\.\.snapshot \};/);
  assert.match(api, /if \(!\[stats\.bandHeatMean, stats\.interiorHeatMean\]\.every\(Number\.isFinite\)\) return \{ status: 'invalid', reason: 'nonfinite-band-stats', \.\.\.snapshot \};/);
});
