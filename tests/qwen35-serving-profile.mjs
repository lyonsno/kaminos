// kaminos-test: node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withModelProfile, adjudicateServingProfile } from '../models/qwen3_5/serving-profile.js';
import { runModelWitness } from '../models/qwen3_5/run-model-witness.mjs';

test('profiling preserves model calls/results and restores methods after success or failure', async () => {
  let time = 0;
  class Model {
    async createState() { time += 2; return { length: 0 }; }
    async dispatch(name) { time += 3; if (name === 'bad') throw new Error('GPU failed'); }
    async prefill(ids, state) { await this.dispatch('affine'); state.length += ids.length; return [7]; }
    async decode(id, state) { await this.dispatch('attention'); state.length++; return [id]; }
    async disposeState() { time += 1; }
  }
  const model = new Model(), profile = {}, original = model.dispatch;
  const value = await withModelProfile(model, async () => {
    const s = await model.createState(); assert.deepEqual(await model.prefill([1, 2], s), [7]);
    assert.deepEqual(await model.decode(7, s), [7]); await model.disposeState(s); return 'complete';
  }, { profile, now: () => time });
  assert.equal(value, 'complete'); assert.equal(model.dispatch, original); assert.equal(Object.hasOwn(model, 'dispatch'), false);
  assert.equal(profile.totalMs, 9); assert.deepEqual(profile.calls.map(x => x.operation), ['createState', 'prefill', 'decode', 'disposeState']);
  assert.equal(profile.calls[1].inputTokens, 2); assert.equal(profile.calls[2].pastTokens, 2);
  assert.deepEqual(profile.duties.affine, { count: 1, totalMs: 3, maxMs: 3, failures: 0 });
  const failure = {};
  await assert.rejects(withModelProfile(model, () => model.dispatch('bad'), { profile: failure, now: () => time }), /GPU failed/);
  assert.equal(failure.completed, false); assert.equal(failure.duties.bad.failures, 1); assert.equal(model.dispatch, original);
});

function fixture() {
  const settings = { temperature: 0, topK: 20, topP: .95, minP: 0, presencePenalty: 1.5, maxNewTokens: 3584, eosTokenIds: [7] };
  const expected = { prompt: 'fox', inputIds: [1, 2], settings, tokenizerSha256: 'a', systemPromptsSha256: 'b', weightsManifestSha256: 'c' };
  const result = { backend: 'webgpu', adapter: { vendor: 'apple', isFallbackAdapter: false }, errors: [], weightsManifestSha256: 'c', rows: [],
    cleanup: { states: 0, weights: 0, borrowedControl: 'running' },
    expansion: { ...structuredClone(expected), stream: ['fox'], output: { text: 'fox', finishReason: 'eos', stopTokenId: 7, promptTokenCount: 2, tokenIds: [4], generatedTokenCount: 2 } },
    profile: { schema: 'kaminos.qwen35-serving-profile.v1', clock: 'performance.now-wall-ms', diagnosticReadbacks: false,
      completed: true, startedMs: 0, finishedMs: 10, totalMs: 10, firstTextMs: 4, loadMs: 20, inputPreparationMs: 1,
      calls: [ ['createState',0,1], ['prefill',1,4], ['decode',4,8], ['disposeState',8,9] ].map(([operation,startMs,endMs]) => ({ operation,startMs,endMs,ms:endMs-startMs,status:'passed',...(operation==='prefill'?{inputTokens:2,pastTokens:0}:operation==='decode'?{inputTokens:1,pastTokens:2}:{}) })),
      duties: { affine: { count: 3, totalMs: 5, maxMs: 2, failures: 0 } } } };
  return { result, expected };
}
test('serving profile derives throughput from complete EOS execution and actual model calls', () => {
  const { result, expected } = fixture(), out = adjudicateServingProfile(result, expected);
  assert.equal(out.prefillMs, 3); assert.equal(out.decodeMs, 4); assert.equal(out.decodeCalls, 1); assert.equal(out.decodeTokensPerSecond, 250);
});
test('fallback, oracle readbacks, incomplete output, mismatched call counts and malformed clocks fail', () => {
  for (const change of [r=>r.backend='cpu', r=>r.adapter.isFallbackAdapter=true, r=>r.weightsManifestSha256='wrong',
    r=>r.errors.push('device lost'), r=>r.rows.push({name:'prefill.layers'}), r=>r.profile.diagnosticReadbacks=true,
    r=>r.cleanup.weights=1, r=>r.expansion.output.finishReason='length', r=>r.expansion.stream=[],
    r=>r.profile.calls.splice(2,1), r=>r.profile.calls[1].inputTokens=1, r=>r.profile.calls[2].pastTokens=1,
    r=>r.profile.calls[1].ms=-1, r=>r.profile.firstTextMs=20, r=>r.profile.loadMs=NaN,
    r=>r.profile.duties={}, r=>r.profile.duties.affine.failures=1, r=>r.profile.completed=false]) {
    const {result,expected}=fixture(); change(result); assert.throws(()=>adjudicateServingProfile(result,expected));
  }
});
test('rejected profile mode preserves a durable failure before reference or browser launch', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qwen-profile-failure-'));
  try {
    const out=path.join(dir,'report.json');
    const report=await runModelWitness({out,servingProfile:'unsupported'});
    assert.equal(report.status,'failed'); assert.equal(report.phase,'source-admission'); assert.match(report.error,/unknown witness mode/);
    assert.equal(report.ownedBrowserPid,undefined);
    const saved=JSON.parse(await fs.readFile(out,'utf8')); assert.equal(saved.error,report.error); assert.equal(saved.requested.servingProfile,'unsupported');
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
