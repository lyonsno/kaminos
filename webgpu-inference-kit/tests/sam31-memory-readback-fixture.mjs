// kaminos-test: node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as vm from 'node:vm';

// Execute the production phase builder; only GPU execution and receipt transport
// are simulated. These assertions establish readback selection, not GPU numerics.
const shape = { batch: 1, queryHeight: 2, queryWidth: 2, queryTokens: 4, memorySpatialTokens: 4, numObjPtrTokens: 2, memoryTokens: 6, channels: 256, heads: 8, headDim: 32, mlpHidden: 2048, layerCount: 4 };
const zeros = size => new Float32Array(size);
const norm = () => ({ weight: new Float32Array(256).fill(1), bias: zeros(256) });
const projection = (input = 256, output = 256) => ({ weight: zeros(input * output), bias: zeros(output) });
const layer = () => ({
  ...Object.fromEntries(['norm1', 'norm2', 'norm3'].map(name => [name, norm()])),
  ...Object.fromEntries(['selfQ', 'selfK', 'selfV', 'selfOut', 'crossQ', 'crossK', 'crossV', 'crossOut', 'imageCrossQ', 'imageCrossK'].map(name => [name, projection()])),
  linear1: projection(256, 2048), linear2: projection(2048, 256),
});
const tensors = { shape, current: { image: zeros(1024), src: zeros(1024), srcPos: zeros(1024) }, bank: { memoryImage: zeros(1024), memory: zeros(1536), memoryImagePos: zeros(1024), memoryPos: zeros(1536) }, layers: Array.from({ length: 4 }, layer), finalNorm: norm() };
let programs = [];
let runtimeOptions = [];
let disposals = 0;
const runtime = {
  backendIdentity: {}, kernel: { profile: 'sam31-memory-readback-cpu-fixture' }, profile: {},
  createUniformBuffer: spec => spec,
  async runStage(name, run) {
    await run({ createTensor: spec => spec, uploadTensor() {}, createUniformBuffer: spec => spec, async yieldToBrowser() {} });
  },
  defineProgram(spec) { programs.push(spec); return spec; },
  async runProgram(spec) {
    return { outputs: Object.fromEntries(spec.phases.flatMap(phase => (phase.readbacks ?? []).map(readback => {
      const length = spec.tensors[readback.tensor].shape.reduce((a, b) => a * b, 1);
      return [readback.name, Float32Array.from({ length }, (_, index) => index / 1024).buffer];
    }))) };
  },
  dispose() { disposals += 1; return { status: 'disposed' }; },
};
const mocks = {
  'inference-runtime.js': { createWebGpuInferenceRuntime: async options => { runtimeOptions.push(options); return runtime; } },
  'route-boundary.js': { createRouteWorkerResult: (route, result) => result, assertAuthoritativeRouteWorkerResult: result => result },
  'route-receipt-helper.js': { createWebGpuRouteReceiptFromArtifacts: value => value, createRouteReceiptInputArtifact: (role, value) => ({ role, ...value }), createRouteReceiptArtifacts: ({ artifacts }) => artifacts },
};
const context = vm.createContext({ console, Float32Array, Uint8Array, crypto: webcrypto });
const url = new URL('../src/sam31-memory-attention-phase-program.js', import.meta.url);
const module = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href });
await module.link(async (specifier, parent) => {
  const dependency = new URL(specifier, parent.identifier);
  const namespace = { ...await import(dependency.href), ...mocks[dependency.pathname.split('/').at(-1)] };
  return new vm.SyntheticModule(Object.keys(namespace), function () {
    for (const [name, value] of Object.entries(namespace)) this.setExport(name, value);
  }, { context });
});
await module.evaluate();
const { createSam31MemoryAttentionPhaseProgramRouteDefinition: defineRoute, runSam31MemoryAttentionPhaseProgramRoute: run } = module.namespace;
const roles = ['source-image', 'sam31-memory-attention-current-tensors', 'sam31-memory-attention-bank-tensors', 'sam31-memory-attention-weights'];
const request = { inputs: roles.map(role => ({ role, artifactId: role, sha256: 'sha256:local-fixture' })), outputs: [{ role: 'sam31-memory-conditioned-features', artifactId: 'conditioned' }] };
const expectedFinal = Array.from({ length: 1024 }, (_, index) => index / 1024);
const failures = [];
const servingPrograms = new Map();
for (const attentionKernel of ['online', 'flash']) {
  for (const captureIntermediateReadbacks of [false, true, undefined]) {
    const label = `${attentionKernel}/${captureIntermediateReadbacks}`;
    try {
      const options = { shape, captureIntermediateReadbacks };
      const result = await run({ request, tensors, device: { limits: {} }, attentionKernel, captureIntermediateReadbacks, includeReadback: true });
      const program = programs.at(-1);
      const readbacks = Array.from(program.phases.flatMap(phase => (phase.readbacks ?? []).map(row => row.name)));
      assert.deepEqual(Array.from(result.debugReadback.memory), expectedFinal);
      assert.deepEqual(Array.from(runtimeOptions.at(-1).requiredStages), Array.from(defineRoute(options).requiredStages));
      if (captureIntermediateReadbacks === false) {
        servingPrograms.set(attentionKernel, program);
        assert.deepEqual(readbacks, ['memory'], 'serving must transfer only the final decoder input');
        assert.deepEqual(Object.keys(result.debugReadback), ['mode', 'memory']);
        assert.deepEqual(Array.from(defineRoute(options).requiredStages.filter(name => name.endsWith('readback'))), ['memory-attention-readback']);
      } else {
        const servingProgram = servingPrograms.get(attentionKernel);
        const computingPhases = program.phases.filter(phase => !phase.readbacks);
        assert.deepEqual(Array.from(servingProgram.phases.filter(phase => !phase.readbacks)), Array.from(computingPhases), 'omitting diagnostics must preserve every compute dispatch and yield boundary');
        assert.deepEqual(servingProgram.kernels, program.kernels, 'shader source and bindings must remain unchanged');
        assert.equal(readbacks.length, 29, 'diagnostic and legacy calls preserve all 28 intermediate tensors');
        assert.equal(result.debugReadback.layerOutputs.length, 4);
        assert.equal(result.debugReadback.stageOutputs.length, 4);
        assert.equal(Object.keys(result.debugReadback.stageOutputs[0]).length, 7);
      }
      assert.equal(program.metadata.captureIntermediateReadbacks, captureIntermediateReadbacks !== false);
    } catch (error) { failures.push(error); console.error(`${label}: ${error.message}`); }
  }
}
for (const value of [null, 0, 'false']) {
  try {
    assert.throws(() => defineRoute({ captureIntermediateReadbacks: value }), /captureIntermediateReadbacks.*boolean/);
    const before = runtimeOptions.length;
    await assert.rejects(() => run({ captureIntermediateReadbacks: value }), /captureIntermediateReadbacks.*boolean/);
    assert.equal(runtimeOptions.length, before);
  } catch (error) { failures.push(error); console.error(`invalid option ${value}: ${error.message}`); }
}
assert.equal(disposals, 6);
if (failures.length) throw new AggregateError(failures, 'memory readback selection regressions');
console.log('SAM memory serving/diagnostic readback plans passed (simulated execution)');
