// kaminos-test: node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const elements = new Map();
const context2d = { drawImage() {}, fillRect() {}, putImageData() {},
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
let options, runtimeCreations = 0, calls = 0, closed = false;
const source = readFileSync(new URL('../sam-image-tools.js', import.meta.url), 'utf8');
const createTools = vm.runInNewContext(`${source.replace(/^import[^\n]*\n/gm, '').replace('export function createSamImageTools', 'function createSamImageTools')}\ncreateSamImageTools;`, {
  document: { getElementById: element, querySelectorAll: () => [], createElement: () => ({ getContext: () => context2d }) },
  window: { location: { href: 'http://localhost/' }, addEventListener() {}, removeEventListener() {} },
  crypto: webcrypto, URL, Blob, URLSearchParams, performance, console,
  Image: class { naturalWidth = 2; naturalHeight = 1; async decode() {} },
  Option: class { constructor(label, value) { this.label = label; this.value = value; } },
  fetch: async () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])]) }),
  createSamWorkbenchForeground: async ({ device: requested }) => {
    assert.equal(requested, device);
    return foreground;
  },
  createSam3SourceMask() { assert.fail('empty fixture output must not manufacture a mask'); },
  createSam3BrowserImageRuntime(input) {
    options = input; runtimeCreations += 1;
    return { async run(manifest, request) {
      calls += 1;
      assert.equal(manifest, '/sam3-packet/tensor-manifest.json');
      assert.equal(request.promptText, 'wheel');
      assert.equal(request.sourceImage.url, '/api/read?root=image-inbox&path=selected.png');
      return { ...request, outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
        instances: [], imageCache: { status: calls === 1 ? 'miss' : 'hit' } };
    }, evidence: () => ({ status: 'fixture' }), async close() { closed = true; } };
  },
});
const tools = createTools({ inferenceSession: session, rendererDevice: device,
  foregroundService: applicationForeground, config: { mounted: true, manifestUrl: '/sam3-packet/tensor-manifest.json' } });
await tools.open('/api/read?root=image-inbox&path=selected.png', { name: 'selected.png' });
await tools.run();
assert.equal(options.inferenceSession, session);
assert.equal(options.foregroundService, applicationForeground, 'the real image tools must forward the app service to the SAM producer');
assert.equal(typeof options.yield, 'function', 'the source viewport must retain its input-driven yield');
await options.yield({ reason: 'fixture-boundary' });
await tools.run();
assert.equal(runtimeCreations, 1, 'warm prompt runs must retain their model runtime');
assert.equal(calls, 2);
await tools.close();
assert.equal(closed, true);
assert.equal(foreground.closed, true);
console.log('SAM image tools application-session forwarding contracts passed (controlled DOM/model dependencies)');
