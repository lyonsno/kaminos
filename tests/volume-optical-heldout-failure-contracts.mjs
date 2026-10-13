import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {replayHeldout} from '../scripts/replay-smokey-heldout.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'optical-heldout-contract-'));
const sha=b=>createHash('sha256').update(b).digest('hex');
async function save(name,value){const file=path.join(root,name),b=Buffer.isBuffer(value)?value:JSON.stringify(value);await fs.writeFile(file,b);return {path:file,sha256:sha(b)};}
const models=[];
for(const n of [3,5]) {
  const width=9*n+8,dataset=await save(`rows${n}.jsonl`,{features:Array(width).fill(0),split:'train',resolved:true});
  const architecture=[width,32,32,4],artifact=await save(`model${n}.json`,{identity:'optical-error-mlp-v0',probeCount:n,
    architecture,activations:['relu','relu','softplus'],mean:Array(width).fill(0),scale:Array(width).fill(1),targetScale:Array(4).fill(1e-8),dataset,
    layers:architecture.slice(1).map((size,i)=>({weights:Array.from({length:size},()=>Array(architecture[i]).fill(0)),bias:Array(size).fill(0)}))});
  models.push({probeCount:n,artifact,dataset,numericalCalibration:{factors:[1,1,1,1]}});
}
const training=await save('training.json',{identity:'optical-quantile-pilot-v0',status:'trained',phase:'complete',models});
const variants=['baseline','radius-half','radius-double','fuel-half','fuel-double','temperature-half','temperature-double','all-half','all-double'];
const manifest={identity:'smokey-heldout-capture-v1',status:'observed',phase:'complete',mode:'sweep',source:'synthetic',cases:[]};
const chunks=[];
for(let row=1;row<=9;row++) {
  const data=new Float32Array(577*32);
  for(let i=0;i<577;i++){const at=i*32;data[at]=row;data[at+1]=i;data[at+2]=data[at+3]=1;data[at+4]=i/576;data[at+6]=1;data[at+12]=1;data[at+15]=.1;}
  const name=`trace-${row/10}-force-full.f32`,bytes=Buffer.from(data.buffer);await fs.writeFile(path.join(root,name),bytes);
  chunks.push({path:name,sha256:sha(bytes),ok:true,plan:{firstRay:row,rayCount:1,sampleOffset:0,sampleCount:577,subdivisions:576,width:1,height:10,rowCount:577},
    effective:{route:'native-3d-compute-fluid-raymarch-v0',backend:'WebGPU:apple',simStepCount:197,specialization:{effective:'full-authored-raymarch-v0'}}});
}
for(const variant of variants)for(const step of [197,229])for(const yaw of [0,-15]) {
  const dir=path.join(root,`${variant}-${step}-${yaw}`);await fs.mkdir(dir);
  const camera={position:[0,0,1],target:[0,0,0],up:[0,1,0]};
  const capture={identity:'ordered-optical-capture-conformance-v0',status:'observed',phase:'complete',source:'synthetic',diff:'',
    requested:{heldStep:step,yaw,subdivisions:576},requestedCamera:camera,effectiveCamera:camera,
    state:{simStepCount:step,backend:'WebGPU:apple',effectiveRoute:'native-3d-compute-fluid-raymarch-v0',immersedSource:{effective:{admitted:true}}},
    chunks:chunks.map(c=>({...c,effective:{...c.effective,simStepCount:step}})),emitting:false};
  await fs.writeFile(path.join(dir,'report.json'),JSON.stringify(capture));
  await fs.writeFile(path.join(dir,'source-basin.json'),JSON.stringify({presetId:variant}));
  for(const c of chunks)await fs.symlink(path.join(root,c.path),path.join(dir,c.path));
  manifest.cases.push({variant,step,yaw,status:'observed',path:dir,presetId:variant});
}
const source=await save('manifest.json',manifest);
const good=await replayHeldout(source.path,training.path,path.join(root,'good'));
assert.equal(good.status,'observed',good.error);assert.equal(good.sources.length,36);
assert.equal(good.summaries['physical:5:predicted:0.001'].rays,324);
assert.equal(good.summaries['synthetic-amplitude:5:predicted:0.001'].rays,72);
assert.equal(good.summaries['physical:5:predicted:0.001'].rgb.max,0);
const first=manifest.cases[0],capturePath=path.join(first.path,'report.json');
const original=JSON.parse(await fs.readFile(capturePath));
for(const [name,edit,pattern] of [
  ['fallback',c=>c.state.backend='WebGPU:swiftshader',/WebGPU:apple/],
  ['partial',c=>c.chunks.pop(),/nine scanlines/],
  ['dirty',c=>c.diff='changed',/changed/],
  ['stale-step',c=>c.state.simStepCount=196,/196/],
  ['wrong-trace',c=>c.chunks[0].sha256='wrong',/trace hash/],
]) {
  const c=structuredClone(original);edit(c);await fs.writeFile(capturePath,JSON.stringify(c));
  const result=await replayHeldout(source.path,training.path,path.join(root,name));
  assert.equal(result.status,'failed');assert.match(result.error,pattern);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,name,'report.json'))).status,'failed');
}
console.log('held-out synthetic plumbing retains inactive cases and rejects fallback, partial, stale and mismatched output');
