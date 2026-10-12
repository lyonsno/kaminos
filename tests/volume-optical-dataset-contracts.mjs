import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
assert.ok(fs.existsSync(root+'/scripts/build-optical-dataset.mjs'),'missing native-capture dataset consumer');
const base=fs.mkdtempSync(path.join(os.tmpdir(),'optical-dataset-'));
const manifest=base+'/pilot.json';
for(const [name,document,reason] of [
  ['partial',{identity:'optical-state-view-pilot-v0',status:'running',cases:[]},/complete pilot/],
  ['empty',{identity:'optical-state-view-pilot-v0',status:'observed',phase:'complete',cases:[]},/12 state\/view/],
  ['duplicate',{identity:'optical-state-view-pilot-v0',status:'observed',phase:'complete',cases:Array(12).fill({step:151,yaw:0,split:'train',status:'observed',path:'/missing'})},/duplicate state\/view/],
]) {
  fs.writeFileSync(manifest,JSON.stringify(document));
  const out=base+'/'+name;
  const r=spawnSync(process.execPath,['scripts/build-optical-dataset.mjs',manifest,out],{cwd:root,encoding:'utf8'});
  assert.equal(r.status,1);const report=JSON.parse(fs.readFileSync(out+'/report.json'));
  assert.equal(report.status,'failed');assert.match(report.error,reason);
}
const source='synthetic-policy-fixture',cases=[];
const camera={position:[0,0,2],target:[0,0,0],up:[0,1,0]};
for(const step of [151,173,197,229])for(const yaw of [0,-15,15]) {
  const target=base+`/capture${step}-${yaw}`;fs.mkdirSync(target);
  const split=step===229?'test':step===197?'validation':yaw===15?'view-test':'train';
  cases.push({step,yaw,split,path:target,status:'observed'});
  const values=new Float32Array(577*32);
  for(let s=0;s<577;s++)values.set([0,s,1,1,s/576,0,1,.1,0,0,0,.5,0,0,1,.1,1,1,0,0,0,0,0,0,0,1,.1,0,.5,.5,.5,1],s*32);
  const bytes=Buffer.from(values.buffer),hash=createHash('sha256').update(bytes).digest('hex'),chunks=[];
  for(const fraction of [.25,.5,.75])for(const arm of ['force-full','auto']) {
    const file=`trace-${fraction}-${arm}.f32`;fs.writeFileSync(target+'/'+file,bytes);
    chunks.push({path:file,sha256:hash,plan:{sampleCount:577,subdivisions:576,rayCount:1,rowCount:577,firstRay:0,sampleOffset:0},
      effective:{route:'native-3d-compute-fluid-raymarch-v0',backend:'WebGPU:apple',simStepCount:step,
        specialization:{effective:arm==='auto'?'lean-emissive-raymarch-v0':'full-authored-raymarch-v0'}}});
  }
  fs.writeFileSync(target+'/report.json',JSON.stringify({source,diff:'',status:'observed',phase:'complete',
    requested:{heldStep:step,yaw,subdivisions:576},state:{simStepCount:step},chunks,
    comparisons:[{ok:true},{ok:true},{ok:true}],requestedCamera:camera,effectiveCamera:camera}));
}
fs.writeFileSync(manifest,JSON.stringify({identity:'optical-state-view-pilot-v0',source,status:'observed',phase:'complete',cases}));
function build(name){const out=base+'/'+name;const result=spawnSync(process.execPath,['scripts/build-optical-dataset.mjs',manifest,out],{cwd:root,encoding:'utf8'});return {result,report:JSON.parse(fs.readFileSync(out+'/report.json')),out};}
fs.mkdirSync(base+'/output-error/probes3.jsonl',{recursive:true});
const outputError=build('output-error');
assert.equal(outputError.result.status,1);
assert.equal(outputError.report.status,'failed','output-open failure must publish a terminal report');
assert.match(outputError.report.error,/EISDIR.*probes3\.jsonl/);
assert.equal(outputError.report.phase,'outputs');
assert.equal(outputError.report.inputSha256,createHash('sha256').update(fs.readFileSync(manifest)).digest('hex'));
assert.ok(fs.statSync(base+'/output-error/probes3.jsonl').isDirectory(),'failed output retained');
const good=build('good');assert.equal(good.result.status,0,good.report.error);
for(const n of [3,5]) {
  const rows=fs.readFileSync(good.out+`/probes${n}.jsonl`,'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(rows.length>0);assert.ok(rows.every(r=>r.features.length===9*n+8&&r.label.length===4&&r.resolved));
  assert.ok(rows.filter(r=>r.split==='train').every(r=>!r.case.endsWith(':15')));
  assert.ok(rows.every(r=>r.label.every(v=>v<1e-12)),'constant transfer labels');
}
const changed=cases[0].path+'/trace-0.25-auto.f32';fs.appendFileSync(changed,Buffer.from([0]));
const bad=build('bad-hash');assert.equal(bad.result.status,1);assert.match(bad.report.error,/hash mismatch/);
console.log('dataset rejects partial/duplicate/tampered captures and preserves split, feature and transfer contracts');
