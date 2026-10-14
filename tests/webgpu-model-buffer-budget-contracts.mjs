// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import * as kit from '../webgpu-inference-kit/src/core.js';

function fixture({ createError, destroyError, fenceError } = {}) {
  const allocated = [], fences = [];
  const state = { onFence: null };
  const queue = { onSubmittedWorkDone() {
    if (fenceError) return Promise.reject(fenceError);
    return new Promise(resolve => { fences.push(resolve); state.onFence?.(); });
  }, writeBuffer() {} };
  const device = { queue, features: new Set(), limits: {}, createBuffer(descriptor) {
    if (createError) throw createError;
    const buffer = { size: descriptor.size, label: descriptor.label, destroyCalls: 0,
      destroy() { if (destroyError) throw destroyError; this.destroyCalls++; } };
    allocated.push(buffer); return buffer;
  } };
  return Object.assign(state, { device, queue, allocated, fences });
}
const descriptor = (size, label = 'model') => ({ size, label, usage: 128 });
function budget(f, maxBytes) {
  assert.equal(typeof kit.createWebGpuModelBufferBudget, 'function',
    'common runtime needs a scoped allocation budget, not a whole-device wrapper');
  return kit.createWebGpuModelBufferBudget({ device: f.device, queue: f.queue, maxBytes });
}
function runtime(f, bufferBudget) {
  return kit.createWebGpuInferenceRuntime({ routeId: 'test.model', device: f.device,
    queue: f.queue, adapterName: 'controlled queue fixture', bufferBudget });
}

test('refusal precedes device allocation and leaves renderer allocation untouched', () => {
  const f = fixture(), create = f.device.createBuffer, guard = budget(f, 64);
  const a = guard.createBuffer(descriptor(48));
  assert.throws(() => guard.createBuffer(descriptor(20, 'over-budget')), e =>
    e.name === 'WebGpuBufferBudgetError' && e.memoryBudget.requestedBytes === 20
    && e.memoryBudget.chargedBytes === 48 && e.memoryBudget.maxBytes === 64);
  assert.equal(f.allocated.length, 1);
  assert.equal(f.device.createBuffer, create);
  f.device.createBuffer(descriptor(1024, 'renderer'));
  assert.equal(guard.snapshot().chargedBytes, 48);
  assert.equal(a.destroyCalls, 0);
  assert.equal(guard.snapshot().physicalMemoryMeasured, false);
});

test('destruction batches fence observation and cannot free charge before settlement', async () => {
  const f = fixture(), guard = budget(f, 64);
  const a = guard.createBuffer(descriptor(32)), b = guard.createBuffer(descriptor(32));
  a.destroy(); b.destroy(); a.destroy();
  assert.equal(guard.snapshot().chargedBytes, 64);
  assert.equal(guard.snapshot().pendingRetirementBytes, 64);
  assert.throws(() => guard.createBuffer(descriptor(4)), /budget/);
  const settling = guard.settleRetirements();
  await Promise.resolve();
  assert.equal(f.fences.length, 1);
  assert.equal(a.destroyCalls, 1);
  f.fences[0](); await settling;
  assert.equal(guard.snapshot().chargedBytes, 0);
  assert.equal(guard.snapshot().peakChargedBytes, 64);
  guard.createBuffer(descriptor(64));
});

test('later destruction is covered by a later fence, not an earlier completion', async () => {
  const f = fixture(), guard = budget(f, 64);
  const a = guard.createBuffer(descriptor(32)), b = guard.createBuffer(descriptor(32));
  a.destroy(); await Promise.resolve();
  assert.equal(f.fences.length, 1);
  b.destroy();
  const settling = guard.settleRetirements();
  const secondFence = new Promise(resolve => { f.onFence = resolve; });
  f.fences[0]();
  await secondFence;
  assert.equal(guard.snapshot().chargedBytes, 32);
  f.fences[1](); await settling;
  assert.equal(guard.snapshot().chargedBytes, 0);
});

test('allocation throws roll back reservation while destroy/fence failures hold charge', async () => {
  const createError = new Error('allocation failed'), f = fixture({ createError }), guard = budget(f, 64);
  assert.throws(() => guard.createBuffer(descriptor(16)), e => e === createError);
  assert.equal(guard.snapshot().chargedBytes, 0);
  for (const failure of ['destroyError', 'fenceError']) {
    const error = new Error(failure), f = fixture({ [failure]: error }), guard = budget(f, 64);
    const a = guard.createBuffer(descriptor(64));
    if (failure === 'destroyError') assert.throws(() => a.destroy(), e => e === error);
    else a.destroy();
    await assert.rejects(guard.settleRetirements(), e => e === error);
    assert.equal(guard.snapshot().chargedBytes, 64);
    assert.equal(guard.snapshot().quarantined, true);
    assert.throws(() => guard.createBuffer(descriptor(0)), /quarantined/);
  }
});

test('caller budget is explicit and safe-integer; invalid sizes cannot reach the device', () => {
  const f = fixture();
  for (const maxBytes of [undefined, 0, -1, 1.1, Infinity, true, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => budget(f, maxBytes), /positive safe-integer/);
  const guard = budget(f, 64);
  for (const size of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => guard.createBuffer(descriptor(size)), /non-negative safe-integer/);
  assert.equal(f.allocated.length, 0);
});

test('runtime rejects wrong device/queue and malformed guards before allocating', async () => {
  const f = fixture();
  for (const guard of [ {},
    { device: {}, queue: f.queue, createBuffer() {}, snapshot() {} },
    { device: f.device, queue: {}, createBuffer() {}, snapshot() {} },
  ]) await assert.rejects(runtime(f, guard), /bufferBudget/);
  assert.equal(f.allocated.length, 0);
});

test('runtime-owned and resident buffers share charge without transferring resident ownership', async () => {
  const f = fixture(), guard = budget(f, 64), r = await runtime(f, guard);
  const resident = r.createManagedBuffer(descriptor(32, 'resident'));
  const temporary = r.createBuffer(descriptor(32, 'temporary'));
  assert.throws(() => r.createBuffer(descriptor(4)), /budget/);
  r.dispose();
  assert.equal(resident.destroyCalls, 0);
  assert.equal(temporary.destroyCalls, 1);
  const settling = guard.settleRetirements(); await Promise.resolve(); f.fences[0](); await settling;
  assert.equal(guard.snapshot().chargedBytes, 32);
  const next = await runtime(f, guard);
  next.createManagedBuffer(descriptor(32, 'next-run'));
  assert.equal(guard.snapshot().chargedBytes, 64);
});

test('tensors and uniforms allocate through the same budget; imported buffers are not recharged', async () => {
  const f = fixture(), guard = budget(f, 64), r = await runtime(f, guard);
  const tensor = r.createTensor({ name: 'features', dtype: 'f32', shape: [8], usage: 128 });
  assert.equal(guard.snapshot().chargedBytes, 32);
  r.createTensor({ name: 'alias', dtype: 'f32', shape: [8], buffer: tensor.buffer });
  assert.equal(guard.snapshot().chargedBytes, 32);
  const uniform = r.createUniformBuffer({ label: 'params', schema: [{ name: 'n', type: 'u32' }], values: { n: 8 } });
  assert.ok(uniform.buffer);
  assert.throws(() => r.createManagedBuffer(descriptor(64)), /budget/);
});

test('unbudgeted runtime retains its existing allocation path', async () => {
  const f = fixture(), r = await runtime(f);
  r.createManagedBuffer(descriptor(1024));
  assert.equal(f.allocated.length, 1);
});

test('a falsy queue rejection still quarantines the guard and rejects retirement settlement', async () => {
  const f = fixture(); f.queue.onSubmittedWorkDone = () => Promise.reject(undefined);
  const guard = budget(f, 64); guard.createBuffer(descriptor(32)).destroy();
  await assert.rejects(guard.settleRetirements(), /settlement.*undefined/);
  assert.equal(guard.snapshot().quarantined, true);
  assert.equal(guard.snapshot().chargedBytes, 32);
  assert.throws(() => guard.createBuffer(descriptor(4)), /quarantined/);
});

test('a guard is bound to the actual device and queue, even when its shape is valid', async () => {
  const f = fixture(), other = fixture(), guard = budget(other, 64);
  await assert.rejects(runtime(f, guard), /exact device and queue/);
  assert.throws(() => kit.createWebGpuModelBufferBudget({ device: f.device, queue: other.queue, maxBytes: 64 }), /exact/);
});

test('unwrappable buffers never escape without tracking; failed installation retires their charge', async () => {
  const f = fixture(), create = f.device.createBuffer;
  f.device.createBuffer = d => {
    const buffer = create(d);
    Object.defineProperty(buffer, 'destroy', { writable: false, configurable: false });
    return buffer;
  };
  const guard = budget(f, 64);
  assert.throws(() => guard.createBuffer(descriptor(64)), /redefine property/);
  assert.equal(f.allocated[0].destroyCalls, 1);
  assert.equal(guard.snapshot().chargedBytes, 64);
  const settling = guard.settleRetirements(); await Promise.resolve(); f.fences[0](); await settling;
  assert.equal(guard.snapshot().chargedBytes, 0);
});
