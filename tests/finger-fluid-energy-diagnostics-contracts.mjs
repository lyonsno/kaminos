import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as fluid from '../finger-fluid-webgpu-core.js';
import * as cockpit from '../finger-fluid-oracle-cockpit.js';
import { createWebGPUFingerFluidSolver } from '../finger-fluid-webgpu-core.js';

// CPU command-encoding witness only. This spy does not execute WGSL or claim
// numerical/GPU parity. The real factory, step, and readback paths run unchanged.
async function solverSpy(options = {}) {
  const dispatches = [], copies = [], maps = [], writes = [];
  const gpuFlags = new Proxy({}, { get: () => 1 });
  const previous = new Map(['GPUBufferUsage', 'GPUShaderStage', 'GPUTextureUsage',
    'GPUMapMode', 'navigator', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const set = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, value });
  for (const key of ['GPUBufferUsage', 'GPUShaderStage', 'GPUTextureUsage', 'GPUMapMode']) set(key, gpuFlags);
  set('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
  set('fetch', async url => {
    const data = await readFile(new URL(`../${url}`, import.meta.url));
    return { ok: true, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  });
  const restore = () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
  const device = {
    limits: { maxStorageBuffersPerShaderStage: 10, maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728 },
    lost: new Promise(() => {}),
    createBuffer: ({ label, size }) => ({
      label, size, mapState: 'unmapped', destroy() {},
      async mapAsync() { maps.push(label); throw new Error('intentional readback rejection'); },
    }),
    createShaderModule: descriptor => descriptor,
    createBindGroupLayout: descriptor => descriptor,
    createPipelineLayout: descriptor => descriptor,
    createBindGroup: descriptor => descriptor,
    createComputePipelineAsync: async descriptor => descriptor,
    createRenderPipelineAsync: async descriptor => ({ ...descriptor, getBindGroupLayout: () => ({}) }),
    createSampler: () => ({}),
    createTexture: () => ({ createView: () => ({}), destroy() {} }),
    createCommandEncoder: () => ({
      beginComputePass: () => {
        let pipeline;
        return {
          setPipeline(value) { pipeline = value; },
          setBindGroup() {},
          dispatchWorkgroups(...groups) { dispatches.push({ entry: pipeline.compute.entryPoint, groups }); },
          end() {},
        };
      },
      copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) { copies.push({ source: source.label, target: target.label, size }); },
      finish: () => ({}),
    }),
    queue: {
      writeBuffer(buffer, offset, data) {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
        writes.push({ buffer: buffer.label, offset, bytes: [...bytes] });
      },
      writeTexture() {}, submit() {},
    },
  };
  try {
    const solver = await createWebGPUFingerFluidSolver({
      canvas: { getContext: () => ({ configure() {} }) },
      webgpuDevice: device, particleCount: 1024, ...options,
    });
    assert.equal(solver.available, true, JSON.stringify(solver));
    writes.length = 0;
    return { solver, dispatches, copies, maps, writes, close() { solver.destroy(); restore(); } };
  } catch (error) { restore(); throw error; }
}

const isEnergy = entry => /^measure_(projection|viscosity|vorticity|cohesion)_energy$/.test(entry);

function simulationWrites(run) {
  return run.writes.map(write => {
    assert.equal(write.buffer, 'kaminos-finger-fluid-params');
    const bytes = [...write.bytes];
    const view = new DataView(Uint8Array.from(bytes).buffer);
    assert.equal(view.getUint32(144, true), run.solver.getLiquidFireContactDescriptor().allocationGeneration);
    // Different instances intentionally get distinct contact-buffer identities.
    bytes.fill(0, 144, 148);
    return { ...write, bytes };
  });
}

test('disabled removes only energy commands at each density count and substep', async () => {
  for (const densityIterations of [1, 3]) {
    let defaultCommands, defaultWrites;
    const baseline = await solverSpy({ densityIterations, substeps: 2 });
    try {
      baseline.solver.step(1 / 60);
      defaultCommands = baseline.dispatches;
      defaultWrites = simulationWrites(baseline);
      assert.equal(defaultCommands.filter(x => isEnergy(x.entry)).length, 8);
    } finally { baseline.close(); }
    const disabled = await solverSpy({ densityIterations, substeps: 2, energyDiagnosticsMode: 'disabled' });
    try {
      disabled.solver.step(1 / 60);
      assert.equal(disabled.dispatches.filter(x => isEnergy(x.entry)).length, 0, 'disabled mode must omit all four energy stages per substep');
      assert.deepEqual(disabled.dispatches, defaultCommands.filter(x => !isEnergy(x.entry)));
      assert.deepEqual(simulationWrites(disabled), defaultWrites, 'simulation uniforms remain identical apart from per-instance contact allocation identity');
      const state = disabled.solver.getDebugState();
      assert.equal(state.energyDiagnostics.effectiveMode, 'disabled');
      assert.equal(state.energyDiagnostics.passCount, 0);
      assert.equal(state.energyDiagnostics.measuredStep, null);
      assert.equal(state.energyLedger, null);
    } finally { disabled.close(); }
  }
});

test('disabled readback never copies or maps energy; other diagnostics still fail visibly', async () => {
  const run = await solverSpy({ energyDiagnosticsMode: 'disabled' });
  try {
    run.solver.step();
    await assert.rejects(run.solver.requestDiagnostics(), /intentional readback rejection/);
    assert.ok(run.copies.some(x => x.source === 'kaminos-finger-fluid-particles'));
    assert.equal(run.copies.filter(x => /energy-diagnostics/.test(x.source)).length, 0);
    assert.equal(run.maps.filter(x => /energy-diagnostics/.test(x)).length, 0);
    assert.equal(run.solver.getDebugState().energyLedger, null);
  } finally { run.close(); }
});

test('default measurements retain staged commands and identify unavailable readback', async () => {
  const run = await solverSpy();
  try {
    assert.equal(run.solver.getDebugState().energyDiagnostics.measuredStep, null);
    run.solver.step();
    const state = run.solver.getDebugState();
    assert.equal(state.energyDiagnostics.effectiveMode, 'every_step');
    assert.equal(state.energyDiagnostics.passCount, 4);
    assert.equal(state.energyDiagnostics.measuredStep, 1);
    assert.equal(state.energyDiagnostics.readbackStep, null);
    await assert.rejects(run.solver.requestDiagnostics(), /intentional readback rejection/);
    assert.equal(run.copies.filter(x => /energy-diagnostics/.test(x.source)).length, 1);
    assert.equal(run.maps.filter(x => /energy-diagnostics/.test(x)).length, 1);
  } finally { run.close(); }
});

test('unknown energy mode rejects before creating a GPU or silently substituting defaults', async () => {
  for (const energyDiagnosticsMode of ['disable', '', null, false, 0]) {
    await assert.rejects(createWebGPUFingerFluidSolver({ energyDiagnosticsMode }), /energy diagnostics mode/);
  }
});

test('bench URL selects the requested diagnostics mode and rejects misspellings', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  function sourceFunction(name) {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0);
    const end = html.indexOf('\n}', start);
    assert.ok(end > start);
    return html.slice(start, end + 2);
  }
  const configFromRoute = runInNewContext(
    `${sourceFunction('resolveFingerFluidAnalyticCarrierMode')}\n${sourceFunction('fingerFluidBenchConfigFromRoute')}\nfingerFluidBenchConfigFromRoute`,
    { ...fluid, ...cockpit, URLSearchParams },
  );
  for (const mode of ['every_step', 'disabled']) {
    const config = configFromRoute(new URLSearchParams({ finger_fluid_energy_diagnostics: mode }));
    assert.equal(config.requestedEnergyDiagnosticsMode, mode);
    assert.equal(config.effectiveEnergyDiagnosticsMode, mode);
  }
  assert.equal(configFromRoute(new URLSearchParams()).effectiveEnergyDiagnosticsMode, 'every_step');
  assert.throws(() => configFromRoute(new URLSearchParams('finger_fluid_energy_diagnostics=')), /energy diagnostics mode/);
  assert.throws(() => configFromRoute(new URLSearchParams('finger_fluid_energy_diagnostics=disable')), /energy diagnostics mode/);
});
