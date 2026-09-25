import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.ok(/function setForegroundOpportunityRequester\(/.test(source),
  'the ordinary volume prototype must expose its frame-service boundary');
assert.ok(/foregroundGpuContext\(\)\s*\{[\s\S]*?renderer: boundarySplatRequested\(\) \|\| browserResidualCanApply\(\) \? 'alternate-volume' : 'ordinary-volume'/.test(source),
  'the prototype must identify the actual ordinary flame route and device');

const renderStart = source.indexOf('  function renderOrdinaryFrame(');
assert.ok(renderStart >= 0, 'ordinary renderer implementation exists');
const renderEnd = source.indexOf('\n  function ', renderStart + 4);
const render = source.slice(renderStart, renderEnd > renderStart ? renderEnd : undefined);
assert.ok(/foregroundService\.submit\(\[encoder\.finish\(\)\]/.test(render),
  'foreground frame submission must use the producer-owned service lease');
assert.ok(/if \(foregroundService\) throw err/.test(render),
  'foreground render failure must propagate to the producer receipt');
assert.ok(/if \(!foregroundService && state\.frameCount % 12 === 0\) probeVolumeQueueTiming\(\)/.test(render),
  'unrelated timing probes must not submit outside the foreground lease while the producer owns scheduling');

const schedulerStart = source.indexOf('  function setForegroundOpportunityRequester(');
const schedulerEnd = source.indexOf('  function renderOrdinaryFrame(', schedulerStart);
const scheduler = source.slice(schedulerStart, schedulerEnd);
const makeScheduler = new Function(
  'state', 'requestAnimationFrame', 'cancelAnimationFrame', 'renderOrdinaryFrame', 'canvas', 'emitStatus',
  `let foregroundOpportunityRequester = null, foregroundPending = null, foregroundSequence = 0, raf = 0;
   const ordinaryForeground = { completedFrames: 0, lastReceipt: null };
   let selectiveHeadLiveCapturePaused = false;
   const productFrameOwner = 'prototype';
   ${scheduler}
   return { render, setForegroundOpportunityRequester };`,
);
const queued = [];
const requests = [];
const state = { active: true, frameCount: 4, simStepCount: 9, error: null };
const api = makeScheduler(
  state,
  callback => { queued.push(callback); return queued.length; },
  () => {},
  () => ({ status: 'submitted', renderer: 'ordinary-volume', frameCount: 5, simStepCount: 10 }),
  { classList: { remove() {} } },
  () => {},
);
api.setForegroundOpportunityRequester(request => {
  let resolve;
  const completion = new Promise(done => { resolve = done; });
  requests.push({ request, resolve });
  return { completion };
});
queued.length = 0;
api.render(1);
api.render(2);
assert.equal(requests.length, 1, 'only one producer-owned frame may be outstanding');
assert.equal(state.frameCount, 4, 'the renderer must wait for a producer-granted opportunity');
assert.deepEqual(requests[0].request.metadata, { renderer: 'ordinary-volume', frameCount: 4, simStepCount: 9 });
const frame = requests[0].request.run({});
requests[0].resolve({ status: 'completed', result: frame });
await new Promise(resolve => setImmediate(resolve));
assert.equal(state.active, true, state.error || 'unexpected foreground state');
assert.equal(queued.length, 1, 'the next frame is scheduled only after completion');

api.render(3);
requests[1].resolve({ status: 'failed', failure: { message: 'producer rejected frame' } });
await new Promise(resolve => setImmediate(resolve));
assert.equal(state.active, false, 'a failed service receipt stops the foreground loop');
assert.match(state.error, /failed/);

console.log('current-main SF3D ordinary frame service contracts passed');
