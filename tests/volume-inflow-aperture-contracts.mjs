import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Emitter slice 2 (flame-doctor, 2026-10-01): aperture shapes as a CPU-built
// floor coverage map, swirl (tangential inflow velocity), and a gusty wind
// model. The shader stops knowing the aperture's shape; it reads one weight per
// floor cell from a storage buffer.

const aperture = await import('../volume-inflow-aperture.mjs');
const core = await import('../volume-core.js');
const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const schema = JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json', import.meta.url), 'utf8'));

function wgslFunction(name) {
  const start = source.indexOf(`\nfn ${name}(`);
  assert.notEqual(start, -1, `production helper ${name} exists`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

const ring = { kind: 'annulus', center: [0, 0], ringRadius: 0.7, bandHalfWidth: 0.14 };

test('the coverage map is deterministic, bounded, and reproduces the family shape as its default', () => {
  assert.deepEqual([...aperture.INFLOW_APERTURE_PATTERNS], ['shape', 'jets', 'slot', 'bed'], 'spiral and concentric are retired: at a visible density the flame hides them (Noah 2026-10-06)');
  const a = aperture.buildInflowCoverageMap({ grid: 64, spec: { ...ring, pattern: 'shape' } });
  const b = aperture.buildInflowCoverageMap({ grid: 64, spec: { ...ring, pattern: 'shape' } });
  assert.deepEqual([...a.cells], [...b.cells], 'same inputs, same map');
  assert.equal(a.cells.length, 64 * 64);
  assert.ok(a.peak <= 1 && a.peak > 0.99, `interior cells are fully covered (peak ${a.peak})`);
  assert.ok([...a.cells].every(w => w >= 0 && w <= 1));
  // A ring of radius 0.7 and band 0.14 on a 64 grid covers about the annulus area in cells.
  const annulusArea = Math.PI * ((0.84 ** 2) - (0.56 ** 2));
  const expectedCells = annulusArea / ((2 / 64) ** 2);
  assert.ok(Math.abs(a.totalCoverage - expectedCells) / expectedCells < 0.05, `total coverage ${a.totalCoverage.toFixed(1)} tracks the annulus area ${expectedCells.toFixed(1)} within 5 %`);
  const centre = a.cells[32 * 64 + 32];
  assert.equal(centre, 0, 'the centre of the ring is uncovered');
  // Partial cells exist at the edges (the supersample makes them fractional).
  assert.ok([...a.cells].some(w => w > 0.1 && w < 0.9), 'edge cells are fractional, not a staircase');
});

test('jets, slot and bed are distinct deterministic patterns with the expected structure; retired patterns fall back to the family shape with a reason', () => {
  const build = (pattern, extra = {}) => aperture.buildInflowCoverageMap({ grid: 64, spec: { ...ring, pattern, ...extra } });
  const jets = build('jets', { count: 12 });
  const shape = build('shape');
  assert.ok(jets.totalCoverage < shape.totalCoverage * 0.8, 'twelve jets cover less floor than the full ring');
  assert.ok(jets.coveredCells > 0);
  // Along the ring circle, the jets pattern alternates covered and uncovered.
  const onRing = [];
  for (let i = 0; i < 360; i += 3) {
    const x = Math.cos(i * Math.PI / 180) * 0.7; const z = Math.sin(i * Math.PI / 180) * 0.7;
    onRing.push(aperture.inflowPatternCoverage(aperture.normalizeInflowApertureSpec({ ...ring, pattern: 'jets', count: 12, antialias: 2 / 64 }), x, z));
  }
  const transitions = onRing.filter((w, i) => i > 0 && (w > 0.5) !== (onRing[i - 1] > 0.5)).length;
  assert.ok(transitions >= 20 && transitions <= 26, `twelve jets give about 24 on/off transitions around the ring (got ${transitions})`);
  const retired = aperture.normalizeInflowApertureSpec({ ...ring, pattern: 'concentric', antialias: 2 / 64 });
  assert.equal(retired.pattern, 'shape', 'a basin saved with a retired pattern loads as the family shape');
  assert.equal(retired.patternFallback, 'concentric retired; family shape used');
  assert.equal(aperture.normalizeInflowApertureSpec({ ...ring, pattern: 'spiral' }).patternFallback, 'spiral retired; family shape used');
  assert.equal(aperture.normalizeInflowApertureSpec({ ...ring, pattern: 'jets' }).patternFallback, null);
  const slot = build('slot');
  const specSlot = aperture.normalizeInflowApertureSpec({ ...ring, pattern: 'slot', antialias: 2 / 64 });
  assert.equal(aperture.inflowPatternCoverage(specSlot, 0.5, 0), 1, 'the slot runs along the side axis through the centre');
  assert.equal(aperture.inflowPatternCoverage(specSlot, 0, 0.5), 0, 'and not across it');
  const bed1 = build('bed', { seed: 1 });
  const bed2 = build('bed', { seed: 2 });
  const bed1b = build('bed', { seed: 1 });
  assert.deepEqual([...bed1.cells], [...bed1b.cells], 'the bed is deterministic in its seed');
  assert.notDeepEqual([...bed1.cells], [...bed2.cells], 'and differs between seeds');
  assert.ok(bed1.coveredCells > 0.2 * shape.coveredCells && bed1.totalCoverage < Math.PI * (0.7 / (2 / 64)) ** 2, 'the bed is a patchy disc, neither empty nor solid');
  assert.equal(aperture.inflowPatternCoverage(aperture.normalizeInflowApertureSpec({ ...ring, pattern: 'bed', antialias: 2 / 64 }), 0.95, 0), 0, 'nothing beyond the reach');
  assert.throws(() => aperture.normalizeInflowApertureSpec({ ...ring, pattern: 'hexagon' }), /unsupported inflow aperture pattern/);
});

test('line weight scales every pattern\'s band; jet size jitter varies the jets\' radii deterministically', () => {
  const build = (pattern, extra = {}) => aperture.buildInflowCoverageMap({ grid: 64, spec: { ...ring, pattern, ...extra } });
  const thin = build('shape', { lineWeight: 0.5 }); const base = build('shape'); const thick = build('shape', { lineWeight: 2 });
  assert.ok(thin.totalCoverage < base.totalCoverage * 0.6 && thick.totalCoverage > base.totalCoverage * 1.7, `line weight scales the annulus band (${thin.totalCoverage.toFixed(0)} < ${base.totalCoverage.toFixed(0)} < ${thick.totalCoverage.toFixed(0)})`);
  const slotThin = build('slot', { lineWeight: 0.5 }); const slotBase = build('slot');
  assert.ok(slotThin.totalCoverage < slotBase.totalCoverage * 0.6, 'the slot gets its width from the same knob');
  assert.equal(aperture.normalizeInflowApertureSpec({ ...ring }).lineWeight, 1, 'default line weight is one');
  assert.equal(aperture.normalizeInflowApertureSpec({ ...ring, lineWeight: 9 }).lineWeight, 3, 'clamped to [0.25, 3]');
  // Jitter: with the same seed, jets of unequal radii; without it, equal. Total coverage stays within a third.
  const spec = extra => aperture.normalizeInflowApertureSpec({ ...ring, pattern: 'jets', count: 8, antialias: 2 / 64, ...extra });
  const radii = s => aperture.inflowJetRadii(s);
  const even = radii(spec({ jetJitter: 0 })); const jittered = radii(spec({ jetJitter: 1, seed: 3 })); const again = radii(spec({ jetJitter: 1, seed: 3 }));
  assert.equal(even.length, 8);
  assert.ok(even.every(r => Math.abs(r - even[0]) < 1e-12), 'no jitter: equal jets');
  assert.ok(Math.max(...jittered) / Math.min(...jittered) > 1.5, `jitter 1 spreads the radii (${Math.min(...jittered).toFixed(3)} … ${Math.max(...jittered).toFixed(3)})`);
  assert.deepEqual(jittered, again, 'deterministic in the seed');
  assert.notDeepEqual(jittered, radii(spec({ jetJitter: 1, seed: 4 })), 'another seed, other radii');
  const jj = build('jets', { count: 8, jetJitter: 1, seed: 3 }); const j0 = build('jets', { count: 8, jetJitter: 0 });
  assert.ok(Math.abs(jj.totalCoverage - j0.totalCoverage) / j0.totalCoverage < 0.34, 'jitter redistributes area more than it adds');
});

test('the core carries the pattern and swirl through the resolver, packs them, and reads the coverage from a buffer', async () => {
  const basis = await import('../volume-emitter-basis.mjs');
  const compiled = basis.compileVolumeEmitterFamily({ family: 'ring', origin: [0, -0.76, 0], direction: [0, 1, 0], supportAxis: [1, 0, 0], radius: 0.14, ringRadius: 0.7, strength: 2.5, sourceLaw: 'inflow-boundary', inletVelocity: 0.1 });
  const controls = { pressureSolver: 'converged-open-top', projection: 1, emitterAperturePattern: 'jets', emitterApertureCount: 8, emitterApertureRatio: 0.4, emitterApertureSeed: 3, emitterSwirl: 0.5 };
  const config = core.resolveInflowBoundaryConfig(controls, compiled.descriptor, { grid: 64 });
  assert.equal(config.effective.admitted, true);
  assert.deepEqual(config.effective.pattern, { kind: 'jets', count: 8, ratio: 0.4, seed: 3, lineWeight: 1, jetJitter: 0 });
  const styled = core.resolveInflowBoundaryConfig({ ...controls, emitterLineWeight: 1.5, emitterJetJitter: 0.7, emitterAperturePattern: 'spiral' }, compiled.descriptor, { grid: 64 });
  assert.deepEqual(styled.effective.pattern, { kind: 'spiral', count: 8, ratio: 0.4, seed: 3, lineWeight: 1.5, jetJitter: 0.7 }, 'line weight and jitter ride with the pattern; a retired kind is kept so the map can name the fallback');
  const styledMap = core.inflowCoverageMapForConfig(styled);
  assert.equal(styledMap.pattern, 'shape'); assert.equal(styledMap.patternFallback, 'spiral retired; family shape used'); assert.equal(styledMap.lineWeight, 1.5);
  assert.notEqual(core.inflowCoverageSignatureFor(styled), core.inflowCoverageSignatureFor(config), 'line weight and jitter are in the coverage signature');
  assert.equal(config.effective.swirl, 0.5);
  const packed = core.inflowBoundaryUniformValues(config);
  assert.equal(packed[8], 0.5, 'swirl rides in the third vec4');
  const map = core.inflowCoverageMapForConfig(config);
  assert.equal(map.pattern, 'jets');
  assert.equal(map.grid, 64);
  assert.equal(map.cells.length, 64 * 64);
  assert.equal(core.resolveInflowBoundaryConfig({ pressureSolver: 'converged-open-top', projection: 1 }, compiled.descriptor, { grid: 64 }).effective.pattern.kind, 'shape', 'the family shape is the default pattern');
  assert.equal(core.resolveInflowBoundaryConfig({ pressureSolver: 'converged-open-top', projection: 1, emitterSwirl: 3 }, compiled.descriptor, { grid: 64 }).effective.swirl, 1, 'swirl is clamped to [-1, 1]');
  // Shader: the weight is a buffer read, the shape SDFs are gone from WGSL.
  // A texture, not a storage buffer: the compute stage's ten storage buffers are spent (the first live look failed at pipeline-layout creation with eleven).
  assert.match(source, /@group\(0\) @binding\(17\) var inflowCoverage: texture_2d<f32>;/, 'the coverage map is a 2-D float texture at binding 17');
  const weight = wgslFunction('inflowApertureWeight');
  assert.match(weight, /textureLoad\(inflowCoverage, vec2<i32>\(clamp\(cell\.x, 0, i32\(GRID\) - 1\), clamp\(cell\.z, 0, i32\(GRID\) - 1\)\), 0\)\.x/, 'the cell weight is read from the map texel');
  assert.doesNotMatch(source, /fn inflowApertureCoverageAt\(/, 'the shader no longer evaluates the aperture shape');
  // The raymarch fragment entry point samples the fluid through sampleFluidSlot and so reaches the map: both stages must be visible (the second live look failed pipeline validation with compute-only).
  assert.match(source, /\{ binding: 17, visibility: GPUShaderStage\.FRAGMENT \| GPUShaderStage\.COMPUTE, texture: \{ sampleType: 'unfilterable-float', viewDimension: '2d' \} \}/, 'layout entry: an unfilterable float texture visible to fragment and compute');
  assert.match(source, /\{ binding: 17, resource: inflowCoverageTexture\.createView\(\) \}/, 'bind group entry');
  assert.match(source, /inflowCoverageTexture = device\.createTexture\(\{\s*label: `kaminos inflow aperture coverage map[\s\S]{0,200}format: 'r32float'/, 'the texture is created with the fluid state');
  assert.match(source, /device\.queue\.writeTexture\(\{ texture: inflowCoverageTexture \}, inflowCoverageMap\.cells, \{ bytesPerRow: gridSize \* Float32Array\.BYTES_PER_ELEMENT \}, \[gridSize, gridSize, 1\]\)/, 'and written when the map changes');
  assert.match(source, /state\.inflowBoundary\.effective\.coverage = /, 'the receipt carries the map summary');
  // Swirl: the ghost velocity gains a tangential component around the aperture centre.
  const ghost = wgslFunction('inflowGhostVelocity');
  assert.match(ghost, /let tangent = vec2<f32>\(-q\.y, q\.x\) \/ max\(length\(q\), 1e-4\);/, 'tangent from the aperture centre');
  assert.match(ghost, /inflowInletSpeed\(floorCell\) \* vec3<f32>\(tangent\.x \* swirl, 1\.0, tangent\.y \* swirl\)/, 'the entering gas carries the inlet speed (puff and turbulence included) up and swirl x that around');
  const ghostState = wgslFunction('inflowGhostState');
  assert.match(ghostState, /inflowGhostVelocity\(cellCenter\)/, 'the ghost state uses it for slot 0');
  const model = core.inflowGhostVelocityModel({ position: [0.7, 0], center: [0, 0], inletVelocity: 0.1, swirl: 0.5 });
  assert.ok(Math.abs(model[0] - 0) < 1e-9 && Math.abs(model[1] - 0.1) < 1e-9 && Math.abs(model[2] - 0.05) < 1e-9, 'at (0.7, 0) the tangent is +z: velocity (0, v_in, swirl v_in)');
});

test('wind: steady is the authored law unchanged; gusty modulates strength and veers direction with a seeded, step-locked, slowly varying stochastic signal and no periodic math', () => {
  const steady = core.resolveWindConfig({ windStrength: 0.6, windAngle: 30, windHeight: 0.15 });
  assert.equal(steady.effective.model, 'steady');
  assert.equal(steady.effective.strength, 0.6);
  assert.equal(steady.effective.angleDeg, 30);
  const gustControls = { windModel: 'gusty', windStrength: 0.6, windAngle: 30, windGust: 0.6, windGustPeriod: 8, windGustVeer: 25 };
  const tau = 8 * core.WIND_GUST_STEPS_PER_SECOND;
  const a = new core.WindGustProcess(1); const b = new core.WindGustProcess(1); const c = new core.WindGustProcess(2);
  const sa = a.sampleAt(1000, tau); const sb = b.sampleAt(1000, tau); const sc = c.sampleAt(1000, tau);
  assert.deepEqual(sa, sb, 'same seed and step, same signal');
  assert.notDeepEqual(sa, sc, 'another seed, another wind');
  assert.ok(Math.abs(sa.s1) <= 1 && Math.abs(sa.s2) <= 1);
  const gusty = core.resolveWindConfig(gustControls, sa);
  assert.equal(gusty.effective.model, 'gusty');
  assert.ok(gusty.effective.strength >= 0 && gusty.effective.strength <= 0.6 * 1.6, 'strength stays within base x (1 ± gust)');
  assert.ok(Math.abs(gusty.effective.angleDeg - 30) <= 25, 'the veer stays within the veer angle');
  assert.equal(gusty.effective.step, 1000);
  // Slowly varying: over 60 steps (one second) the signal moves by much less
  // than its range at an eight-second correlation time, and incremental
  // advance equals a fresh walk to the same step.
  const next = a.sampleAt(1060, tau);
  assert.ok(Math.abs(next.s1 - sa.s1) < 0.6, `one second moves the signal by ${Math.abs(next.s1 - sa.s1).toFixed(3)}, less than its range`);
  assert.deepEqual(new core.WindGustProcess(1).sampleAt(1060, tau), next, 'incremental advance is replayable');
  // Over a long run the signal is a genuine gust: it visits both signs and
  // stays bounded.
  const long = new core.WindGustProcess(3); let lo = 1; let hi = -1;
  for (let step = 0; step <= 20000; step += 100) { const s = long.sampleAt(step, tau); lo = Math.min(lo, s.s1); hi = Math.max(hi, s.s1); }
  assert.ok(lo < -0.3 && hi > 0.3 && lo >= -1 && hi <= 1, `the gust visits both signs (${lo.toFixed(2)} … ${hi.toFixed(2)})`);
  const calm = core.resolveWindConfig({ ...gustControls, windGust: 0, windGustVeer: 0 }, sa).effective;
  assert.equal(calm.strength, 0.6, 'zero gust is steady');
  assert.equal(calm.angleDeg, 30);
  // The packing writes the effective strength and angle from the step-locked process, and the receipt names the model.
  assert.match(source, /const windConfig = resolveWindConfig\(controlsSnapshot, windGustProcess\.sampleAt\(state\.simStepCount \?\? 0, windGustTauSteps\(controlsSnapshot\)\)\);\s*\n\s*uniforms\[53\] = windConfig\.effective\.strength;\s*\n\s*uniforms\[54\] = windConfig\.effective\.angleDeg \* Math\.PI \/ 180;/, 'the shader sees the effective wind');
  assert.match(source, /state\.wind = windConfig;/);
  assert.doesNotMatch(source.slice(source.indexOf('export class WindGustProcess'), source.indexOf('export function resolveWindConfig')), /Math\.(sin|cos|tan)/, 'the gust process uses no periodic math (the periodic-authorship inventory forbids trig animating a simulation uniform)');
});

test('wind: the effective strength never exceeds the shader ceiling, saturation is receipted, and the gust clock follows simulated time', () => {
  assert.equal(core.WIND_STRENGTH_CEILING, 1.5);
  const ceilingClamps = source.match(/clamp\(u\.scene_controls\.y, 0\.0, 1\.5\)/g) || [];
  assert.equal(ceilingClamps.length, 2, 'the predictor and the main kernel both clamp the wind strength at 1.5');
  // Base 1.5, gust 1, a positive signal of 0.5 would ask for 2.25: the shader
  // clamps at 1.5, so the receipt must say 1.5 and that it saturated.
  const high = core.resolveWindConfig({ windModel: 'gusty', windStrength: 1.5, windAngle: 0, windGust: 1, windGustPeriod: 8, windGustVeer: 0 }, { s1: 0.5, s2: 0, step: 10 }).effective;
  assert.equal(high.strength, 1.5, 'the effective strength is the strength the shader uses');
  assert.equal(high.saturated, true);
  assert.equal(high.unsaturatedStrength, 2.25, 'the asked-for strength is still visible');
  const low = core.resolveWindConfig({ windModel: 'gusty', windStrength: 0.5, windAngle: 0, windGust: 0.8, windGustPeriod: 8, windGustVeer: 0 }, { s1: 0.5, s2: 0, step: 10 }).effective;
  assert.equal(low.saturated, false);
  assert.ok(Math.abs(low.strength - 0.7) < 1e-12);
  // The correlation time is `period` seconds of simulated time: under the
  // uniform time step at Speed 0.1 each step advances a tenth as much, so the
  // process must take ten times as many steps to decorrelate.
  const uniform = { timeStep: 'uniform', advectionScheme: 'maccormack', commonGasTransport: true };
  const full = core.windGustTauSteps({ ...uniform, windGustPeriod: 8, speed: 1 });
  const slow = core.windGustTauSteps({ ...uniform, windGustPeriod: 8, speed: 0.1 });
  assert.equal(full, 8 * core.WIND_GUST_STEPS_PER_SECOND);
  assert.ok(Math.abs(slow - full * 10) < 1e-9, `at Speed 0.1 the correlation time is ten times as many steps (${slow} vs ${full})`);
  assert.equal(core.windGustTauSteps({ windGustPeriod: 8, speed: 0.1 }), full, 'the legacy time step has no dt scale; the step clock stands');
  assert.match(source, /windGustProcess\.sampleAt\(state\.simStepCount \?\? 0, windGustTauSteps\(controlsSnapshot\)\)/, 'the packing uses the simulated-time correlation');
});

test('cockpit and schema carry the new controls', () => {
  for (const id of ['volume-emitter-aperture-pattern', 'volume-emitter-aperture-count', 'volume-emitter-aperture-ratio', 'volume-emitter-aperture-seed', 'volume-emitter-swirl', 'volume-wind-model', 'volume-wind-gust', 'volume-wind-gust-period', 'volume-wind-gust-veer']) {
    assert.match(index, new RegExp(`id="${id}"`), `${id} exists`);
    assert.ok(schema.controls.some(control => control.key === id), `${id} is in the schema`);
  }
  assert.match(index, /emitterAperturePattern: document\.getElementById\('volume-emitter-aperture-pattern'\)\.dataset\.volumeRetiredPatternRequest \|\| document\.getElementById\('volume-emitter-aperture-pattern'\)\.value/, 'the snapshot sends a kept retired request, else the select value');
  assert.match(index, /emitterSwirl: parseFloat\(document\.getElementById\('volume-emitter-swirl'\)\.value\)/);
  assert.match(index, /windModel: document\.getElementById\('volume-wind-model'\)\.value/);
  assert.match(index, /<option value="jets">Ring of jets<\/option>/);
  assert.match(index, /<option value="gusty">Gusty<\/option>/);
  // 2026-10-01: the first complete live look showed every pattern arm running
  // the family shape — the cockpit registers its change listeners from an
  // explicit id list, and none of the inflow or wind controls were in it, so a
  // change never reached the core until some other control moved.
  const listenerList = index.slice(index.indexOf("  for (const id of [\n    'volume-emitter-source-law',"), index.indexOf("    document.getElementById(id).addEventListener('input', syncControls);"));
  for (const id of ['volume-emitter-fuel-fraction', 'volume-emitter-inlet-temperature', 'volume-emitter-aperture-pattern', 'volume-emitter-aperture-count', 'volume-emitter-aperture-ratio', 'volume-emitter-aperture-seed', 'volume-emitter-swirl', 'volume-wind-model', 'volume-wind-gust', 'volume-wind-gust-period', 'volume-wind-gust-veer']) {
    assert.ok(listenerList.includes(`'${id}',`), `${id} has a change listener`);
  }
  const checks = readFileSync(new URL('../volume-arm-capture-checks.mjs', import.meta.url), 'utf8');
  assert.match(checks, /aperture pattern requested \$\{value\}, effective/, 'the arm capture refuses an arm whose pattern did not take effect');
  assert.match(checks, /wind model requested \$\{value\}, effective/, 'and one whose wind model did not');
  assert.match(readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8'), /const mismatches = effectiveMismatches\(arm, end, expectedMode, fault\);/, 'and the capture applies those checks to every arm');
  assert.equal(schema.controlCount, 234);
  const additive = schema.controls.filter(control => control.additiveSinceControlCount >= 219).map(control => control.additiveSinceControlCount);
  assert.deepEqual(additive, [219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234]);
});
