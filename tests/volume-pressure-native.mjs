// kaminos-test: node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractWgslFunction, withGpuErrorScopes, withKaminosGpu } from '../tools/shader-herder.mjs';

// Production pressure functions and entrypoints are intact. The fixture supplies
// uniform/storage declarations and disables joined inflow, expansion and material
// transport. This tests the separated pressure path, not the full scene ABI.
const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const entries = ['csDivergencePressureWarm', 'csPressureRedBlackEven', 'csPressureRedBlackOdd', 'csProjectPressureConverged'];
const functions = ['seatGridShape', 'index3', 'clampCell', 'insideGrid', 'sceneSolidEnabled', 'sceneSolidAt',
  'sceneFaceOpen', 'openWorldBoundary', 'gridExtent', 'pressureSolverOpenTop', 'compactFaceVelocity',
  'divergenceCompactAtCell', 'pressureIndexForCell', 'pressureNeighborInPlace', 'pressureNeighborRead',
  'pressureRedBlackUpdate', 'pressureRedBlackUpdateMasked', 'pressureStencilNeighbor', 'pressureRedBlackSweep'];
const code = `
struct FixtureUniforms { grid_shape: vec4<f32>, grid_shape_b: vec4<f32>,
  pressure_solver_controls: vec4<f32>, open_world_boundary: vec4<f32> };
@group(0) @binding(0) var<uniform> u: FixtureUniforms;
@group(0) @binding(1) var<storage, read> fluidSrc: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> fluidDst: array<vec4<f32>>;
@group(0) @binding(16) var sceneSolidCells: texture_3d<u32>;
@group(2) @binding(0) var<storage, read> pressureSrc: array<vec4<f32>>;
@group(2) @binding(1) var<storage, read_write> pressureDst: array<vec4<f32>>;
// Unused material-path declarations keep the extracted projection intact.
@group(0) @binding(7) var<storage, read> frontSrc: array<f32>;
@group(0) @binding(8) var<storage, read_write> frontDst: array<f32>;
@group(0) @binding(23) var reactantSrc: texture_3d<f32>;
@group(0) @binding(24) var reactantDst: texture_storage_3d<rg32float, write>;
const SEPARATED_PRESSURE = true;
const SLOTS_PER_CELL = 4u;
var<private> GRID: u32; var<private> GRID_Y: u32;
var<private> IRRADIANCE_GRID: u32; var<private> IRRADIANCE_GRID_Y: u32;
var<private> SCENE_SOURCE_GRID: u32; var<private> SCENE_SOURCE_GRID_Y: u32;
fn joinedBoundary() -> bool { return false; }
fn joinedLowerFace(c: vec3<i32>, axis: u32) -> f32 { return 0.0; }
fn inflowFaceVelocity(c: vec3<i32>) -> f32 { return 0.0; }
fn heatReleaseExpansion(c: vec3<i32>) -> f32 { return 0.0; }
fn readSlot(c: vec3<i32>, slot: u32) -> vec4<f32> { return fluidSrc[index3(clampCell(c)) * SLOTS_PER_CELL + slot]; }
fn reactantLawOn() -> bool { return false; }
fn compactAppearanceOn() -> bool { return false; }
fn boundVelocity(v: vec3<f32>) -> vec3<f32> { return v; }
${functions.map(name => extractWgslFunction(source, name)).join('\n')}
${entries.map(name => `@compute @workgroup_size(4, 4, 4)\n${extractWgslFunction(source, name)}`).join('\n')}`;
const declarations = text => entries.map(entryPoint => ({ label: `pressure-${entryPoint}`, entryPoint, code: text }));
const dims = [8, 6, 8]; // Non-cubic, and not a multiple of the workgroup height.
const count = dims.reduce((a, b) => a * b);
const index = ([x, y, z]) => x + dims[0] * (y + dims[1] * z);
const coords = Array.from({ length: count }, (_, i) => [i % dims[0], Math.floor(i / dims[0]) % dims[1], Math.floor(i / (dims[0] * dims[1]))]);
const inside = c => c.every((v, a) => v >= 0 && v < dims[a]);
function fixture(openTop, obstacle = false, masked = true) {
  const solid = coords.map(([x, y, z]) => Number(obstacle && x === 3 && y < 4 && z >= 2 && z < 6));
  const pressure = coords.map(([x, y, z]) => Math.sin(0.4 + x * 0.7) + 0.3 * Math.cos(y * 0.9) - 0.2 * Math.sin(z * 0.6));
  const faceOpen = (c, axis) => {
    const n = c.map((v, a) => v + Number(a === axis));
    return !solid[index(c)] && (inside(n) ? !solid[index(n)] : axis === 1 && openTop);
  };
  const fluid = new Float32Array(count * 16);
  coords.forEach((c, i) => {
    for (let a = 0; a < 3; a++) {
      const n = c.map((v, axis) => v + Number(a === axis));
      fluid[i * 16 + a] = faceOpen(c, a) ? (inside(n) ? pressure[index(n)] : 0) - pressure[i] : 0;
    }
  });
  // Independent finite-volume divergence of the manufactured gradient field.
  const rhs = coords.map((c, i) => solid[i] ? 0 : [0, 1, 2].reduce((sum, a) => {
    const lower = c.map((v, axis) => v - Number(a === axis));
    return sum + fluid[i * 16 + a] - (inside(lower) ? fluid[index(lower) * 16 + a] : 0);
  }, 0));
  assert.ok(rms(rhs) > 0.01, 'manufactured input has nonzero divergence');
  return { openTop, solid, pressure, fluid, rhs, masked };
}
const rms = values => Math.sqrt(values.reduce((s, x) => s + x * x, 0) / values.length);
function finiteShape(actual, length) {
  assert.equal(actual.length, length);
  assert.ok(actual.every(Number.isFinite), 'finite numerical readback');
}

async function dispatch(ctx, f, { text = code, sweeps = 160, gain = 1, halfOnly = false } = {}) {
  const { device, GPUBufferUsage: B, GPUTextureUsage: T, GPUMapMode: M } = ctx;
  const owned = [];
  const buffer = (values, usage) => {
    const b = device.createBuffer({ size: values.byteLength, usage }); owned.push(b);
    device.queue.writeBuffer(b, 0, values); return b;
  };
  try {
    return await withGpuErrorScopes(device, 'production-pressure-fixture', async () => {
      const uniforms = buffer(new Float32Array([8, 6, 8, 6, 8, 6, 0, 0, 1, Number(f.openTop), 1.4, gain, 0, 0, 0, 0]), B.UNIFORM | B.COPY_DST);
      const fluid = buffer(f.fluid, B.STORAGE | B.COPY_DST);
      const out = buffer(new Float32Array(f.fluid.length), B.STORAGE | B.COPY_DST | B.COPY_SRC);
      const initial = new Float32Array(count * 4);
      // Nonzero warm start makes untouched color/solid behavior observable.
      coords.forEach((_, i) => { initial[4 * i + 1] = 0.07 * Math.sin(i); });
      const p = buffer(initial, B.STORAGE | B.COPY_DST | B.COPY_SRC);
      const solidDims = f.masked ? dims : [1, 1, 1];
      const solids = device.createTexture({ size: solidDims, dimension: '3d', format: 'r32uint', usage: T.TEXTURE_BINDING | T.COPY_DST }); owned.push(solids);
      const front = buffer(new Float32Array(count), B.STORAGE | B.COPY_DST);
      const frontOut = buffer(new Float32Array(count), B.STORAGE | B.COPY_DST);
      const reactants = device.createTexture({ size: [1, 1, 1], dimension: '3d', format: 'rg32float', usage: T.TEXTURE_BINDING }); owned.push(reactants);
      const reactantsOut = device.createTexture({ size: [1, 1, 1], dimension: '3d', format: 'rg32float', usage: T.STORAGE_BINDING }); owned.push(reactantsOut);
      device.queue.writeTexture({ texture: solids }, new Uint32Array(f.solid), { bytesPerRow: dims[0] * 4, rowsPerImage: dims[1] }, solidDims);
      const module = await ctx.compileShaderModule({ label: 'production-pressure', code: text });
      const pipelines = Object.fromEntries(entries.map(entryPoint => [entryPoint,
        device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } })]));
      const encoder = device.createCommandEncoder();
      function run(name) {
        const pipeline = pipelines[name];
        const warm = name === entries[0], project = name === entries[3];
        const entries0 = [{ binding: 0, resource: { buffer: uniforms } }, { binding: 16, resource: solids.createView() }];
        if (warm || project) entries0.push({ binding: 1, resource: { buffer: fluid } });
        if (project) entries0.push({ binding: 2, resource: { buffer: out } },
          { binding: 7, resource: { buffer: front } }, { binding: 8, resource: { buffer: frontOut } },
          { binding: 23, resource: reactants.createView() }, { binding: 24, resource: reactantsOut.createView() });
        const pass = encoder.beginComputePass(); pass.setPipeline(pipeline);
        pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: entries0 }));
        pass.setBindGroup(1, device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [] }));
        pass.setBindGroup(2, device.createBindGroup({ layout: pipeline.getBindGroupLayout(2), entries: [{ binding: project ? 0 : 1, resource: { buffer: p } }] }));
        pass.dispatchWorkgroups(...dims.map(n => Math.ceil(n / 4))); pass.end();
      }
      run(entries[0]);
      if (halfOnly) run(entries[1]);
      else for (let i = 0; i < sweeps; i++) { run(entries[1]); run(entries[2]); }
      run(entries[3]);
      const size = initial.byteLength + f.fluid.byteLength;
      const read = device.createBuffer({ size, usage: B.COPY_DST | B.MAP_READ }); owned.push(read);
      encoder.copyBufferToBuffer(p, 0, read, 0, initial.byteLength);
      encoder.copyBufferToBuffer(out, 0, read, initial.byteLength, f.fluid.byteLength);
      device.queue.submit([encoder.finish()]); await read.mapAsync(M.READ);
      const values = new Float32Array(read.getMappedRange()).slice(); read.unmap();
      finiteShape(values, count * 20);
      return { pressure: values.slice(0, count * 4), fluid: values.slice(count * 4), initial };
    });
  } finally { for (const resource of owned) resource.destroy(); }
}

function checkSolve(result, f, gain = 1) {
  const actualP = coords.map((_, i) => result.pressure[4 * i + 1]);
  const residual = coords.map((c, i) => {
    if (f.solid[i]) return 0;
    let laplacian = 0;
    for (let a = 0; a < 3; a++) for (const sign of [-1, 1]) {
      const n = c.map((v, axis) => v + (a === axis ? sign : 0));
      if (inside(n)) { if (!f.solid[index(n)]) laplacian += actualP[index(n)] - actualP[i]; }
      else if (a === 1 && sign === 1 && f.openTop) laplacian -= actualP[i];
    }
    return laplacian - f.rhs[i];
  });
  assert.ok(rms(residual) < rms(f.rhs) * 0.001, `pressure residual ${rms(residual)} / ${rms(f.rhs)}`);
  const error = coords.flatMap((_, i) => [0, 1, 2].map(a => result.fluid[i * 16 + a] - f.fluid[i * 16 + a] * (1 - gain)));
  assert.ok(rms(error) < 0.001, `projected gradient error ${rms(error)}`);
  return { openTop: f.openTop, maskedStencil: f.masked, solidCells: f.solid.reduce((a, b) => a + b),
    gain, divergenceBeforeRms: rms(f.rhs), pressureResidualRms: rms(residual), projectedGradientErrorRms: rms(error) };
}

test('production red sweep updates its color and preserves the other color on a non-cubic grid', async () => {
  const f = fixture(true, true);
  await withKaminosGpu(async ctx => {
    const result = await dispatch(ctx, f, { halfOnly: true });
    coords.forEach((c, i) => {
      assert.ok(Math.abs(result.pressure[i * 4] - f.rhs[i]) < 0.000001, 'warm divergence');
      if ((c.reduce((a, b) => a + b) & 1) === 1) {
        assert.equal(result.pressure[i * 4 + 1], f.solid[i] ? 0 : result.initial[i * 4 + 1]);
      } else if (!f.solid[i]) {
        let sum = 0, degree = 0;
        for (let a = 0; a < 3; a++) for (const sign of [-1, 1]) {
          const n = c.map((v, axis) => v + (a === axis ? sign : 0));
          if (inside(n)) { if (!f.solid[index(n)]) { sum += result.initial[index(n) * 4 + 1]; degree++; } }
          else if (a === 1 && sign === 1 && f.openTop) degree++;
        }
        const before = result.initial[i * 4 + 1];
        const expected = before + ((sum - f.rhs[i]) / degree - before) * 1.4;
        assert.ok(Math.abs(result.pressure[i * 4 + 1] - expected) < 0.000001, 'red update uses the intended neighbors and RHS');
      }
    });
    assert.ok(coords.some((c, i) => !(c.reduce((a, b) => a + b) & 1)
      && Math.abs(result.pressure[i * 4 + 1] - result.initial[i * 4 + 1]) > 0.001), 'red cells actually updated');
  }, { wgslSources: declarations(code) });
});

test('production pressure dispatch converges closed/open-top and obstructed fields, then projects at the requested gain', async () => {
  await withKaminosGpu(async ctx => {
    for (const [open, obstacle, gain, masked] of [[false, false, 1, false], [true, false, 1, false],
      [false, false, 0, true], [true, false, 1, true], [false, true, 1, true], [true, true, 0.35, true]]) {
      const f = fixture(open, obstacle, masked);
      const metrics = checkSolve(await dispatch(ctx, f, { gain }), f, gain);
      console.log(`pressure-native-result: ${JSON.stringify(metrics)}`);
    }
  }, { wgslSources: declarations(code) });
});

test('numerical pressure oracle rejects valid RHS-sign and non-cubic-stride faults', async () => {
  const faults = [
    code.replace('(neighborPressure - div) / max(degree, 1.0)', '(neighborPressure + div) / max(degree, 1.0)'),
    code.replace('c.z * GRID * GRID_Y', 'c.z * GRID * GRID'),
  ];
  assert.ok(faults.every(text => text !== code), 'fault construction');
  await withKaminosGpu(async ctx => {
    const f = fixture(true, true);
    for (const text of faults) {
      const result = await dispatch(ctx, f, { text }); // Compile/setup errors fail the control.
      assert.throws(() => checkSolve(result, f), error => error.code === 'ERR_ASSERTION'
        && error.message.startsWith('pressure residual '));
    }
  }, { wgslSources: faults.flatMap(declarations) });
});
