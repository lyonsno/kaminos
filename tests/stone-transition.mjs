// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createStoneTransitionSource,stoneTransitionRegion} from '../stone-transition-source.mjs';
const run=promisify(execFile);
test('stone source preserves flat centers, inward detail, backing and repeat identity',()=>{
 const a=createStoneTransitionSource({cells:4,halo:0}),b=createStoneTransitionSource({cells:4,halo:1});
 assert.deepEqual(a,createStoneTransitionSource(a.config));assert.equal(a.stones.length,4);
 assert.equal(b.triangles.length,a.triangles.length*9);
 assert.equal(a.triangles.filter(t=>t.kind==='backing').length,2);
 const points=a.triangles.flatMap(t=>[t.a,t.b,t.c]);
 assert.ok(points.every(p=>p[1]<=1e-12));assert.ok(points.some(p=>p[1]===0));
 assert.ok(points.some(p=>p[1]<-.04));assert.ok(a.referenceHeight>.00001);
 assert.equal(stoneTransitionRegion([.25,.25],a.config).flat,true);
 assert.equal(stoneTransitionRegion([.5,.25],a.config).weight,1);
 assert.deepEqual(stoneTransitionRegion([.25,.25],a.config),stoneTransitionRegion([1.25,-.75],a.config));
 const base=a.triangles[0],repeat=b.triangles.find(t=>t.identity===base.identity+'@1,0');
 assert.ok(repeat);assert.equal(repeat.a[0]-base.a[0],a.config.width);
});
test('stone fit route validates its source before touching GPU and preserves failure',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stone-transition-route-'));
 try{
  const config=path.join(dir,'config.json'),out=path.join(dir,'out');
  await fs.writeFile(config,JSON.stringify({sourceKind:'stone-transition',source:{cells:0}}));
  await assert.rejects(run(process.execPath,['tools/ground-material-fit.mjs',config,out],{cwd:process.cwd(),env:{...process.env,GREENROOM_JOB_ID:'negative-source-validation'}}));
  const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
  assert.equal(report.phase,'configuration');assert.equal(report.adapter,undefined);
  assert.match(report.error,/Invalid stone transition/);
 }
 finally{await fs.rm(dir,{recursive:true,force:true});}
});
