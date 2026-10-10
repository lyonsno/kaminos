import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';
import { effectiveMismatches } from '../volume-arm-capture-checks.mjs';
import { InletPerturbationField } from '../volume-inlet-perturbation.mjs';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const kernel = source.slice(source.indexOf('const WGSL = /* wgsl */`'));
const main = kernel.slice(kernel.indexOf('\nfn cs(@builtin'), kernel.indexOf('\nfn ', kernel.indexOf('\nfn cs(@builtin') + 10));

// Slab inlet dynamics (emitter report §33): the floor law's aperture patterns,
// turbulence lattice and puff, on the immersed disc, through slab-local
// coordinates (u, v) in the disc plane. Same cockpit rows, no new controls.
const base = { emitterSourceLaw: 'immersed-source', pressureSolver: 'converged-open-top', immersedCentreX: 0, immersedCentreY: -0.5, immersedCentreZ: 0, immersedYaw: 0, immersedPitch: 90, immersedRadius: 0.2, immersedThickness: 1.5, immersedSpeed: 0.1, immersedFuel: 0.56, immersedTemperature: 1.2, immersedMomentumGain: 1, immersedCapFraction: 0.5 };
const shape = { grid: 64, gridHeight: 128 };

test('the slab basis is orthonormal in the disc plane and matches the floor map orientation when the disc faces up', () => {
  const up = core.immersedSlabBasis([0, 1, 0]);
  assert.deepEqual(up.e1.map(v => Number(v.toFixed(6))), [1, 0, 0], 'u runs along +x');
  assert.deepEqual(up.e2.map(v => Number(v.toFixed(6))), [0, 0, 1], 'v runs along +z');
  // SID-02: the near-upright pose must be orthonormal too, and e2 must be what the kernel forms.
  const near = core.immersedDirectionFromAngles(0, 88);
  const nb = core.immersedSlabBasis(near, 0);
  assert.ok(Math.abs(nb.e1[0] * near[0] + nb.e1[1] * near[1] + nb.e1[2] * near[2]) < 1e-12, 'pitch 88: e1 ⟂ n');
  assert.deepEqual(nb.e2.map(v => Number(v.toFixed(9))), [0, 0, 1], 'pitch 88, yaw 0: v still along +z (yaw-anchored)');
  // Continuity: yawing an upright disc rotates the pattern with it; pitching away from upright does not snap it.
  assert.deepEqual(core.immersedSlabBasis([0, 1, 0], 90).e1.map(v => Number(v.toFixed(9))), [0, 0, 1], 'upright, yaw 90: u along +z');
  const a = core.immersedSlabBasis(core.immersedDirectionFromAngles(30, 89.9), 30).e1, b = core.immersedSlabBasis(core.immersedDirectionFromAngles(30, 85), 30).e1;
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.1, 'no snap across the old fallback cone');
  for (const [n, yaw] of [[[0, -1, 0], 0], [[1, 0, 0], 0], [[0, 0, 1], 90], [core.immersedDirectionFromAngles(213, -34), 213], [core.immersedDirectionFromAngles(45, 30), 45], [near, 0]]) {
    const { e1, e2 } = core.immersedSlabBasis(n, yaw);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    assert.ok(Math.abs(dot(e1, n)) < 1e-9 && Math.abs(dot(e2, n)) < 1e-9 && Math.abs(dot(e1, e2)) < 1e-9, `orthogonal for ${n}`);
    assert.ok(Math.abs(dot(e1, e1) - 1) < 1e-9 && Math.abs(dot(e2, e2) - 1) < 1e-9, `unit for ${n}`);
    const crossE1N = [e1[1] * n[2] - e1[2] * n[1], e1[2] * n[0] - e1[0] * n[2], e1[0] * n[1] - e1[1] * n[0]];
    assert.ok(crossE1N.every((c, i) => Math.abs(c - e2[i]) < 1e-9), 'e2 = e1 × n, as the shader forms it');
  }
});

test('the pattern lives inside the slab: jets, slot and bed cover fewer cells than the shape, the normaliser follows, supply stays exact', () => {
  const resolve = (pattern, extra = {}) => core.resolveImmersedSourceConfig({ ...base, emitterAperturePattern: pattern, emitterApertureCount: 6, emitterApertureSeed: 3, ...extra }, shape);
  const shapeCfg = resolve('shape'), jets = resolve('jets'), slot = resolve('slot'), bed = resolve('bed');
  assert.deepEqual(shapeCfg.effective.pattern, { kind: 'shape', count: 6, ratio: 0.6, seed: 3, lineWeight: 1, jetJitter: 0, patternFallback: null });
  assert.equal(shapeCfg.effective.pattern.kind, 'shape');
  const covered = c => c.effective.footprint.cells;
  assert.ok(covered(jets) < 0.6 * covered(shapeCfg), `jets cover far less than the disc (${covered(jets)} vs ${covered(shapeCfg)})`);
  assert.ok(covered(slot) < 0.6 * covered(shapeCfg), 'slot too');
  assert.ok(covered(bed) < covered(shapeCfg) && covered(bed) > 0.3 * covered(shapeCfg), 'bed is a porous disc');
  for (const c of [jets, slot, bed]) {
    const w = core.immersedSourceWeights(c.effective, shape);
    assert.ok(Math.abs(w.sum - c.effective.normaliser) < 1e-9, 'normaliser is the patterned fluid sum');
    assert.ok(Math.abs(c.effective.fluxEffectivePredicted - c.effective.fluxRequested) < 1e-9, 'Σ target = Q still');
    assert.equal(c.effective.fluxRequested, shapeCfg.effective.fluxRequested, 'the pattern redistributes the supply, it does not change it');
  }
  // Every patterned weight sits inside the plain slab (the pattern can only remove).
  const plain = new Map(core.immersedSourceWeights(shapeCfg.effective, shape).cells.map(c => [`${c.x},${c.y},${c.z}`, c.w]));
  for (const c of core.immersedSourceWeights(jets.effective, shape).cells) assert.ok(plain.has(`${c.x},${c.y},${c.z}`) && c.w <= plain.get(`${c.x},${c.y},${c.z}`) + 1e-9);
  // The retired patterns fall back to the shape and say so.
  assert.equal(resolve('spiral').effective.pattern.kind, 'shape');
  assert.match(resolve('spiral').effective.pattern.patternFallback, /spiral retired/);
  // A tilted disc keeps its pattern in its own plane: the same count of covered cells within a few percent.
  const tilted = core.resolveImmersedSourceConfig({ ...base, emitterAperturePattern: 'jets', emitterApertureCount: 6, immersedPitch: 0, immersedYaw: 90, immersedCentreY: 0 }, shape);
  assert.ok(Math.abs(covered(tilted) - covered(jets)) <= 0.15 * covered(jets), `tilted jets ${covered(tilted)} vs upright ${covered(jets)}`);
});

test('SID-02 half-cell pose: the CPU lookup and the kernel\'s basis read the same coverage rows', () => {
  const cfg = core.resolveImmersedSourceConfig({ ...base, immersedPitch: 88, immersedYaw: 0, immersedCentreZ: 0.015625, emitterAperturePattern: 'jets', emitterApertureCount: 6 }, shape);
  const e = cfg.effective; const map = core.immersedCoverageMapForConfig(cfg);
  const e1 = Array.from(new Float32Array(e.basis.e1)); const n = e.direction;
  const c = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]].map(v => -v); // e1 × n
  const l = Math.hypot(...c); const e2 = c.map(v => v / l);
  let differ = 0;
  for (const cell of core.immersedSourceWeights(e, shape).cells) {
    const d = [cell.x + 0.5 - e.centreCells[0], cell.y + 0.5 - e.centreCells[1], cell.z + 0.5 - e.centreCells[2]];
    const cpu = core.immersedSlabLookup(d, e.basis, 64).index;
    const gpu = core.immersedSlabLookup(d, { e1, e2 }, 64).index;
    if (map.cells[cpu] !== map.cells[gpu]) differ += 1;
  }
  assert.equal(differ, 0, 'no slab cell reads a different coverage value between the two constructions');
});

test('turbulence and puff ride the slab: the receipt names them, puff is already in Q, turbulence modulates locally without renormalising', () => {
  const cfg = core.resolveImmersedSourceConfig({ ...base, emitterInletTurbulence: 0.6, emitterInletTurbulenceScale: 5, emitterPuff: 0.4, emitterPuffPeriod: 3 }, { ...shape, puffFactor: 1.3, inletSignals: { puff: [0.75], turbulence: { rms: 0.41 } } });
  assert.deepEqual(cfg.effective.inletDynamics, { turbulence: 0.6, turbulenceScaleCells: 5, turbulenceRms: 0.41, puff: 0.4, puffPeriod: 3, puffSignal: 0.75, puffFactor: 1.3, active: true });
  assert.ok(Math.abs(cfg.effective.fluxRequested - 0.1 * Math.PI * 6.4 * 6.4 * 1.3) < 1e-9, 'Q carries the caller\'s puff factor');
  const still = core.resolveImmersedSourceConfig(base, shape);
  assert.equal(still.effective.inletDynamics.active, false);
  assert.equal(cfg.effective.normaliser, still.effective.normaliser, 'turbulence does not change the normaliser');
  assert.equal(cfg.effective.supplyPredictionAuthority, 'nominal-no-lattice-this-step', 'rms alone cannot predict the modulated supply, and the receipt says so');
  assert.equal(cfg.effective.turbulenceSupplyFactor, 1);
});

// SID-01: the receipt predicts what the kernel's target law delivers this step.
test('with the step\'s lattice the predicted supply is the modulated, capped total, not nominal Q', () => {
  const field = new Float32Array(64 * 64).fill(0.5);
  const cfg = core.resolveImmersedSourceConfig({ ...base, emitterInletTurbulence: 0.6 }, { ...shape, inletSignals: { turbulence: { rms: 0.5, field } } });
  assert.equal(cfg.effective.supplyPredictionAuthority, 'step-locked-lattice');
  assert.ok(Math.abs(cfg.effective.turbulenceSupplyFactor - 1.3) < 1e-9, 'a uniform +0.5 field at amplitude 0.6 is ×1.3');
  assert.ok(Math.abs(cfg.effective.fluxEffectivePredicted - 1.3 * cfg.effective.fluxNominal) < 1e-9, 'no clipping: effective = 1.3 Q');
  assert.equal(cfg.effective.fluxNominal, cfg.effective.fluxRequested);
  assert.equal(cfg.effective.clipPredicted.cells, 0);
  // A field that is +1 on one half of the slab and −1 on the other: the weighted mean is near zero, the total near Q, but not exactly.
  const split = new Float32Array(64 * 64); for (let iz = 0; iz < 64; iz += 1) for (let ix = 0; ix < 64; ix += 1) split[iz * 64 + ix] = ix >= 32 ? 1 : -1;
  const half = core.resolveImmersedSourceConfig({ ...base, emitterInletTurbulence: 0.6 }, { ...shape, inletSignals: { turbulence: { rms: 1, field: split } } });
  assert.ok(Math.abs(half.effective.turbulenceSupplyFactor - 1) < 0.05 && half.effective.turbulenceSupplyFactor !== 1, `split field factor ${half.effective.turbulenceSupplyFactor}`);
  // Clipping follows the modulated target: a low cap clips the +1 half and the receipt counts it.
  const clipped = core.resolveImmersedSourceConfig({ ...base, emitterInletTurbulence: 0.6, immersedCapFraction: 0.1, immersedSpeed: 1 }, { ...shape, inletSignals: { turbulence: { rms: 1, field: split } } });
  const nominalClipped = core.resolveImmersedSourceConfig({ ...base, immersedCapFraction: 0.1, immersedSpeed: 1 }, shape);
  assert.ok(clipped.effective.clipPredicted.cells !== nominalClipped.effective.clipPredicted.cells, 'the clip count reads the modulated law');
  assert.ok(clipped.effective.fluxEffectivePredicted < clipped.effective.fluxNominal);
  // The replayed bench arm: the real lattice at the saved step, amplitude 0.6, bed pattern, is below Q.
  const lattice = new InletPerturbationField({ grid: 64, seed: 1 }).sampleAt({ step: 1804, tauSteps: 30, scaleCells: 5 });
  const bed = core.resolveImmersedSourceConfig({ ...base, emitterAperturePattern: 'bed', emitterInletTurbulence: 0.6, emitterInletTurbulenceScale: 5 }, { ...shape, inletSignals: { turbulence: { rms: 0.2947, field: lattice } } });
  assert.ok(bed.effective.turbulenceSupplyFactor > 0.85 && bed.effective.turbulenceSupplyFactor < 0.98, `bed-turb06 at step 1804 replays below Q (${bed.effective.turbulenceSupplyFactor})`);
});

test('uniforms: the slab basis, turbulence and the pattern flag ride a fifth and sixth vec4', () => {
  assert.equal(core.IMMERSED_SOURCE_UNIFORM_FLOATS, 24);
  assert.equal(core.VOLUME_UNIFORM_FLOATS, core.IMMERSED_SOURCE_UNIFORM_OFFSET + 24);
  assert.equal(core.VOLUME_UNIFORM_FLOATS % 4, 0);
  const on = core.resolveImmersedSourceConfig({ ...base, emitterAperturePattern: 'jets', emitterInletTurbulence: 0.6 }, shape);
  const u = core.immersedSourceUniformValues(on);
  assert.equal(u.length, 24);
  assert.deepEqual(u.slice(16, 20).map(v => Number(v.toFixed(6)) + 0), [1, 0, 0, 0.6], 'e1 and the turbulence amplitude');
  assert.deepEqual(u.slice(20, 24), [1, 0, 0, 0], 'pattern on');
  assert.deepEqual(core.immersedSourceUniformValues(core.resolveImmersedSourceConfig(base, shape)).slice(20, 24), [0, 0, 0, 0], 'the plain shape samples no coverage');
  assert.equal(core.immersedSourceUniformValues(core.resolveImmersedSourceConfig({ ...base, pressureSolver: 'legacy' }, shape)).length, 24);
  assert.match(kernel, /immersed_source_e: vec4<f32>,\n  immersed_source_f: vec4<f32>,\n\};/);
});

test('the kernel samples the coverage map and the lattice at the slab-local cell, and keeps the plain slab for the sponge exemption', () => {
  const fn = kernel.slice(kernel.indexOf('fn immersedPatternedWeight('), kernel.indexOf('\n}\n', kernel.indexOf('fn immersedPatternedWeight(')));
  assert.match(fn, /let e1 = u\.immersed_source_e\.xyz;/);
  assert.match(fn, /let e2 = normalize\(cross\(e1, n\)\);/, 'the kernel normalises, as the CPU does');
  assert.match(fn, /let slabCell = vec2<i32>\(clamp\(i32\(floor\(f32\(GRID\) \* 0\.5 \+ dot\(d, e1\)\)\), 0, i32\(GRID\) - 1\), clamp\(i32\(floor\(f32\(GRID\) \* 0\.5 \+ dot\(d, e2\)\)\), 0, i32\(GRID\) - 1\)\);/);
  assert.match(fn, /textureLoad\(inflowCoverage, slabCell, 0\)\.x/);
  assert.match(fn, /textureLoad\(inflowPerturbation, slabCell, 0\)\.x/);
  assert.match(fn, /max\(0\.0, 1\.0 \+ u\.immersed_source_e\.w \* perturbation\)/);
  assert.match(main, /let immersedSlabWeight = immersedSourceWeight\(cell\);\n\s+let immersedWeight = immersedPatternedWeight\(cell, immersedSlabWeight\);/);
  assert.match(main, /let wallFade = max\(1\.0 - smoothstep\(0\.86, 1\.0, wall\), clamp\(immersedSlabWeight, 0\.0, 1\.0\)\);/, 'the whole disc stays exempt, gaps between jets included');
});

test('the pack builds the slab\'s coverage map when the immersed law is admitted, keyed by pattern and pose, and the receipt carries it', () => {
  const pack = source.slice(source.indexOf('  function updateUniforms('), source.indexOf('writeAnalyticEmitterInjectionUniform(', source.indexOf('  function updateUniforms(')));
  assert.match(pack, /else if \(immersedSourceConfig\.effective\.admitted && inflowCoverageTexture\) \{\n\s+const coverageSignature = immersedCoverageSignatureFor\(immersedSourceConfig\);/);
  assert.match(pack, /inflowCoverageMap = immersedCoverageMapForConfig\(immersedSourceConfig\);/);
  assert.match(pack, /state\.immersedSource\.effective\.coverage = \{/);
  // The CPU map and the resolver's spec agree.
  const jets = core.resolveImmersedSourceConfig({ ...base, emitterAperturePattern: 'jets', emitterApertureCount: 6 }, shape);
  const map = core.immersedCoverageMapForConfig(jets);
  assert.equal(map.grid, 64); assert.equal(map.pattern, 'jets'); assert.ok(map.coveredCells > 0 && map.coveredCells < 64 * 64 * 0.05);
  assert.equal(core.immersedCoverageMapForConfig(core.resolveImmersedSourceConfig(base, shape)), null, 'the plain shape builds no map');
  assert.notEqual(core.immersedCoverageSignatureFor(jets), core.immersedCoverageSignatureFor(core.resolveImmersedSourceConfig({ ...base, emitterAperturePattern: 'jets', emitterApertureCount: 7 }, shape)));
  // Cockpit receipt names pattern and turbulence.
  assert.match(index, /immersed\.effective\.pattern\.kind !== 'shape' \? ` · pattern \$\{immersed\.effective\.pattern\.kind\}/);
  assert.match(index, /immersed\.effective\.inletDynamics\.turbulence > 0 \? ` · turbulence \$\{immersed\.effective\.inletDynamics\.turbulence/);
});

test('capture: the inlet controls are checked against the immersed receipt when that law is admitted', () => {
  const receipt = { emitterSourceLaw: 'immersed-source', inflowBoundary: { effective: { admitted: false, reason: 'source-law-is-not-inflow-boundary' } }, immersedSource: { requested: { sourceLaw: 'immersed-source' }, effective: { admitted: true, reason: null, pattern: { kind: 'jets', count: 6, lineWeight: 0.8, jetJitter: 0.3 }, inletDynamics: { turbulence: 0.6, turbulenceScaleCells: 5, puff: 0.4, puffPeriod: 3 } } } };
  const ok = (cid, v) => effectiveMismatches({ set: [[cid, v]] }, receipt, null);
  assert.deepEqual(ok('volume-emitter-aperture-pattern', 'jets'), []);
  assert.equal(ok('volume-emitter-aperture-pattern', 'bed').length, 1);
  assert.deepEqual(ok('volume-emitter-inlet-turbulence', '0.6'), []);
  assert.equal(ok('volume-emitter-inlet-turbulence', '0.2').length, 1);
  assert.deepEqual(ok('volume-emitter-puff', '0.4'), []);
  assert.deepEqual(ok('volume-emitter-line-weight', '0.8'), []);
  assert.deepEqual(ok('volume-emitter-jet-jitter', '0.3'), []);
  assert.deepEqual(ok('volume-emitter-inlet-turbulence-scale', '5'), []);
  assert.deepEqual(ok('volume-emitter-puff-period', '3'), []);
  // Neither law admitted: still refused.
  assert.equal(effectiveMismatches({ set: [['volume-emitter-puff', '0.4']] }, { inflowBoundary: { effective: { admitted: false } }, immersedSource: { effective: { admitted: false, reason: 'x' } } }, null).length, 1);
});
