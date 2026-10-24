// kaminos-test: node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const entry = new URL('../models/material-photo/material-photo-operation.js', import.meta.url);
assert.ok(existsSync(entry), 'depth and materials must compose without importing the demo controller');
const { createMaterialPhotoOperation } = await import(entry);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const device = {}, session = {}, foreground = {}, calls = [];
  const depth = { width: 1, height: 1, depth: new Float32Array([2]) };
  const maps = { width: 512, height: 512, albedo: new Uint8Array([1, 2, 3]) };
  const geometry = { device, session, foreground, model: { useRealWeights: true },
    async load(progress) { calls.push('load-geometry'); progress?.(1, 2); },
    async infer(options) { calls.push('geometry'); this.input = options; return depth; } };
  const materials = { device, session, foreground,
    async load(progress) { calls.push('load-materials'); progress?.({ phase: 'weights' }); },
    async infer(options) { calls.push('materials'); this.input = options; return maps; } };
  return { geometry, materials, depth, maps, calls, operation: createMaterialPhotoOperation({ geometry, materials }) };
}
const image = { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) };
{
  const f = fixture(), events = [], options = { scheduler: { splitVitBlocks: true } };
  const result = await f.operation.infer({ image, size: 512, geometryOptions: options,
    onProgress: event => events.push(event), onGeometry(depth, info) {
      assert.equal(depth, f.depth); assert.equal(info.cached, false); f.calls.push('received-geometry');
    } });
  assert.deepEqual(f.calls, ['load-geometry', 'geometry', 'received-geometry', 'load-materials', 'materials']);
  assert.equal(f.geometry.input.image, image); assert.equal(f.materials.input.image, image);
  assert.equal(f.geometry.input.scheduler, options.scheduler);
  assert.equal(f.geometry.input.signal, f.materials.input.signal);
  assert.equal(result.depth, f.depth); assert.equal(result.maps, f.maps);
  assert.ok(events.some(e => e.stage === 'geometry' && e.phase === 'loading'));
  assert.ok(events.some(e => e.stage === 'materials' && e.phase === 'inferring'));
  assert.equal(f.operation.snapshot().stage, null);
  f.calls.length = 0;
  await f.operation.infer({ image, size: 512, depth: result.depth });
  assert.deepEqual(f.calls, ['load-materials', 'materials']);
  assert.deepEqual([...result.maps.albedo], [1, 2, 3], 'caller-owned previous output remains intact');
}
{
  const f = fixture(), reached = deferred(), release = deferred();
  const run = f.operation.infer({ image, size: 512, onGeometry: async () => { reached.resolve(); await release.promise; } });
  const rejected = assert.rejects(run, { name: 'AbortError' });
  await reached.promise;
  await assert.rejects(async () => f.operation.infer({ image }), /already running/);
  f.operation.stop(); release.resolve(); await rejected;
  assert.ok(!f.calls.includes('load-materials'), 'stop at the handoff must prevent the second model');
  const result = await f.operation.infer({ image, size: 512 }); assert.equal(result.maps, f.maps);
}
{
  const f = fixture(), reached = deferred(), release = deferred(), events = [];
  f.geometry.load = async progress => { reached.resolve(); await release.promise; progress(4, 4); };
  const abort = new AbortController(), run = f.operation.infer({ image, size: 512, signal: abort.signal, onProgress: e => events.push(e) });
  const rejected = assert.rejects(run, { name: 'AbortError' });
  await reached.promise; abort.abort(); await rejected;
  const before = events.length; release.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(events.length, before, 'cancelled loading must not publish stale progress');
  assert.deepEqual(f.calls, []);
}
{
  const f = fixture(), run = f.materials.infer;
  f.materials.infer = async () => { throw Error('material failed'); };
  await assert.rejects(f.operation.infer({ image, size: 512 }), /material failed/);
  f.materials.infer = run;
  await f.operation.infer({ image, size: 512 });
  await assert.rejects(f.operation.infer({ image, size: 768 }), /resolution/);
  f.geometry.model.useRealWeights = false;
  await assert.rejects(f.operation.infer({ image, size: 512 }), /real weights/);
}
{
  const f = fixture();
  assert.throws(() => createMaterialPhotoOperation({ geometry: f.geometry, materials: { ...f.materials, session: {} } }), /same.*session/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.operation.infer({ image, signal: abort.signal }), { name: 'AbortError' });
  assert.deepEqual(f.calls, []);
  assert.throws(() => f.operation.infer({ image, materialOptions: { image: {} } }), /owns.*image/);
}
{
  const f = fixture();
  await assert.rejects(f.operation.infer({ image, onProgress: () => f.operation.stop() }), { name: 'AbortError' });
  assert.deepEqual(f.calls, [], 'stop from loading notification precedes starting the load');
}
console.log('Photograph operation: same-host sequencing, retained depth, handoff stop, retry and unchanged outputs pass');
