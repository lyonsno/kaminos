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
  assert.equal(core.VOLUME_UNIFORM_FLOATS, core.GRID_SHAPE_UNIFORM_OFFSET + core.GRID_SHAPE_UNIFORM_FLOATS);
  assert.deepEqual(core.gridShapeUniformValues({ grid: 48, gridHeight: 144, irradianceGrid: 32, irradianceGridHeight: 96, sceneSourceGrid: 32, sceneSourceGridHeight: 96 }), [48, 144, 32, 96, 32, 96, 0, 0]);
  assert.match(moduleText('WGSL'), /  immersed_source_f: vec4<f32>,\n(  \/\/[^\n]*\n)*  grid_shape: vec4<f32>,\n  grid_shape_b: vec4<f32>,\n\}/);
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
