// kaminos-test: node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import * as vm from 'node:vm';
import { createSam31MemoryAttentionPhaseProgramRouteDefinition } from '../src/sam31-memory-attention-phase-program.js';

if (!vm.SourceTextModule) {
  const child = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(import.meta.url)], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  console.log(child.stdout.trim());
} else {
  const values = length => new Float32Array(length);
  const frame = { propagationEmbedding: values(256), propagationPosition: values(256), interactiveEmbedding: values(256) };
  const result = (tag, debugReadback, outputs = [{ artifactId: `fixture:${tag}` }]) => ({
    receipt: { status: 'real', fallbackReason: null, requestedRouteId: 'fixture', effectiveRouteId: 'fixture', outputs }, debugReadback,
  });
  const conditioning = { maskLogits: values(16 * 196), objectScores: values(16), conditioning: values(16), pointers: values(16 * 256) };
  let observed = 0;
  let finish = false;
  let expectedSchedule;
  const scheduled = (input, phase) => assert.equal(input.schedule, expectedSchedule, `${phase} receives this frame admission`);
  const mocks = {
    'sam31-two-image-backbone.js': { createSam31SingleFrameBackbone: async () => ({
      run: async input => { scheduled(input, 'backbone'); return { frame, receipts: [], sourceImageSha256: 'sha256:fixture', timing: {} }; }, close() {},
    }) },
    'sam31-stream-inputs.js': { createSam31TrackingInputs: () => ({
      conditionImage: image => image, memoryInputs: () => conditioning, suppressMasks: masks => masks,
    }) },
    'sam31-browser-tracker-session-driver.js': {
      ...Object.fromEntries(['loadDecoderWeights', 'loadInteractivePointerWeights', 'loadMemoryWeights', 'loadAttentionWeights'].map(name => [name, async () => ({})])),
      maskConditioningInvocation: async input => { scheduled(input, 'conditioning'); return { result: result(input.invocationTag, conditioning) }; },
      interactivePointerInvocation: async input => { scheduled(input, 'pointer'); return { result: result(input.invocationTag, { objectPointers: conditioning.pointers }) }; },
      decoderInvocation: async input => { scheduled(input, 'decoder'); return { result: result(input.invocationTag,
        { selectedMasks: values(16 * 16), objectScores: values(16), objectPointers: conditioning.pointers }) }; },
    },
    'sam31-memory-encoder-phase-program.js': { runSam31MemoryEncoderPhaseProgramRoute: async input => {
      scheduled(input, 'memory encoder'); return result('unused', { memoryFeatures: values(256), memoryPositionEncoding: values(256) }, input.request.outputs); } },
    'sam31-temporal-memory-bank-phase-program.js': { runSam31TemporalMemoryBankPhaseProgramRoute: async input => {
      scheduled(input, 'temporal bank'); return result('unused', Object.fromEntries(['memory', 'memoryImage', 'memoryPosition', 'memoryImagePosition'].map(name => [name, values(17 * 256)])), input.request.outputs); } },
    'sam31-memory-attention-phase-program.js': { runSam31MemoryAttentionPhaseProgramRoute: async input => {
      scheduled(input, 'memory attention');
      assert.equal(input.captureIntermediateReadbacks, false);
      assert.equal(input.includeReadback, true, 'the decoder still requires final conditioned features');
      const expected = createSam31MemoryAttentionPhaseProgramRouteDefinition({ shape: input.tensors.shape, captureIntermediateReadbacks: false });
      assert.deepEqual(Array.from(input.route.requiredStages), Array.from(expected.requiredStages),
        'the stream route must describe the readbacks actually executed, not omitted diagnostics');
      assert.deepEqual(Array.from(input.route.requiredStages.filter(name => name.endsWith('readback'))), ['memory-attention-readback']);
      observed++;
      if (finish) return result('unused', { memory: values(256) }, input.request.outputs);
      throw new Error('attention-contract-observed');
    } },
  };
  const context = vm.createContext({ console, Float32Array, Uint8Array, TextEncoder, crypto: webcrypto, performance });
  const url = new URL('../src/sam31-stream-driver.js', import.meta.url);
  const module = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href });
  await module.link(async (specifier, parent) => {
    const dependency = new URL(specifier, parent.identifier);
    const namespace = { ...await import(dependency.href), ...mocks[dependency.pathname.split('/').at(-1)] };
    return new vm.SyntheticModule(Object.keys(namespace), function () {
      for (const [name, value] of Object.entries(namespace)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  const components = Object.fromEntries(['decoder', 'pointer', 'memory', 'temporal'].map(name => [name, { shape: {}, weights: [], staticTensors: [] }]));
  components.ingress = { shape: { imageWidth: 14, imageHeight: 14 }, reference: { model: { revision: 'cpu-fixture' } } };
  components.stream = { schema: 'kaminos.sam31-stream-model.v1', controls: {}, plan: {} };
  for (const memoryAttentionKernel of ['online', 'flash']) {
    const driver = await module.namespace.createSam31StreamDriver({
      packageRuntime: { modelPackage: { components }, loadFloat32: async () => values(1) },
      device: { queue: {} }, adapterInfo: {}, errors: [], memoryAttentionKernel,
    });
    const rgba = new Uint8Array(14 * 14 * 4);
    await driver.execute({ rgba, frameIndex: 0, conditioning: true, mask: new Uint8Array(196), objectSlot: 0 });
    await assert.rejects(driver.execute({ rgba, frameIndex: 1, conditioning: false, temporal: {
      plan: { memoryTokenCount: 17, spatialTokenCount: 1, objectPointerTokenCount: 16 }, spatialFrames: [], pointerFrames: [],
    } }), /attention-contract-observed/);
    driver.close();
  }
  assert.equal(observed, 2);
  finish = true;
  const driver = await module.namespace.createSam31StreamDriver({
    packageRuntime: { modelPackage: { components }, loadFloat32: async () => values(1) },
    device: { queue: {} }, adapterInfo: {}, errors: [],
  });
  const rgba = new Uint8Array(14 * 14 * 4);
  expectedSchedule = { invocation: { invocationId: 'scheduled:0' } };
  await driver.execute({ rgba, frameIndex: 0, conditioning: true, mask: new Uint8Array(196), objectSlot: 0, schedule: expectedSchedule });
  expectedSchedule = { invocation: { invocationId: 'scheduled:1' } };
  await driver.execute({ rgba, frameIndex: 1, conditioning: false, schedule: expectedSchedule, temporal: {
    plan: { memoryTokenCount: 17, spatialTokenCount: 1, objectPointerTokenCount: 16 }, spatialFrames: [], pointerFrames: [],
  } });
  driver.close();
  console.log('Sequential SAM caller binds serving readbacks to route requirements (simulated phase execution)');
}
