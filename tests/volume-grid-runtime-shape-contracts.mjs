// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../volume-core.js';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const sceneSource = readFileSync(new URL('../scene-volume-source.mjs', import.meta.url), 'utf8');

// Grid dimensions as runtime values (Noah 2026-10-12: "That's a good change.
// Let's do it."). The grid width and height were WGSL override constants, so
// every new shape re-specialized and compiled the volume pipelines; a
// never-compiled shape blocked the page ~14 s (rebuild profile 6e7558c3-b). The
// dimensions now reach the shaders through uniforms: each compute and fragment
// entry point seats private GRID / GRID_Y (and the derived lattice sizes) from
// its uniform block first, so helpers read them unchanged and no pipeline
// carries a shape constant.

const moduleText = name => {
  const start = source.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `${name} exists`);
  const open = source.indexOf('`', start);
  return source.slice(open + 1, source.indexOf('`;\n', open + 1));
};
const entryPoints = text => [...text.matchAll(/@(compute|fragment|vertex)[^\n]*\n\s*fn (\w+)\([^)]*\)[^{]*\{\n([^\n]*)/g)]
  .map(([, stage, name, firstLine]) => ({ stage, name, firstLine: firstLine.trim() }));

test('no grid-shape override constant remains in the volume shaders', () => {
  for (const name of ['WGSL', 'ANALYTIC_EMITTER_INJECTION_WGSL', 'BOUNDARY_SPLAT_WGSL']) {
    const text = moduleText(name);
    for (const id of ['GRID', 'GRID_Y', 'IRRADIANCE_GRID', 'IRRADIANCE_GRID_Y', 'SCENE_SOURCE_GRID', 'SCENE_SOURCE_GRID_Y']) {
      assert.ok(!new RegExp(`override ${id}\\b`).test(text), `${name}: no override ${id}`);
    }
  }
  assert.ok(!/override SCENE_SOURCE_GRID/.test(sceneSource), 'scene source: no override');
  assert.match(moduleText('WGSL'), /var<private> GRID: u32;\nvar<private> GRID_Y: u32;/);
});

test('no pipeline is created with a grid-shape constant', () => {
  assert.ok(!/\bGRID\s*:\s*gridSize\b|\bGRID_Y\s*:\s*gridHeight\b|IRRADIANCE_GRID\s*:\s*irradianceGridSize|IRRADIANCE_GRID_Y\s*:\s*irradianceGridHeight/.test(source), 'spaced or compact');
  assert.ok(!/SCENE_SOURCE_GRID: grid|GRID: fluidGrid/.test(sceneSource));
});

test('every compute and fragment entry point seats the grid shape first; vertex entry points that need it too', () => {
  const main = entryPoints(moduleText('WGSL'));
  assert.equal(main.filter(e => e.stage !== 'vertex').length, 24, 'every main compute/fragment entry point is checked');
  assert.match(sceneSource, /fn seedSceneVolumeSource\(@builtin\(global_invocation_id\) c: vec3<u32>\) \{\n  seatGridShape\(\);/, 'the scene source seed (interpolated into the main shader) seats it too');
  for (const e of main) {
    if (e.stage === 'vertex') assert.notEqual(e.firstLine, 'seatGridShape();', `${e.name}: the vertex stage cannot read the fluid uniforms`);
    else assert.equal(e.firstLine, 'seatGridShape();', `${e.name} seats the grid shape`);
  }
  assert.match(moduleText('WGSL'), /fn seatGridShape\(\) \{\n  GRID = u32\(u\.grid_shape\.x\);\n  GRID_Y = u32\(u\.grid_shape\.y\);\n  IRRADIANCE_GRID = u32\(u\.grid_shape\.z\);\n  IRRADIANCE_GRID_Y = u32\(u\.grid_shape\.w\);\n  SCENE_SOURCE_GRID = u32\(u\.grid_shape_b\.x\);\n  SCENE_SOURCE_GRID_Y = u32\(u\.grid_shape_b\.y\);\n\}/);
  const emitter = entryPoints(moduleText('ANALYTIC_EMITTER_INJECTION_WGSL'));
  assert.deepEqual(emitter.map(e => e.firstLine), ['seatGridShape();']);
  assert.match(moduleText('ANALYTIC_EMITTER_INJECTION_WGSL'), /fn seatGridShape\(\) \{\n  GRID = emitter\.cell_min_grid\.w;\n  GRID_Y = emitter\.cell_extent\.w;\n\}/);
  const splat = entryPoints(moduleText('BOUNDARY_SPLAT_WGSL'));
  assert.equal(splat.length, 8);
  for (const e of splat) assert.equal(e.firstLine, 'seatGridShape();', `${e.name} seats the grid shape`);
  assert.match(moduleText('BOUNDARY_SPLAT_WGSL'), /fn seatGridShape\(\) \{\n  GRID = u32\(boundarySplatCamera\.gridShape\.x\);\n  GRID_Y = u32\(boundarySplatCamera\.gridShape\.y\);\n\}/);
});

test('the uniforms carry the shape: fluid block, emitter words, splat camera', () => {
  assert.equal(core.GRID_SHAPE_UNIFORM_FLOATS, 8);
  assert.equal(core.GRID_SHAPE_UNIFORM_OFFSET, core.IMMERSED_SOURCE_UNIFORM_OFFSET + core.IMMERSED_SOURCE_UNIFORM_FLOATS);
  assert.equal(core.REACTANT_COMBUSTION_UNIFORM_OFFSET, core.GRID_SHAPE_UNIFORM_OFFSET + core.GRID_SHAPE_UNIFORM_FLOATS, 'the reactant combustion block follows the grid shape');
  assert.equal(core.JOINED_BOUNDARY_UNIFORM_OFFSET, core.REACTANT_COMBUSTION_UNIFORM_OFFSET + core.REACTANT_COMBUSTION_UNIFORM_FLOATS, 'the joined-boundary block follows the reactant block');
  assert.deepEqual(core.gridShapeUniformValues({ grid: 48, gridHeight: 144, irradianceGrid: 32, irradianceGridHeight: 96, sceneSourceGrid: 32, sceneSourceGridHeight: 96 }), [48, 144, 32, 96, 32, 96, 0, 0]);
  assert.match(moduleText('WGSL'), /  immersed_source_f: vec4<f32>,\n(  \/\/[^\n]*\n)*  grid_shape: vec4<f32>,\n  grid_shape_b: vec4<f32>,\n(  \/\/[^\n]*\n)*  reactant_combustion_a: vec4<f32>,/);
  assert.match(source, /uniforms\.set\(gridShapeUniformValues\(\{ grid: gridSize, gridHeight, irradianceGrid: irradianceGridSize, irradianceGridHeight: gridHeightForSize\(irradianceGridSize\), sceneSourceGrid: EMISSIVE_LIGHT_GRID, sceneSourceGridHeight: gridHeightForSize\(EMISSIVE_LIGHT_GRID\) \}\), GRID_SHAPE_UNIFORM_OFFSET\);/);
  // The emitter's cell_extent.w carries the height (cell_min_grid.w already carried the width).
  const floats = new Float32Array(36), words = new Uint32Array(floats.buffer);
  const descriptor = {
    family: 'ring', inletProfile: 'edge-entrained', momentumLinked: false, effectiveInletVelocity: 0.74, shearWidthCells: 0.5, edgeEntrainment: 1.62,
    origin: [0, -0.9, 0], axis: [0, 1, 0], supportAxis: [1, 0, 0], radius: 0.3, extent: [0, 0, 0], strength: 1, velocitySpeed: 0, transportSpeed: 0,
    sourceLaw: 'shallow-primary', sourceDepth: 0.01, chemistry: { smoke: 0, heat: 1, fuel: 1, flame: 0, detail: 0 }, geometry: [0, 0, 0],
  };
  const dispatch = { cellMin: [0, 0, 0], cellExtent: [1, 1, 1], grid: 48, workgroups: [1, 1, 1], active: true, cellCount: 1, family: 'ring' };
  core.writeAnalyticEmitterInjectionUniform(floats, words, descriptor, dispatch, 0, { gridHeight: 144 });
  assert.equal(words[31], 48); assert.equal(words[35], 144);
  assert.match(moduleText('BOUNDARY_SPLAT_WGSL'), /  productTransform: vec4<f32>,\n  gridShape: vec4<f32>,\n\}/);
  assert.match(source, /const splatCamera = new Float32Array\(60\);/);
  assert.match(source, /\{ incrementScale: timeStepConfig\.effective\.incrementScale, gridHeight \},/, 'the core passes the height to the emitter packer');
  assert.match(source, /splatCamera\.set\(\[gridSize, gridHeight, 0, 0\], 56\);/);
  assert.match(source, /label: `kaminos \$\{BOUNDARY_SPLAT_RENDERER_IDENTITY\} camera`,\n\s+size: 240,/);
});

// Live witness of 87f3765b: the pressure passes bind group 0 through the
// fluid-front read layout, which had no uniform block, so they could not seat
// the grid shape ("Binding doesn't exist ... @group(0) @binding(0)"). Every
// group-0 layout of the main shader carries the fluid uniforms at binding 0,
// and every bind group made from the fluid-front read layout binds them.
test('the fluid-front read layout and its bind groups carry the fluid uniforms at binding 0', () => {
  const layout = source.slice(source.indexOf('fluidFrontReadBindGroupLayout = device.createBindGroupLayout({'), source.indexOf('boundarySidecarWriteBindGroupLayout = device.createBindGroupLayout({'));
  assert.match(layout, /\{ binding: 0, visibility: GPUShaderStage\.COMPUTE, buffer: \{ type: 'uniform' \} \},/);
  const groups = [...source.matchAll(/layout: fluidFrontReadBindGroupLayout,\n\s+entries: \[\n([\s\S]*?)\n\s+\],/g)].map(m => m[1]);
  assert.equal(groups.length, 4, 'four bind groups use the layout');
  for (const entries of groups) assert.match(entries, /\{ ?binding: 0, resource: \{ ?buffer: uniformBuffer ?\} ?\},/);
});

// Review GR-01 (2026-10-13): the emissive-light seed, interpolated into the
// main shader, sampled the fluid with unseated (zero) GRID / GRID_Y. Every
// entry point of every module interpolated into the main shader seats first,
// except the two lattice-only emissive passes, which never reach the fluid
// samplers (and whose resolve layout has no fluid uniform binding).
test('interpolated modules: every entry point seats first except the lattice-only emissive passes', async () => {
  const exempt = new Set(['sweepEmissiveLight', 'resolveEmissiveLight']);
  const interpolated = [...moduleText('WGSL').matchAll(/\$\{([A-Z_]+_WGSL)\}/g)].map(m => m[1]);
  assert.deepEqual(interpolated, ['PASSIVE_MATERIAL_WGSL', 'REACTANT_COMBUSTION_WGSL', 'PHYSICAL_COLOR_WGSL', 'EMISSIVE_TRANSPORT_WGSL', 'SCENE_VOLUME_SOURCE_WGSL']);
  const texts = {
    PASSIVE_MATERIAL_WGSL: core.PASSIVE_MATERIAL_WGSL,
    // Helper functions only (no entry points); listed so the interpolation order stays pinned.
    REACTANT_COMBUSTION_WGSL: (await import('../volume-reactant-combustion.mjs')).REACTANT_COMBUSTION_WGSL,
    PHYSICAL_COLOR_WGSL: (await import('../volume-physical-color.mjs')).PHYSICAL_COLOR_WGSL,
    EMISSIVE_TRANSPORT_WGSL: (await import('../volume-emissive-transport.mjs')).EMISSIVE_TRANSPORT_WGSL,
    SCENE_VOLUME_SOURCE_WGSL: (await import('../scene-volume-source.mjs')).SCENE_VOLUME_SOURCE_WGSL,
  };
  const seen = [];
  for (const [name, text] of Object.entries(texts)) {
    for (const e of entryPoints(text)) {
      seen.push(e.name);
      if (exempt.has(e.name)) {
        const body = text.slice(text.indexOf(`fn ${e.name}(`), text.indexOf('\n}\n', text.indexOf(`fn ${e.name}(`)));
        assert.ok(!/\bGRID(_Y)?\b/.test(body), `${name}:${e.name} is exempt only while it never reads the fluid grid`);
      } else {
        assert.equal(e.firstLine, 'seatGridShape();', `${name}:${e.name} seats the grid shape`);
      }
    }
  }
  assert.ok(seen.includes('seedEmissiveLight') && seen.includes('seedSceneVolumeSource'));
});

// Witness for GR-01: read back the emissive seed coefficients and summarise
// them; the capture fails an arm whose coefficients are missing, non-finite or
// spatially flat.
test('emissive seed readback: stats helper, field readback, capture check', async () => {
  const emissive = await import('../volume-emissive-transport.mjs');
  const { emissiveCoefficientsMismatch } = await import('../volume-arm-capture-checks.mjs');
  const values = new Float32Array([0, 0, 0, 0, 1, 2, 3, 0.5, 2, 2, 2, 1.5, 0, 0, 0, 0]);
  const stats = emissive.emissiveCoefficientStats(values);
  assert.deepEqual({ ...stats }, { cells: 4, finiteCells: 4, nonzeroCells: 2, extinctionMax: 1.5, extinctionMean: 0.5, emissionMax: 3, extinctionStdDev: Math.sqrt((0.25 + 0 + 1 + 0.25) / 4) });
  assert.equal(emissive.emissiveCoefficientStats(new Float32Array([NaN, 0, 0, 0])).finiteCells, 0);
  const field = readFileSync(new URL('../volume-emissive-transport.mjs', import.meta.url), 'utf8');
  assert.match(field, /const coefficients = device\.createBuffer\(\{ label: 'emissive material coefficients', size: cells\*16, usage: GPUBufferUsage\.STORAGE \| GPUBufferUsage\.COPY_SRC \}\);/);
  assert.match(field, /    async readCoefficients\(\) \{/);
  assert.match(source, /    async sampleEmissiveSeedCoefficients\(\) \{/);
  const producer = { grid: [48, 96, 48], frameLag: 0 };
  assert.equal(emissiveCoefficientsMismatch({ status: 'sampled', grid: [48, 96, 48], producer, ...stats }), null);
  assert.match(emissiveCoefficientsMismatch(null), /missing/);
  assert.match(emissiveCoefficientsMismatch({ status: 'unsupported', reason: 'emissive-light-field-inactive' }), /unsupported \(emissive-light-field-inactive\)/);
  assert.match(emissiveCoefficientsMismatch({ status: 'sampled', grid: [48, 96, 48], producer, ...stats, finiteCells: 3 }), /non-finite/);
  assert.match(emissiveCoefficientsMismatch({ status: 'sampled', grid: [48, 96, 48], producer, ...stats, nonzeroCells: 0 }), /no nonzero/);
  assert.match(emissiveCoefficientsMismatch({ status: 'sampled', grid: [48, 96, 48], producer, ...stats, extinctionStdDev: 0 }), /spatially flat/);
  const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
  assert.match(capture, /if \(cid === '@emissiveCoefficients'\) \{/);
  assert.match(capture, /emissiveCoefficients: arm\.emissiveCoefficients \|\| \[\]/);
});

// Review GR-02: the readback accepted coefficients retained from an earlier
// draw after the route stopped dispatching the seed. The seed dispatch records
// its producer (frame, step, grid); a rebuild clears it; the witness carries
// it and the capture check fails a missing, stale or other-shape producer.
test('emissive seed witness is bound to its producer: frame, step and grid of the dispatch that wrote it', async () => {
  const { emissiveCoefficientsMismatch } = await import('../volume-arm-capture-checks.mjs');
  assert.match(source, /emissiveLightField\.encode\(encoder, currentFluid, options\.emissiveTimestampWrites\);\n\s+emissiveSeedProducer = \{ frameCount: state\.frameCount, simStepCount: state\.simStepCount, grid: \[gridSize, gridHeight, gridSize\] \};/);
  assert.match(source, /emissiveLightField = createEmissiveLightField\(device, shader, uniformBuffer, fluidBuffers, frontBuffers, \(\) => reactantTextures\);\n\s+emissiveSeedProducer = null;/);
  assert.match(source, /if \(!emissiveSeedProducer\) return \{ status: 'unsupported', reason: 'emissive-seed-not-dispatched', grid: \[gridSize, gridHeight, gridSize\] \};/);
  const base = { status: 'sampled', grid: [48, 96, 48], cells: 4, finiteCells: 4, nonzeroCells: 2, extinctionStdDev: 0.5 };
  assert.equal(emissiveCoefficientsMismatch({ ...base, producer: { grid: [48, 96, 48], frameLag: 1 } }), null);
  assert.match(emissiveCoefficientsMismatch({ ...base }), /no producer/);
  assert.match(emissiveCoefficientsMismatch({ ...base, producer: { grid: [48, 144, 48], frameLag: 0 } }), /produced at grid 48,144,48, current 48,96,48/);
  assert.match(emissiveCoefficientsMismatch({ ...base, producer: { grid: [48, 96, 48], frameLag: 9 } }), /stale: produced 9 frames ago/);
  assert.match(emissiveCoefficientsMismatch({ status: 'unsupported', reason: 'emissive-seed-not-dispatched' }), /unsupported \(emissive-seed-not-dispatched\)/);
});

// GR-02 residuals (confirmation of 957e20b7): a frame that skips the seed
// (distributed lighting or physical colour off) clears the producer at once,
// and the capture requires the producer to be newer than the step at which the
// arm's last configuration took effect.
test('the producer is cleared on any frame that skips the seed; the capture requires a producer newer than the last configuration', async () => {
  const { emissiveCoefficientsMismatch } = await import('../volume-arm-capture-checks.mjs');
  assert.match(source, /      if\(distributedGroup\) \{\n\s+emissiveSeedProducer = null;/);
  assert.match(source, /    if \(uniforms\[368\] <= 1\.5\) emissiveSeedProducer = null;/);
  const base = { status: 'sampled', grid: [48, 96, 48], cells: 4, finiteCells: 4, nonzeroCells: 2, extinctionStdDev: 0.5, producer: { grid: [48, 96, 48], frameLag: 1, simStepCount: 120 } };
  assert.equal(emissiveCoefficientsMismatch(base, { minProducerStep: 100 }), null);
  assert.match(emissiveCoefficientsMismatch(base, { minProducerStep: 121 }), /produced at step 120, before the configuration took effect at step 121/);
  const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
  assert.match(capture, /const mismatch = emissiveCoefficientsMismatch\(sample, \{ minProducerStep: lastConfigStep \}\);/);
  assert.match(capture, /if \(armSetsConfiguration\(arm\.set\)\) lastConfigStep = after\.simStepCount;/);
});

// GR-02 last residual (confirmation of 5f14b52b): a sample taken in the same
// arm as a control change was compared with the previous arm's configuration
// step. The capture refuses that arm shape outright: the coefficient sample
// must be its own arm, after a configuration arm has settled.
test('capture: @emissiveCoefficients is refused in an arm that also sets controls', () => {
  const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
  assert.match(capture, /if \(armSetsConfiguration\(arm\.set\)\) fail\(report\.failurePhase, '@emissiveCoefficients must be its own arm, after the configuration arm has settled'\);/);
  const handler = capture.slice(capture.indexOf("if (cid === '@emissiveCoefficients') {"), capture.indexOf("if (cid === '@emissiveCoefficients') {") + 600);
  assert.ok(handler.indexOf('must be its own arm') < handler.indexOf('sampleEmissiveSeedCoefficients'), 'refused before any sampling');
});

// Post-landing review of 2eef9ccdd: the guard exempted every debug control,
// but @confinementEpsilon changes the simulation. Only controls that read or
// frame without changing the simulation are non-configuring.
test('capture: every control except the read-only debug controls counts as configuration', async () => {
  const { armSetsConfiguration, NON_CONFIGURING_CAPTURE_CONTROLS } = await import('../volume-arm-capture-checks.mjs');
  assert.deepEqual([...NON_CONFIGURING_CAPTURE_CONTROLS].sort(), ['@cameraFrame', '@emissiveCoefficients', '@savePreset', '@simGpuProfile']);
  assert.equal(armSetsConfiguration([['@confinementEpsilon', '0.1']]), true, 'an epsilon override is configuration');
  assert.equal(armSetsConfiguration([['volume-grid-height-ratio', '3']]), true);
  assert.equal(armSetsConfiguration([['@cameraFrame', '0:1:3:0:0:0'], ['@emissiveCoefficients', '1']]), false);
  assert.equal(armSetsConfiguration([['@someFutureControl', '1']]), true, 'an unknown debug control is configuration until declared otherwise');
});
