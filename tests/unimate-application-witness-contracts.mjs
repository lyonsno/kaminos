// kaminos-test: node
import assert from 'node:assert/strict';
import { checkUniMateApplicationWitness, readBrowserJson } from '../models/unimate/application-witness-checks.mjs';
const positions = Array.from({ length: 60 * 18 * 3 }, (_, i) => i / 1000);
const run = { encoding: { cooperative: true, duties: [{}, {}], frameSubmissions: [1] }, textEncoder: 'browser T5', dutyCount: 4, framesDuring: 5, frames: 60, joints: 18, glbBytes: 4096, positions };
const valid = { source: { rev: 'fixture-source', dirtyFiles: [] }, expectedRevision: 'fixture-source', outsideCheckout: true,
  installed: { kit: 'kit.tgz', model: 'unimate.tgz' }, browser: { executable: 'independent-test-browser', effectiveBrowser: 'fixture', profile: { temporary: true }, browserExit: { code: 0 } },
  input: { joints: 18, frames: 60 }, paused: 'paused', pausedFrames: 2, resumed: 'running', stopped: true,
  runs: [run, run], repeatMaxDifference: 0, export: { channels: 19, frames: 60, allFinite: true },
  afterDestroy: { phase: 'destroyed', routes: 0, session: 'active', foregroundDisposed: false, frames: 2 }, gpuErrors: [] };
assert.deepEqual(checkUniMateApplicationWitness(valid), []);
for (const mutate of [
  r => { r.source.rev = 'wrong-revision'; }, r => { r.source.dirtyFiles = ['changed.js']; },
  r => { r.outsideCheckout = false; }, r => { delete r.installed.kit; }, r => { delete r.browser.effectiveBrowser; },
  r => { r.input.joints = 43; }, r => { r.runs = []; }, r => { r.runs[0].textEncoder = 'captured embedding'; },
  r => { r.runs[0].dutyCount = 0; }, r => { r.runs[0].framesDuring = 0; }, r => { r.runs[0].positions.fill(0); },
  r => { r.runs[0].positions.pop(); }, r => { r.runs[0].positions[0] = NaN; }, r => { r.pausedFrames = 0; },
  r => { r.stopped = false; }, r => { r.runs[0].encoding.frameSubmissions = []; }, r => { r.runs[0].encoding.cooperative = false; }, r => { r.repeatMaxDifference = .5; }, r => { r.export.allFinite = false; },
  r => { r.afterDestroy.session = 'closed'; }, r => { r.afterDestroy.routes = 1; }, r => { delete r.gpuErrors; },
  r => { r.gpuErrors.push('validation failure'); }, r => { r.browser.browserExit.code = 1; },
]) {
  const report = structuredClone(valid); mutate(report);
  assert(checkUniMateApplicationWitness(report).length > 0, `reject ${mutate}`);
}
console.log('UniMate witness rejects stale source, wrong route, missing output and incomplete lifecycle');

// Replay the complete history shape that exceeded a single CDP message; no rows lost.
const window = { history: { samples: Array.from({ length: 100 }, (_, i) => ({ i, motion: 'x'.repeat(150000) })) } };
let responses = 0;
const evaluate = async expression => { responses++; const value = Function('window', `return ${expression}`)(window); if (typeof value === 'string') assert(value.length <= 262144); return value; };
assert.deepEqual(await readBrowserJson(evaluate, 'window.history'), window.history);
assert(responses > 50);
assert.deepEqual(Object.keys(window), ['history'], 'transport snapshot is retired');
await assert.rejects(readBrowserJson(async expression => expression.includes('.slice(') ? '' : evaluate(expression), 'window.history'), /incomplete browser JSON/);
assert.deepEqual(Object.keys(window), ['history']);
