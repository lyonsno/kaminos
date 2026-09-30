import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const exampleUrl = new URL('../examples/sam-image.mjs', import.meta.url);
assert.ok(existsSync(exampleUrl), 'missing usable SAM image+text example (not a GPU or import failure)');
const { createSamImageExample, createSamImagePixels, sha256Bytes } = await import(exampleUrl);
assert.equal(await sha256Bytes(new TextEncoder().encode('abc'), webcrypto),
  'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

const source = { width: 3, height: 1, pixels: new Uint8ClampedArray([
  10, 20, 30, 128, 40, 50, 60, 255, 70, 80, 90, 64,
]), sha256: `sha256:${'a'.repeat(64)}`, artifactId: 'image:fixture', url: 'blob:http://localhost/fixture' };
const promptDigest = await sha256Bytes(new TextEncoder().encode('wheel'), webcrypto);
const maskOutput = {
  width: 2, height: 1, instances: [
    { index: 7, score: 0.9, box: [0, 0, 1, 1], logits: new Float32Array([1, -1]) },
    { index: 9, score: 0.8, box: [0, 0, 1, 1], logits: new Float32Array([-1, 1]) },
  ],
};
assert.deepEqual([...createSamImagePixels(source, maskOutput, [7], 'mask')],
  [255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
assert.deepEqual([...createSamImagePixels(source, maskOutput, [7], 'cutout')],
  [10, 20, 30, 128, 40, 50, 60, 0, 70, 80, 90, 0]);
assert.equal(createSamImagePixels(source, maskOutput, [7, 9], 'cutout')[11], 64);
assert.deepEqual([...createSamImagePixels(source, { ...maskOutput, instances: [] }, [], 'mask')],
  [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
assert.throws(() => createSamImagePixels(source, maskOutput, [99], 'cutout'), /unknown instance/);
assert.throws(() => createSamImagePixels(source, maskOutput, [7], 'fake'), /view/);

// Local orchestration fixtures do not establish GPU execution.
const calls = [], states = [];
let complete, rejectRun, failDecode = false;
let activeRequest, activeManifest, runtimeOptions, runtimeCount = 0, foreground;
const device = { lost: new Promise(() => {}), destroy() { calls.push('device.destroy'); } };
const session = { device, async drain() { calls.push('session.drain'); }, close() { calls.push('session.close'); } };
const services = {
  requestDevice: async () => ({ device, adapter: {}, backendIdentity: { kind: 'test-only' } }),
  createSession: async options => { assert.equal(options.device, device); return session; },
  decodeSource: async () => {
    if (failDecode) throw new Error('invalid image bytes');
    return { ...source, release() { calls.push('source.release'); } };
  },
  createForeground: async options => {
    assert.equal(options.device, device);
    foreground = { setSource() {}, yield: async () => {}, evidence: () => ({ submissions: 0 }),
      close() { calls.push('foreground.close'); } };
    return foreground;
  },
  createRuntime: options => {
    runtimeCount += 1; runtimeOptions = options;
    assert.equal(options.inferenceSession, session);
    return {
      run(manifest, request) {
        activeManifest = manifest; activeRequest = request;
        return new Promise((resolve, reject) => { complete = resolve; rejectRun = reject; });
      },
      evidence: () => ({ backendIdentity: { kind: 'test-only' }, packageInvocationEvidence: { fixture: true } }),
      async close() { calls.push('sam.close'); },
    };
  },
};
const example = await createSamImageExample({ canvas: {}, baseUrl: 'http://localhost/examples/sam-image.html',
  onState: state => states.push(state), services });
assert.equal(example.snapshot().status, 'idle');
await assert.rejects(example.run({ manifestUrl: '/model.json', promptText: 'wheel' }), /source image/);
await example.loadImage({});
assert.equal(runtimeCount, 0, 'model remains unloaded until run');
const run = example.run({ manifestUrl: '/model.json', promptText: ' wheel ' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(activeManifest, 'http://localhost/model.json');
assert.equal(activeRequest.promptText, 'wheel');
assert.equal(activeRequest.verificationMode, 'execution-only');
assert.equal(Object.hasOwn(activeRequest, 'signal'), false);
assert.deepEqual(activeRequest.sourceImage.encodedResolution, [3, 1]);
assert.equal(activeRequest.sourceImage.sha256, source.sha256);
assert.equal(runtimeOptions.yield, foreground.yield);
await assert.rejects(example.run({ manifestUrl: '/model.json', promptText: 'other' }), /busy/);
await assert.rejects(example.loadImage({}), /busy/);
const output = () => ({ ...maskOutput, invocationId: activeRequest.invocationId, promptText: 'wheel',
  promptSha256: promptDigest, sourceImage: { sha256: source.sha256, artifactId: source.artifactId,
    encodedResolution: [3, 1] }, outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
  requestedRouteId: 'fixture.requested', effectiveRouteId: 'fixture.effective' });
complete(output());
await run;
assert.equal(example.snapshot().status, 'succeeded');
assert.deepEqual(example.snapshot().selectedIndices, [7, 9]);
example.select([7]);
assert.equal(example.pixels('cutout')[3], 128);
assert.equal(example.provenance().output.effectiveRouteId, 'fixture.effective');
assert.equal(example.provenance().foreground.authority, 'queue-submissions-not-presented-frames');
assert.equal(example.provenance().foreground.coexistence, 'unverified');
const stale = example.run({ manifestUrl: '/model.json', promptText: 'wheel' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(example.snapshot().output, null, 'previous masks disappear at invocation start');
complete({ ...output(), invocationId: 'old' });
await assert.rejects(stale, /invocation/);
assert.throws(() => example.pixels('mask'), /output/);
const fallback = example.run({ manifestUrl: '/model.json', promptText: 'wheel' });
await new Promise(resolve => setImmediate(resolve));
complete({ ...output(), outputAuthority: 'cached-default-mask' });
await assert.rejects(fallback, /authority/);
for (const [mutation, reason] of [
  [{ promptSha256: `sha256:${'b'.repeat(64)}` }, /prompt/],
  [{ sourceImage: { ...output().sourceImage, encodedResolution: [1, 3] } }, /source/],
  [{ width: 0, instances: [] }, /dimensions/],
  [{ instances: [maskOutput.instances[0], maskOutput.instances[0]] }, /duplicate/],
  [{ instances: [{ ...maskOutput.instances[0], logits: null }] }, /logits/],
]) {
  const invalid = example.run({ manifestUrl: '/model.json', promptText: 'wheel' });
  await new Promise(resolve => setImmediate(resolve));
  complete({ ...output(), ...mutation });
  await assert.rejects(invalid, reason);
  assert.equal(example.snapshot().output, null);
}
const failed = example.run({ manifestUrl: '/model.json', promptText: 'wheel' });
await new Promise(resolve => setImmediate(resolve));
rejectRun(new Error('model fetch failed'));
await assert.rejects(failed, /model fetch failed/);
assert.equal(example.snapshot().error, 'model fetch failed');
await assert.rejects(example.run({ manifestUrl: 'http://elsewhere/model.json', promptText: 'wheel' }), /same-origin/);
await assert.rejects(example.run({ manifestUrl: '/different.json', promptText: 'wheel' }), /unload/);
await example.unloadModel();
assert.equal(calls.includes('device.destroy'), false, 'unload retains session/device and source animation');
failDecode = true;
await assert.rejects(example.loadImage({}), /invalid image bytes/);
assert.equal(example.snapshot().source, null);
failDecode = false;
await example.loadImage({});
const lastRun = example.run({ manifestUrl: '/model.json', promptText: 'wheel' });
await new Promise(resolve => setImmediate(resolve));
const disposal = example.dispose();
assert.equal(example.snapshot().status, 'closing');
assert.equal(calls.includes('device.destroy'), false, 'dispose waits; it does not invent inference cancellation');
complete({ ...output(), instances: [] });
await lastRun;
await disposal;
assert.equal(example.snapshot().status, 'closed');
assert.ok(calls.indexOf('foreground.close') < calls.indexOf('device.destroy'));
assert.equal(calls.filter(call => call === 'device.destroy').length, 1);
await example.dispose();
await assert.rejects(example.loadImage({}), /closed/);
assert.ok(states.some(state => state.status === 'running'));

// Exercise the real example-local renderer and kit yield with an inert GPU fixture.
// Shader validity and presentation are deliberately outside this contract.
const globals = ['requestAnimationFrame', 'cancelAnimationFrame', 'GPUBufferUsage', 'GPUTextureUsage'];
const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const callbacks = new Map(), events = [], times = [];
const gpuListeners = new Map();
let callbackId = 0, sharedOptions, loseDevice;
const texture = () => ({ createView: () => ({}), destroy() { events.push('texture.destroy'); } });
const sharedDevice = {
  addEventListener(name, callback) { gpuListeners.set(name, callback); },
  removeEventListener(name, callback) { if (gpuListeners.get(name) === callback) gpuListeners.delete(name); },
  lost: new Promise(resolve => { loseDevice = resolve; }),
  createSampler: () => ({}), createShaderModule: () => ({}),
  createRenderPipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
  createBuffer: () => ({ destroy() { events.push('uniform.destroy'); } }),
  createTexture: texture, createBindGroup: () => ({}),
  createCommandEncoder: () => ({
    beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }), finish: () => ({}),
  }),
  queue: {
    copyExternalImageToTexture() {},
    writeBuffer(_buffer, _offset, data) { times.push(data[0]); },
    submit() { events.push('submit'); },
    async onSubmittedWorkDone() { events.push('queue.done'); },
  },
  destroy() { events.push('device.destroy'); },
};
const surface = { configure(options) { assert.equal(options.device, sharedDevice); },
  getCurrentTexture: texture, unconfigure() { events.push('surface.unconfigure'); } };
try {
  globalThis.requestAnimationFrame = callback => { const id = ++callbackId; callbacks.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => callbacks.delete(id);
  globalThis.GPUBufferUsage = { UNIFORM: 64, COPY_DST: 8 };
  globalThis.GPUTextureUsage = { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
  const shared = await createSamImageExample({ baseUrl: 'http://localhost/',
    canvas: { clientWidth: 320, clientHeight: 240, getContext: () => surface },
    gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' }, services: {
      requestDevice: async () => ({ device: sharedDevice, adapter: {}, backendIdentity: { kind: 'fixture' } }),
      createSession: async options => ({ device: options.device, async drain() {}, close() {} }),
      decodeSource: async () => ({ ...source, image: {}, release() {} }),
      createRuntime: options => { sharedOptions = options; return {
        async run(_manifest, request) {
          await options.yield({ phase: 'fixture-boundary' });
          return { ...maskOutput, invocationId: request.invocationId, promptText: request.promptText,
            promptSha256: promptDigest, sourceImage: request.sourceImage,
            outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
            requestedRouteId: 'fixture', effectiveRouteId: 'fixture' };
        }, evidence: () => ({ fixture: true }), async close() {},
      }; },
    } });
  await shared.loadImage({});
  const tick = time => { const [id, callback] = callbacks.entries().next().value; callbacks.delete(id); callback(time); };
  tick(1000); tick(2000);
  assert.deepEqual(times.slice(0, 2), [1, 2], 'source motion receives continuously changing time');
  assert.equal(callbacks.size, 1, 'one owned animation callback remains scheduled');
  await shared.run({ manifestUrl: '/model.json', promptText: 'wheel' });
  assert.equal(sharedOptions.inferenceSession.device, sharedDevice);
  assert.ok(events.indexOf('queue.done') < events.lastIndexOf('submit'), 'kit yield drains prior work before a source submission');
  assert.equal(shared.snapshot().foreground.yields, 1);
  assert.equal(shared.snapshot().foreground.submissions, 3);
  assert.equal(typeof gpuListeners.get('uncapturederror'), 'function', 'asynchronous GPU errors must be visible');
  gpuListeners.get('uncapturederror')({ error: { message: 'fixture validation failure' } });
  assert.equal(shared.snapshot().status, 'failed');
  assert.equal(shared.snapshot().output, null);
  assert.match(shared.snapshot().error, /fixture validation failure/);
  loseDevice({ reason: 'unknown', message: 'fixture loss' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(shared.snapshot().status, 'failed');
  assert.equal(shared.snapshot().output, null, 'device loss invalidates displayed output');
  await assert.rejects(shared.run({ manifestUrl: '/model.json', promptText: 'wheel' }), /device lost/);
  await shared.dispose();
  assert.equal(callbacks.size, 0);
  assert.equal(gpuListeners.size, 0, 'dispose removes the exact owned error listener');
  assert.ok(events.indexOf('surface.unconfigure') < events.indexOf('device.destroy'));
} finally {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
}
// A terminal GPU notification may arrive during the asynchronous digest admission.
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
try {
  for (const failureKind of ['uncapturederror', 'device-loss']) {
    let listener, lose;
    const faultyDevice = { lost: new Promise(resolve => { lose = resolve; }),
      addEventListener(_name, callback) { listener = callback; }, removeEventListener() {}, destroy() {} };
    const admission = await createSamImageExample({ canvas: {}, baseUrl: 'http://localhost/', services: {
      requestDevice: async () => ({ device: faultyDevice, adapter: {}, backendIdentity: { kind: 'fixture' } }),
      createSession: async () => ({ async drain() {}, close() {} }),
      decodeSource: async () => ({ ...source, release() {} }),
      createForeground: async () => ({ setSource() {}, yield: async () => {}, evidence: () => ({}), close() {} }),
      createRuntime: () => ({ async run(_manifest, request) { return { ...maskOutput,
        invocationId: request.invocationId, promptText: request.promptText, promptSha256: promptDigest,
        sourceImage: request.sourceImage, outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
        requestedRouteId: 'fixture', effectiveRouteId: 'fixture' }; }, evidence: () => ({}), async close() {} }),
    } });
    await admission.loadImage({});
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      randomUUID: () => webcrypto.randomUUID(), subtle: { async digest(...args) {
        const digest = await webcrypto.subtle.digest(...args);
        if (failureKind === 'uncapturederror') listener({ error: { message: 'failure during digest' } });
        else lose({ reason: 'unknown', message: 'failure during digest' });
        await Promise.resolve();
        return digest;
      } },
    } });
    await assert.rejects(admission.run({ manifestUrl: '/model.json', promptText: 'wheel' }), /failure during digest/);
    assert.equal(admission.snapshot().status, 'failed');
    assert.equal(admission.snapshot().output, null);
    assert.equal(admission.provenance().output, null, 'terminal failure cannot export successful provenance');
    assert.throws(() => admission.pixels('cutout'), /no current output/);
    await admission.dispose();
  }
} finally {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else delete globalThis.crypto;
}
console.log('SAM image example deterministic contracts passed (no GPU witness)');
