// kaminos-test: node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const entry = new URL('../src/sam3-segmenter.js', import.meta.url);
assert.ok(existsSync(entry), 'SAM needs a canvas-free consumer entrypoint');
const { createSam3Segmenter } = await import(entry);
const blob = new Blob(['image fixture']);
const calls = [];
let request, finish;
let arrived = Promise.withResolvers();
const sam = createSam3Segmenter({ manifestUrl: '/models/sam/tensor-manifest.json', baseUrl: 'https://app.test/',
  crypto: webcrypto, services: {
    async decodeImage(url) { calls.push(url); return { width: 3, height: 1 }; },
    createObjectURL() { return 'blob:https://app.test/image'; },
    revokeObjectURL(url) { calls.push(`release:${url}`); },
    createRuntime(options) {
      assert.equal(options.inferenceSession, undefined);
      return { run(url, input) {
        assert.equal(url, 'https://app.test/models/sam/tensor-manifest.json');
        request = input;
        return new Promise(resolve => { finish = resolve; arrived.resolve(); });
      }, async close() { calls.push('close'); } };
    },
  } });
await assert.rejects(sam.segment(blob, ' '), /prompt/);
await assert.rejects(sam.segment('image.jpg', 'wheel'), /Blob/);
const pending = sam.segment(blob, ' wheel ');
await arrived.promise;
await assert.rejects(sam.segment(blob, 'wheel'), /in flight/);
const output = () => ({ width: 2, height: 1, instances: [{ index: 8, score: 0.9, box: [0, 0, 1, 1],
  logits: new Float32Array([1, -1]) }], invocationId: request.invocationId, promptText: 'wheel',
  promptSha256: request.promptSha256, sourceImage: request.sourceImage,
  outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
  requestedRouteId: 'sam.fixture', effectiveRouteId: 'sam.fixture' });
finish(output());
const result = await pending;
assert.deepEqual([...result.mask()], [1, 0, 0]);
assert.deepEqual(result.sourceSize, { width: 3, height: 1 });
assert.equal(result.instances[0].index, 8);
assert.equal(request.verificationMode, 'execution-only');
assert.equal(request.promptText, 'wheel');
assert.equal(calls.filter(call => call.startsWith('release:')).length, 1);
arrived = Promise.withResolvers();
const stale = sam.segment(blob, 'wheel');
await arrived.promise;
finish({ ...output(), invocationId: 'stale' });
await assert.rejects(stale, /invocation/);
for (const [mutation, error] of [
  [{ outputAuthority: 'cached-demo' }, /authority/],
  [{ effectiveRouteId: 'fallback' }, /route/],
  [{ promptSha256: 'wrong' }, /prompt/],
  [{ sourceImage: { sha256: 'wrong' } }, /image/],
  [{ instances: [{ index: 0, score: NaN, box: [0, 0, 1, 1], logits: new Float32Array([1, -1]) }] }, /score/],
]) {
  arrived = Promise.withResolvers();
  const invalid = sam.segment(blob, 'wheel');
  await arrived.promise;
  finish({ ...output(), ...mutation });
  await assert.rejects(invalid, error);
}
arrived = Promise.withResolvers();
const empty = sam.segment(blob, 'wheel');
await arrived.promise;
const closing = sam.close();
assert.equal(calls.includes('close'), false, 'close waits for active inference');
finish({ ...output(), instances: [] });
assert.deepEqual([...(await empty).mask()], [0, 0, 0]);
await closing;
await sam.close();
assert.equal(calls.filter(call => call === 'close').length, 1);
await assert.rejects(sam.segment(blob, 'wheel'), /closed/);
let borrowedOptions;
const borrowed = { device: { destroy() { throw new Error('borrowed device destroyed'); } },
  close() { throw new Error('borrowed session closed'); } };
const service = async () => {};
const composed = createSam3Segmenter({ manifestUrl: '/model.json', baseUrl: 'https://app.test/',
  inferenceSession: borrowed, yield: service, crypto: webcrypto, services: {
    decodeImage: async () => ({ width: 3, height: 1 }),
    createObjectURL: () => 'blob:https://app.test/input', revokeObjectURL() {},
    createRuntime(options) { borrowedOptions = options; return {
      async run(_url, input) { return { ...output(), instances: [], invocationId: input.invocationId,
        promptSha256: input.promptSha256, sourceImage: input.sourceImage }; }, async close() {} }; },
  } });
await composed.segment(blob, 'wheel');
assert.equal(borrowedOptions.inferenceSession, borrowed);
assert.equal(borrowedOptions.yield, service);
await composed.close();
console.log('SAM segmenter contracts passed (orchestration fixture, not GPU evidence)');
