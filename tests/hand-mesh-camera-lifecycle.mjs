// kaminos-test: node
import vm from 'node:vm';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const elements = new Map(), callbacks = new Map(), streams = [];
let nextCallback = 0, busy = false, calls = 0, resolveFirst;
const oldInference = new Promise(resolve => { resolveFirst = resolve; });
const noHand = { hasHand: false, timings: { mobreconMs: 0 }, acquisition: { source: 'no_detection' } };
const route = { async infer() { calls++; if (busy) throw Error('browser hand mesh route already has an inference in flight'); busy = true; try { return calls === 1 ? await oldInference : noHand; } finally { busy = false; } } };
function element(id) {
  if (!elements.has(id)) elements.set(id, { value: id === 'hand' ? 'right' : '0.8', dataset: {}, hidden: false });
  return elements.get(id);
}
Object.assign(element('camera'), { videoWidth: 640, videoHeight: 480, async play() {},
  requestVideoFrameCallback(fn) { const id = ++nextCallback; callbacks.set(id, fn); return id; }, cancelVideoFrameCallback(id) { callbacks.delete(id); } });
const context = vm.createContext({ document: { getElementById: element }, indexedDB: {}, createModelStore: () => ({}),
  navigator: { mediaDevices: { async getUserMedia() { const track = { readyState: 'live', stop() { this.readyState = 'ended'; } }; const stream = { getTracks: () => [track], getVideoTracks: () => [track] }; streams.push(stream); return stream; } } },
  __route: route, console,
});
let source = await fs.readFile(new URL('../demos/hand-mesh/main.js', import.meta.url), 'utf8');
source = source.replace(/^import .*;$/gm, '').replace(/^initialize\(\)\.catch\(.*$/m, '');
vm.runInContext(source, context);
vm.runInContext('route = __route', context);
const run = code => vm.runInContext(code, context);
const tick = () => new Promise(resolve => setImmediate(resolve));
const frame = () => { const [id, callback] = callbacks.entries().next().value; callbacks.delete(id); callback(); };
await run('start()'); frame(); await tick();
assert.equal(calls, 1);
const stopped = run('stop()');
assert.equal(streams[0].getTracks()[0].readyState, 'ended', 'Stop releases the camera immediately');
const restarted = run('start()'); await tick();
assert.equal(streams.length, 1, 'restart must wait for the old inference before acquiring another camera');
assert.equal(calls, 1);
resolveFirst(noHand); await stopped; await restarted; frame(); await tick();
assert.equal(calls, 2);
assert.equal(run('error'), null);
assert.equal(run('running'), true, 'restart survives without stopping its new stream');
assert.equal(streams[1].getTracks()[0].readyState, 'live');
await run('stop()');
assert.equal(streams[1].getTracks()[0].readyState, 'ended');
console.log('production hand camera stop/immediate-restart regression passed');
