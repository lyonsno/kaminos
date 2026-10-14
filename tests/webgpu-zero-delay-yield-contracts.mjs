// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import { createCooperativeYield } from '../webgpu-inference-kit/src/inference-runtime.js';

function installChannel(t, { postError } = {}) {
  const original = globalThis.MessageChannel;
  const channels = [];
  globalThis.MessageChannel = class {
    constructor() {
      const channel = this;
      this.port1 = { closed: false, close() { this.closed = true; } };
      this.port2 = {
        closed: false,
        close() { this.closed = true; },
        postMessage(value) {
          channel.posted = value;
          if (postError) throw postError;
        },
      };
      channels.push(this);
    }
  };
  t.after(() => { globalThis.MessageChannel = original; });
  return channels;
}

test('zero delay posts a task, remains pending through microtasks, then closes both ports', async t => {
  const channels = installChannel(t);
  let settled = false;
  const metadata = { stage: 'encoder' };
  let clock = 0;
  const result = createCooperativeYield({ now: () => clock })({ reason: 'kernel', metadata });
  void result.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(channels.length, 1);
  assert.equal(channels[0].posted, null);
  assert.equal(settled, false);
  assert.equal(channels[0].port1.closed, false);
  clock = 2.34;
  channels[0].port1.onmessage({ data: null });
  const receipt = await result;
  assert.deepEqual(receipt, {
    reason: 'kernel', waitForSubmittedWorkDone: false,
    requestedYieldMs: 0, elapsedMs: 2.3, metadata,
  });
  assert.notEqual(receipt.metadata, metadata);
  assert.equal(channels[0].port1.closed, true);
  assert.equal(channels[0].port2.closed, true);
});

test('overlapping yields own independent task channels and settle independently', async t => {
  const channels = installChannel(t);
  const yieldTask = createCooperativeYield();
  let firstSettled = false;
  const first = yieldTask();
  void first.then(() => { firstSettled = true; });
  const second = yieldTask();
  assert.equal(channels.length, 2);
  channels[1].port1.onmessage({});
  await second;
  assert.equal(firstSettled, false);
  assert.equal(channels[0].port1.closed, false);
  channels[0].port1.onmessage({});
  await first;
  assert.equal(channels[0].port2.closed, true);
});

test('posting failure is observable and releases both owned ports', async t => {
  const error = new Error('task post failed');
  const channels = installChannel(t, { postError: error });
  await assert.rejects(createCooperativeYield()(), e => e === error);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].port1.closed, true);
  assert.equal(channels[0].port2.closed, true);
});

test('positive delays use the requested timer rather than the task channel', async t => {
  const channels = installChannel(t);
  const original = globalThis.setTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, ms) => { timers.push(ms); callback(); };
  t.after(() => { globalThis.setTimeout = original; });
  const receipt = await createCooperativeYield({ yieldMs: 12.5 })();
  assert.deepEqual(timers, [12.5]);
  assert.equal(channels.length, 0);
  assert.equal(receipt.requestedYieldMs, 12.5);
});

test('environments without MessageChannel keep a timer-based task fallback', async t => {
  const originalChannel = globalThis.MessageChannel;
  const originalTimer = globalThis.setTimeout;
  globalThis.MessageChannel = undefined;
  const timers = [];
  globalThis.setTimeout = (callback, ms) => { timers.push(ms); callback(); };
  t.after(() => {
    globalThis.MessageChannel = originalChannel;
    globalThis.setTimeout = originalTimer;
  });
  await createCooperativeYield()();
  assert.deepEqual(timers, [0]);
});

test('injected sleep retains precedence over the default task mechanism', async t => {
  const channels = installChannel(t);
  const delays = [];
  await createCooperativeYield({ sleep: async ms => { delays.push(ms); } })();
  assert.deepEqual(delays, [0]);
  assert.equal(channels.length, 0);
});

test('requested submission fence settles before posting the browser task', async t => {
  const channels = installChannel(t);
  let finish;
  const fence = new Promise(resolve => { finish = resolve; });
  const result = createCooperativeYield({
    queue: { onSubmittedWorkDone: () => fence }, waitForSubmittedWorkDone: true,
  })();
  assert.equal(channels.length, 0);
  finish();
  await Promise.resolve();
  assert.equal(channels.length, 1);
  channels[0].port1.onmessage({});
  assert.equal((await result).waitForSubmittedWorkDone, true);
});

test('failed submission fence rejects without posting a task', async t => {
  const channels = installChannel(t);
  const error = new Error('queue failed');
  await assert.rejects(createCooperativeYield({
    queue: { onSubmittedWorkDone: async () => { throw error; } },
    waitForSubmittedWorkDone: true,
  })(), e => e === error);
  assert.equal(channels.length, 0);
});
