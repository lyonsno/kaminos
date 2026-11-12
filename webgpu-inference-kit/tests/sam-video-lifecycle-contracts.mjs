// kaminos-test: node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as vm from 'node:vm';
if (!vm.SourceTextModule) {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(import.meta.url)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout); console.log(r.stdout.trim());
} else {
  const turn = () => new Promise(resolve => setImmediate(resolve));
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
  const source = await readFile(new URL('../examples/sam-video.mjs', import.meta.url), 'utf8');
  for (const stage of ['device', 'media', 'active']) {
    const acquisition = deferred(), camera = deferred(), events = [];
    let requested = 0, mediaRequested = 0;
    const nodes = new Map();
    const node = () => ({ disabled: false, value: '', width: 2, height: 2,
      getContext: () => ({ clearRect() {} }), pause() {}, load() {}, removeAttribute() {}, async play() {},
      get videoWidth() { return 2; }, get videoHeight() { return 2; } });
    const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
      createElement: node, querySelectorAll: () => [] };
    const device = { lost: new Promise(() => {}), destroy() { events.push('destroy'); } };
    const stream = { getTracks: () => [{ stop() { events.push('stop-camera'); } }] };
    const core = {
      async requestBrowserWebGpuDevice() { requested++; return acquisition.promise; },
      async createWebGpuInferenceSession() { events.push('session'); return { async drain() {}, close() { events.push('close-session'); } }; },
      createWebGpuForegroundService: () => ({ async dispose() { events.push('dispose-foreground'); } }),
    };
    const mocks = {
      '@kaminos/webgpu-inference-kit/core': core,
      '@kaminos/webgpu-inference-kit/sam': { createSam31VideoTracker() {}, createSam31LiveLoop() {} },
      './sam-video-preview.mjs': { async createSamVideoPreview() { return { setSource(value) { if (value) events.push('install-preview'); }, async close() { events.push('close-preview'); } }; } },
    };
    const context = vm.createContext({ console, URL, URLSearchParams, crypto, Promise, Uint8Array, Uint8ClampedArray,
      location: { href: 'http://localhost/example.html', search: '' }, addEventListener() {},
      navigator: { gpu: {}, mediaDevices: { async getUserMedia() { mediaRequested++; return camera.promise; } } } });
    const module = new vm.SourceTextModule(source, { context });
    await module.link(async specifier => {
      const ns = mocks[specifier]; assert.ok(ns, specifier);
      return new vm.SyntheticModule(Object.keys(ns), function () { for (const [k, v] of Object.entries(ns)) this.setExport(k, v); }, { context });
    });
    await module.evaluate();
    const app = await module.namespace.mountSamVideoPage(document);
    const first = nodes.get('camera').onclick(), second = nodes.get('camera').onclick();
    await turn();
    assert.equal(requested, 1, 'overlapping Camera cannot acquire or overwrite a second device');
    for (const id of ['camera', 'file', 'load', 'model']) assert.equal(nodes.get(id).disabled, true);
    let closing;
    if (stage === 'device') closing = app.close();
    acquisition.resolve({ device, adapter: {}, backendIdentity: {} });
    await turn();
    if (stage !== 'device') {
      assert.equal(mediaRequested, 1);
      if (stage === 'media') closing = app.close();
      camera.resolve(stream); await turn();
    }
    await first; await second;
    if (!closing) closing = app.close();
    await closing; await app.close();
    assert.equal(events.filter(e => e === 'destroy').length, 1, stage);
    assert.equal(events.filter(e => e === 'stop-camera').length, stage === 'device' ? 0 : 1, stage);
    assert.equal(events.filter(e => e === 'install-preview').length, stage === 'active' ? 1 : 0,
      'late camera completion cannot install into the closed application');
    if (stage !== 'device') {
      assert.equal(events.filter(e => e === 'close-preview').length, 1);
      assert.equal(events.filter(e => e === 'close-session').length, 1);
      assert.equal(events.filter(e => e === 'dispose-foreground').length, 1);
    }
    await nodes.get('camera').onclick();
    assert.equal(requested, 1, 'closed application refuses new acquisition');
  }
  console.log('SAM camera setup owns one acquisition and releases active/late resources exactly once (mock APIs)');
}
