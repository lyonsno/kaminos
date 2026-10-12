import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildOpticalHierarchy} from '../volume-optical-refinement.mjs';
const root=path.resolve(import.meta.dirname,'..');
assert.ok(fs.existsSync(root+'/scripts/replay-optical-predictions.mjs'),'missing saved-prediction controller replay');
const {compareRayPolicies}=await import('../scripts/replay-optical-predictions.mjs');
const probe=e=>({sigma:0,emission:[e,0,0],scattered:[0,0,0],flags:[0,0]});
const probes=Array.from({length:65},()=>probe(0));
probes[5]=probe(8);probes[6]=probe(16);probes[7]=probe(8);
const tree=buildOpticalHierarchy(probes,{length:1,rootSpan:32,probeCount:5});
const nodes=new Map(),pending=[...tree.roots];
while(pending.length){const n=pending.pop();nodes.set(`${n.start}:${n.end}`,n);pending.push(...n.children);}
const numeric=({start,h})=>nodes.get(`${start}:${start+Math.round(h/tree.spacing)}`).numericalError;
const matched=compareRayPolicies(tree,numeric,[1,1,1,1],[.001]);
assert.equal(matched.length,3);
const ordinary=matched.find(r=>r.policy==='numerical'),learned=matched.find(r=>r.policy==='predicted');
assert.deepEqual(learned.transfer,ordinary.transfer);
assert.deepEqual(learned.error,ordinary.error);
assert.equal(learned.uniqueProbeCount,ordinary.uniqueProbeCount);
assert.equal(learned.predictionQueries,2);
assert.equal(ordinary.predictionQueries,0);
assert.equal(learned.missedBrightSegments,1,'bright missed sheet must not disappear into global averages');
assert.equal(learned.brightSegments,1);
assert.equal(learned.unresolvedReferenceCount,ordinary.unresolvedReferenceCount);
const unresolved=Array.from({length:65},()=>probe(0));unresolved[5]=probe(32);
const uncertain=compareRayPolicies(buildOpticalHierarchy(unresolved,{length:1,rootSpan:32,probeCount:5}),()=>[0,0,0,0],[1,1,1,1],[.001]);
assert.ok(uncertain.find(r=>r.policy==='predicted').unresolvedReferenceCount>0,'finite-reference uncertainty is retained');
assert.throws(()=>compareRayPolicies(tree,()=>undefined,[1,1,1,1],[.001]),/prediction/);
assert.throws(()=>compareRayPolicies(tree,numeric,[1,1,1,1],[NaN]),/tolerance/);
const base=fs.mkdtempSync(path.join(os.tmpdir(),'optical-prediction-'));
fs.writeFileSync(base+'/training.json',JSON.stringify({identity:'optical-quantile-pilot-v0',status:'running'}));
const result=spawnSync(process.execPath,['scripts/replay-optical-predictions.mjs',base+'/training.json',base+'/out'],{cwd:root,encoding:'utf8'});
assert.equal(result.status,1);
const report=JSON.parse(fs.readFileSync(base+'/out/report.json'));
assert.equal(report.status,'failed');assert.equal(report.phase,'training');
assert.match(report.error,/complete trained pilot/);
assert.equal(report.training.sha256.length,64);
// Synthetic trace-format fixture checks replay wiring, not the native producer.
const sha=b=>createHash('sha256').update(b).digest('hex'),sources=[],files=[];
const values=new Float32Array(65*32);
for(let s=0;s<65;s++)values.set([0,s,1,1,s/64,0,1,.1,0,0,0,.5,0,0,1,.1,0,1,0,0,0,0,0,0,0,1,.1,0,.5,.5,.5,1],s*32);
const trace=Buffer.from(values.buffer),chunkPath='trace-auto.f32';fs.writeFileSync(base+'/'+chunkPath,trace);
const capture={chunks:[{path:chunkPath,sha256:sha(trace),plan:{sampleCount:65,subdivisions:64,rayCount:1,rowCount:65,firstRay:0,sampleOffset:0}}]};
fs.writeFileSync(base+'/capture.json',JSON.stringify(capture));
sources.push({path:base+'/capture.json',sha256:sha(fs.readFileSync(base+'/capture.json')),step:229,yaw:0,split:'test',rays:1});
const models=[];
for(const n of [3,5]) {
  const flatTree=buildOpticalHierarchy(Array.from({length:65},()=>probe(1)),{length:1,rootSpan:32,probeCount:n});
  const pending=[...flatTree.roots],rows=[];
  while(pending.length){const node=pending.pop();rows.push({case:'229:0',chunk:chunkPath,ray:0,split:'test',start:node.start,end:node.end});pending.push(...node.children);}
  const file=base+`/rows${n}.jsonl`,data=rows.map(r=>JSON.stringify(r)+'\n').join('');fs.writeFileSync(file,data);
  const source={probeCount:n,path:file,sha256:sha(data)};files.push(source);
  const predictions=Buffer.alloc(rows.length*16),predictionPath=base+`/predictions${n}.f32`;fs.writeFileSync(predictionPath,predictions);
  models.push({probeCount:n,dataset:source,predictions:{path:predictionPath,sha256:sha(predictions),rows:rows.length},numericalCalibration:{factors:[1,1,1,1]}});
}
const dataset={identity:'optical-probe-dataset-v0',status:'observed',phase:'complete',rootSpan:32,sources,files};
fs.writeFileSync(base+'/dataset.json',JSON.stringify(dataset));
const training={identity:'optical-quantile-pilot-v0',status:'trained',phase:'complete',backend:{name:'mlx',device:'Device(gpu, 0)'},
  dataset:{path:base+'/dataset.json',sha256:sha(fs.readFileSync(base+'/dataset.json'))},models};
function run(name,document=training) {
  fs.writeFileSync(base+'/training.json',JSON.stringify(document));
  const r=spawnSync(process.execPath,['scripts/replay-optical-predictions.mjs',base+'/training.json',base+'/'+name,'.001'],{cwd:root,encoding:'utf8'});
  return {process:r,report:JSON.parse(fs.readFileSync(base+'/'+name+'/report.json'))};
}
const good=run('good');assert.equal(good.process.status,0,good.report.error);
assert.equal(Object.keys(good.report.summaries).length,6);
assert.equal(good.report.arms[0].rays,1);
assert.equal(good.report.summaries['5:test:predicted:0.001'].meanProbes,9);
assert.equal(good.report.summaries['5:test:predicted:0.001'].rgb.max,0);
const wrongRoute=run('fallback',{...training,backend:{name:'mlx',device:'Device(cpu, 0)'}});
assert.equal(wrongRoute.process.status,1);assert.equal(wrongRoute.report.status,'failed');
const incomplete=structuredClone(training);incomplete.models[0].predictions.rows--;
assert.match(run('partial',incomplete).report.error,/prediction row count/);
fs.mkdirSync(base+'/output-error/rays.jsonl',{recursive:true});
const badOutput=run('output-error');assert.equal(badOutput.report.status,'failed');assert.equal(badOutput.report.phase,'outputs');
fs.appendFileSync(models[0].predictions.path,Buffer.from([0]));
assert.match(run('tampered').report.error,/prediction hash mismatch/);
console.log('saved predictions use the shared controller, charge probes, retain bright misses and fail incomplete training');
