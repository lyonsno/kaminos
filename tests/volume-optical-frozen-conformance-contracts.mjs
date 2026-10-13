import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const api=await import('../scripts/check-optical-frozen-predictor.mjs').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;
});
assert.equal(typeof api.checkFrozenPredictions,'function','saved-prediction conformance must preserve a failure report');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'optical-frozen-contract-'));
const sha=b=>createHash('sha256').update(b).digest('hex');
async function save(name,data){const file=path.join(root,name);await fs.writeFile(file,data);return {path:file,sha256:sha(data)};}
const layers=[35,32,32,4].slice(1).map((n,i)=>({weights:Array.from({length:n},()=>Array([35,32,32][i]).fill(0)),bias:Array(n).fill(0)}));
const artifact=await save('model.json',JSON.stringify({identity:'optical-error-mlp-v0',probeCount:3,
  architecture:[35,32,32,4],activations:['relu','relu','softplus'],mean:Array(35).fill(0),
  scale:Array(35).fill(1),targetScale:[1,1,1,1],layers}));
const dataset=await save('rows.jsonl',JSON.stringify({features:Array(35).fill(0)})+'\n');
const bytes=Buffer.alloc(16);for(let i=0;i<4;i++)bytes.writeFloatLE(Math.fround(Math.log(2)),i*4);
const predictions={...await save('prediction.f32',bytes),rows:1};
const training={identity:'optical-quantile-pilot-v0',status:'trained',phase:'complete',backend:{name:'mlx',device:'Device(gpu, 0)'},
  models:[{probeCount:3,artifact,dataset,predictions}]};
async function run(value,name){const input=await save(`${name}.json`,JSON.stringify(value));return api.checkFrozenPredictions(input.path,path.join(root,name));}
const result=await run(training,'good');
assert.equal(result.status,'observed');assert.equal(result.models[0].rows,1);
assert.equal(result.models[0].maxAbsolute,0);
assert.equal(result.models[0].thresholdDisagreements,0);
for(const [name,change,pattern] of [
  ['missing',v=>v.models[0].artifact.path+='-absent',/ENOENT/],
  ['wrong-hash',v=>v.models[0].dataset.sha256='bad',/dataset hash/],
  ['partial',v=>v.models[0].predictions.rows=2,/prediction byte count/],
  ['empty',v=>v.models=[],/nonempty/],
  ['fallback',v=>v.backend.device='cpu',/MLX GPU/],
]) {
  const value=structuredClone(training);change(value);
  const failed=await run(value,name);assert.equal(failed.status,'failed');assert.match(failed.error,pattern);
  const persisted=JSON.parse(await fs.readFile(path.join(root,name,'report.json')));
  assert.equal(persisted.status,'failed');assert.ok(persisted.phase);
}
console.log('frozen prediction conformance failure contracts passed');
