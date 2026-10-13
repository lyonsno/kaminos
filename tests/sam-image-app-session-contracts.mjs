// kaminos-test: node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { withPngProvenance, readPngProvenance } from '../authoring-image-generation.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const saved = [], delivered = [];

const elements = new Map();
const context2d = { drawImage() {}, fillRect() {}, putImageData() {},
  getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
  createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }) };
const element = id => {
  if (!elements.has(id)) elements.set(id, { value: id === 'sam-image-prompt' ? 'wheel' : '',
    dataset: {}, style: {}, hidden: false, append() {}, replaceChildren() {}, focus() {},
    addEventListener() {}, getContext: () => context2d });
  return elements.get(id);
};
const foreground = { setImage() {}, evidence: () => ({ mode: 'contract-fixture' }), async yield() {},
  close() { foreground.closed = true; } };
const device = {};
const session = { device, close() { assert.fail('image tools must not close the application session'); } };
const applicationForeground = { device, queue: {}, beginRun() {} };
let options, runtimeCreations = 0, calls = 0, closed = false, closeFailure = null, maskOutput = false;
const source = readFileSync(new URL('../sam-image-tools.js', import.meta.url), 'utf8');
const createTools = vm.runInNewContext(`${source.replace(/^import[^\n]*\n/gm, '').replace('export function createSamImageTools', 'function createSamImageTools')}\ncreateSamImageTools;`, {
  document: { getElementById: element, querySelectorAll: () => [], createElement: () => ({
    getContext: () => context2d, toBlob: done => done(new Blob([png], { type: 'image/png' })), click() {},
  }) },
  window: { location: { href: 'http://localhost/' }, addEventListener() {}, removeEventListener() {} },
  crypto: webcrypto, URL, Blob, URLSearchParams, performance, console,
  Image: class { naturalWidth = 1; naturalHeight = 1; async decode() {} },
  Option: class { constructor(label, value) { this.label = label; this.value = value; } },
  fetch: async (url, request) => {
    if (request?.method === 'POST') {
      saved.push(new Uint8Array(await request.body.arrayBuffer()));
      const name = new URL(url, 'http://localhost').searchParams.get('name');
      return { ok: true, json: async () => ({ entry: { name, source: `/api/read?root=image-inbox&path=${name}` } }) };
    }
    return { ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])]) };
  },
  withPngProvenance,
  createSamWorkbenchForeground: async ({ device: requested }) => {
    assert.equal(requested, device);
    return foreground;
  },
  createSam3SourceMask() {
    assert.equal(maskOutput, true, 'empty fixture output must not manufacture a mask');
    return new Uint8Array([1]);
  },
  createSam3BrowserImageRuntime(input) {
    options = input; runtimeCreations += 1;
    return { async run(manifest, request) {
      calls += 1;
      assert.equal(manifest, '/sam3-packet/tensor-manifest.json');
      assert.equal(request.promptText, 'wheel');
      assert.equal(request.sourceImage.url, '/api/read?root=image-inbox&path=selected.png');
      return { ...request, outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
        width: 1, height: 1, effectiveRouteId: 'controlled-sam-route',
        promptSha256: 'sha256:controlled-prompt',
        instances: maskOutput ? [{ index: 7, score: 0.9, logits: new Float32Array([1]) }] : [],
        imageCache: { status: calls === 1 ? 'miss' : 'hit' } };
    }, evidence: () => ({ status: 'fixture' }), async close() {
      if (closeFailure) throw closeFailure;
      closed = true;
    } };
  },
});
const tools = createTools({ inferenceSession: session, rendererDevice: device,
  foregroundService: applicationForeground, config: { mounted: true, manifestUrl: '/sam3-packet/tensor-manifest.json' },
  onAsset: entry => delivered.push(entry) });
await tools.open('/api/read?root=image-inbox&path=selected.png', { name: 'selected.png' });
await tools.run();
assert.equal(options.inferenceSession, session);
assert.equal(options.foregroundService, applicationForeground, 'the real image tools must forward the app service to the SAM producer');
assert.equal(typeof options.yield, 'function', 'the source viewport must retain its input-driven yield');
await options.yield({ reason: 'fixture-boundary' });
await tools.run();
assert.equal(runtimeCreations, 1, 'warm prompt runs must retain their model runtime');
assert.equal(calls, 2);
maskOutput = true;
await tools.run();
for (const kind of ['mask', 'cutout']) {
  const entry = await tools.save(kind);
  const provenance = readPngProvenance(saved.at(-1));
  assert.ok(provenance, 'saved SAM PNG must carry its own source and invocation provenance');
  assert.equal(provenance.schema, 'kaminos.sam3-mask-export.v1');
  assert.equal(provenance.kind, kind);
  assert.equal(provenance.sourceImage, tools.progress().source.source);
  assert.equal(provenance.sourceImageSha256, tools.progress().source.sha256);
  assert.equal(provenance.invocationId, tools.output().invocationId);
  assert.equal(provenance.promptText, 'wheel');
  assert.equal(provenance.promptSha256, 'sha256:controlled-prompt');
  assert.equal(provenance.effectiveRouteId, 'controlled-sam-route');
  assert.equal(provenance.outputAuthority, 'actual-webgpu-readback');
  assert.equal(provenance.verificationState, 'not-attached');
  assert.deepEqual(provenance.indices, [7]);
  assert.deepEqual(provenance.sourceResolution, [1, 1]);
  assert.deepEqual(provenance.maskResolution, [1, 1]);
  assert.deepEqual(entry.maskProvenance, delivered.at(-1).maskProvenance);
  assert.deepEqual(JSON.parse(JSON.stringify(entry.maskProvenance)), provenance);
}
closeFailure = new Error('unsettled model queue');
try { await element('sam-image-unload').onclick(); } catch { /* Pre-fix callback rejection is not settlement. */ }
assert.ok(tools.evidence().runtime, 'a failed unload must retain the runtime handle and its resources');
assert.equal(element('sam-image-status').dataset.failed, 'true', 'failed unload must be visible');
assert.equal(tools.progress().busy, false);
await tools.run();
assert.equal(runtimeCreations, 1, 'Run after a failed unload must not replace the retained runtime');
closeFailure = null;
await element('sam-image-unload').onclick();
assert.equal(tools.evidence().runtime, null, 'only a successful unload retires the runtime');
assert.equal(closed, true);
assert.notEqual(foreground.closed, true, 'model unload must leave the image viewport alive');
await tools.close();
assert.equal(closed, true);
assert.equal(foreground.closed, true);
console.log('SAM image tools application-session forwarding contracts passed (controlled DOM/model dependencies)');
