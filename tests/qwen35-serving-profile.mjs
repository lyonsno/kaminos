// kaminos-test: node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as profiling from '../models/qwen3_5/serving-profile.js';
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

test('explicit single-token route requires actual matching dispatch evidence', () => {
  const {result,expected}=fixture(); expected.singleTokenKernel='quad'; result.singleTokenKernel='quad';
  result.affineDispatches={'affine':3,'affine-quad':0,'affine-tiled':0};
  assert.throws(()=>adjudicateServingProfile(result,expected),/kernel|dispatch/);
});
function comparisonFixture(){
 const {result,expected}=fixture();
 const runs=['oracle','quad','oracle'].map((kernel,index)=>{
  const profile=structuredClone(result.profile);profile.loadMs=0;profile.inputPreparationMs=0;
  profile.startedMs+=20*index;profile.finishedMs+=20*index;
  for(const row of profile.calls){row.startMs+=20*index;row.endMs+=20*index;}
  if(kernel==='quad'){profile.duties['affine-quad']=profile.duties.affine;delete profile.duties.affine;}
  return {index,singleTokenKernel:kernel,statesAfter:0,affineDispatches:{'affine':kernel==='oracle'?3:0,'affine-quad':kernel==='quad'?3:0,'affine-tiled':0},profile,expansion:structuredClone(result.expansion)};
 });
 delete result.profile;delete result.expansion;
 result.comparison={schema:'kaminos.qwen35-serving-comparison.v1',sharedLoadMs:20,sharedInputPreparationMs:1,runs};
 return {result,expected};
}
test('same-browser comparison requires complete ordered fresh-state expansions with matching actual routes',()=>{
 const {result,expected}=comparisonFixture();
 assert.equal(typeof profiling.adjudicateServingComparison,'function','complete comparison adjudication is required');
 const verdict=profiling.adjudicateServingComparison(result,expected);
 assert.equal(verdict.runs.length,3);assert.equal(verdict.identicalCompleteOutput,true);
 assert.deepEqual(verdict.decodeSpeedupVsBaselines,[1,1]);
 for(const change of [r=>r.comparison.runs.pop(),r=>r.comparison.runs.reverse(),
  r=>r.comparison.runs[1].singleTokenKernel='oracle',r=>r.comparison.runs[1].statesAfter=1,
  r=>r.comparison.runs[1].affineDispatches['affine-quad']=0,
  r=>r.comparison.runs[1].profile.duties={'affine':{count:3,totalMs:5,maxMs:2,failures:0}},
  r=>r.comparison.runs[1].profile.calls.pop(),r=>r.comparison.runs[1].expansion.output.finishReason='length',
  r=>r.comparison.runs[1].expansion.output.tokenIds=[5],r=>{r.comparison.runs[1].expansion.output.text='different';r.comparison.runs[1].expansion.stream=['different'];},
  r=>r.comparison.runs[1].profile.startedMs=0,r=>r.comparison.sharedLoadMs=NaN,
  r=>r.backend='cpu',r=>{r.backend='cpu';for(const row of r.comparison.runs)row.backend='webgpu';},
  r=>r.cleanup.weights=1,r=>r.errors.push('failed before comparison completed')]){
   const altered=structuredClone(result);change(altered);assert.throws(()=>profiling.adjudicateServingComparison(altered,expected));
 }
});
test('conflicting comparison and forced kernel requests fail durably before source/reference admission',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qwen-model-route-'));
 try{const out=path.join(dir,'report.json');const r=await runModelWitness({out,compareKernels:true,singleTokenKernel:'quad',request:'absent'});
 assert.equal(r.status,'failed');assert.equal(r.phase,'source-admission');assert.match(r.error,/ambiguous.*kernel/);
 const saved=JSON.parse(await fs.readFile(out,'utf8'));assert.equal(saved.requested.compareKernels,true);assert.equal(saved.requested.singleTokenKernel,'quad');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('model witness CLI preserves complete requests and rejects conflicting or unknown trailing modes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qwen-model-cli-'));
 const script=fileURLToPath(new URL('../models/qwen3_5/run-model-witness.mjs',import.meta.url));
 try{for(const [i,args] of [
  ['request.json','--compare-affine','--quad-affine'],['request.json','--quad-affine','--compare-affine'],
  ['request.json','--serving-profile','--unknown-mode'],['request.json','another.json','--serving-profile'],
 ].entries()){
  const out=path.join(dir,`${i}.json`);
  await assert.rejects(promisify(execFile)(process.execPath,[script,'absent-fixture','absent-model','absent-chrome',out,...args]),e=>e.code===1);
  const saved=JSON.parse(await fs.readFile(out,'utf8'));
  assert.equal(saved.phase,'source-admission');assert.equal(saved.status,'failed');assert.deepEqual(saved.requested.cliArgs,args);
  assert.match(saved.error,i<2?/ambiguous.*kernel/:/unsupported.*CLI/);
 }}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('requested decode batching cannot close with absent or unexecuted batch evidence',()=>{
 const {result,expected}=fixture();expected.batchDecode=true;result.batchDecode=true;result.layerBatchSubmissions=0;
 assert.throws(()=>adjudicateServingProfile(result,expected),/batch/);
});
test('batch comparison retains the existing kernel and varies actual layer submission policy',()=>{
 const {result,expected}=comparisonFixture();expected.comparisonAxis='batchDecode';result.comparison.axis='batchDecode';
 for(const [i,row] of result.comparison.runs.entries()){
  row.singleTokenKernel='oracle';row.batchDecode=i===1;row.layerBatchSubmissions=i===1?2:0;
  row.affineDispatches={'affine':3,'affine-quad':0,'affine-tiled':0};row.profile.duties={'affine':{count:3,totalMs:5,maxMs:2,failures:0}};
  row.profile.schema=`kaminos.qwen35-serving-profile.v${i===1?2:1}`;
  row.profile.dispatchTiming=i===1?'mixed-encoded-and-fenced':'fenced-leaf';
  row.profile.layerBatches={count:i===1?2:0,totalMs:i===1?2:0,maxMs:i===1?1:0,failures:0};
 }
 const verdict=profiling.adjudicateServingComparison(result,expected);
 assert.equal(verdict.comparisonAxis,'batchDecode');assert.deepEqual(verdict.runs.map(r=>r.batchDecode),[false,true,false]);
 const legacyExpected={...expected};delete legacyExpected.comparisonAxis;
 assert.throws(()=>profiling.adjudicateServingComparison(result,legacyExpected),/axis/);
 for(const change of [r=>delete r.comparison.axis,r=>r.comparison.axis='kernel',
  r=>r.comparison.runs[1].profile.schema='kaminos.qwen35-serving-profile.v1',
  r=>r.comparison.runs[1].layerBatchSubmissions=0,r=>r.comparison.runs[0].layerBatchSubmissions=1,
  r=>r.comparison.runs[1].profile.layerBatches.count=1,r=>r.comparison.runs[1].profile.dispatchTiming='fenced-leaf',
  r=>r.comparison.runs[1].profile.layerBatches.failures=1,r=>r.comparison.runs[1].profile.layerBatches.totalMs=11]){const altered=structuredClone(result);change(altered);assert.throws(()=>profiling.adjudicateServingComparison(altered,expected));}
});

test('batch comparison CLI preserves and rejects conflicting execution selectors',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qwen-batch-cli-'));
 const script=fileURLToPath(new URL('../models/qwen3_5/run-model-witness.mjs',import.meta.url));
 try{for(const [i,args]of [['request.json','--compare-batching','--batch-decode'],['request.json','--compare-affine','--compare-batching']].entries()){
  const out=path.join(dir,`${i}.json`);await assert.rejects(promisify(execFile)(process.execPath,[script,'absent-fixture','absent-model','absent-chrome',out,...args]),e=>e.code===1);
  const saved=JSON.parse(await fs.readFile(out,'utf8'));assert.equal(saved.phase,'source-admission');assert.deepEqual(saved.requested.cliArgs,args);assert.match(saved.error,/ambiguous/);
 }}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('mixed encoding and fence clocks use v2 and cannot be admitted as fenced v1',async()=>{
 const model={batchDecode:true,async createState(){},async prefill(){},async decode(){},async disposeState(){},async dispatch(){},async layerBatch(){}};
 const profile={};await withModelProfile(model,async()=>{}, {profile});
 assert.equal(profile.schema,'kaminos.qwen35-serving-profile.v2');
 const {result,expected}=fixture();Object.assign(result,{batchDecode:true,layerBatchSubmissions:2,layerBatchDuty:{count:2,totalMs:2,maxMs:1,failures:0}});
 Object.assign(result.profile,{dispatchTiming:'mixed-encoded-and-fenced',layerBatches:structuredClone(result.layerBatchDuty)});
 expected.batchDecode=true;
 assert.throws(()=>adjudicateServingProfile(result,expected),/clock|schema/);
 result.profile.schema='kaminos.qwen35-serving-profile.v2';
 assert.equal(adjudicateServingProfile(result,expected).decodeCalls,1);
 delete expected.batchDecode;
 assert.throws(()=>adjudicateServingProfile(result,expected),/clock|schema/);
});

test('batch timing v1 cannot masquerade as independently fenced dispatch measurements',()=>{
 const {result,expected}=fixture();Object.assign(result,{batchDecode:true,layerBatchSubmissions:2,layerBatchDuty:{count:2,totalMs:2,maxMs:1,failures:0}});
 Object.assign(result.profile,{dispatchTiming:'mixed-encoded-and-fenced',layerBatches:structuredClone(result.layerBatchDuty)});
 expected.batchDecode=true;
 assert.throws(()=>adjudicateServingProfile(result,expected),/clock|schema/);
});
