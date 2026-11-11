// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
import {createStoneTransitionSource} from '../stone-transition-source.mjs';
import {traceMasonryRay} from '../masonry-source.mjs';
import {stoneMaterialWindow,stoneWindowRegion,stoneWindowQuads,stoneWindowDisplayPositions} from '../stone-material-window.mjs';
import {stoneHandoffQuads} from '../stone-handoff-geometry.mjs';

test('reference translation preserves actual source hits, identities and flat endpoints',()=>{
 const source=createStoneTransitionSource({cells:12,halo:1}),window=stoneMaterialWindow(source,{uvOrigin:[.375,.125],uvScale:.25});
 assert.equal(window.triangles.length,source.triangles.length);assert.equal(window.captureDomain.width,.7);
 assert.equal(stoneWindowRegion([.75,.5],window).flat,true);assert.equal(stoneWindowRegion([.5,.5],window).flat,false);
 for(const x of [-.2,-.1,-.02,0,.02,.1,.2]){
  const ray={origin:[x,.5,.03],direction:[.1,-1,.05]},a=traceMasonryRay(window,ray),b=traceMasonryRay(source,{...ray,origin:ray.origin.map((v,i)=>v+window.window.worldCenter[i])});
  assert.equal(a.hit,true);assert.equal(a.triangleId,b.triangleId);assert.equal(a.region,b.region);
  a.position.forEach((v,i)=>assert.ok(Math.abs(v+window.window.worldCenter[i]-b.position[i])<1e-9));
 }
 for(const invalid of [null,{uvOrigin:[.9,0],uvScale:.25},{uvOrigin:[0,0],uvScale:0},{uvOrigin:[0,NaN],uvScale:.25}])assert.throws(()=>stoneMaterialWindow(source,invalid),/Invalid stone reference window/);
 assert.equal(stoneMaterialWindow(source,undefined),source);
 const positions=stoneWindowDisplayPositions(window.triangles,window.captureDomain);
 assert.ok(positions.length>0&&positions.length%9===0);assert.ok(positions.every((v,i)=>i%3===1||Math.abs(v)<=.350000000001));
 const quads=stoneWindowQuads(stoneHandoffQuads(source.config,{collar:.04}).quads,window.window);
 assert.ok(quads.length>0);assert.ok(quads.every(([a,b,c,d])=>a>=0&&b>=0&&c<=1&&d<=1));
 assert.ok(Math.abs(quads.reduce((sum,[a,b,c,d])=>sum+(c-a)*(d-b),0)-.24/.7)<1e-9);
});

test('actual fit command captures the requested physical window without rescaling the stone',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stone-window-contract-'));
 try{
  // This route stops at the first teacher call. It tests command configuration,
  // not a GPU/backend contract, and cannot launch an accelerator.
  const loader=path.join(dir,'loader.mjs');
  await fs.writeFile(loader,`export async function resolve(s,c,next){
   if(s.endsWith('/surface-material-teacher.mjs'))return {url:'data:text/javascript,'+encodeURIComponent(\`import fs from 'node:fs';export class SurfaceMaterialTeacher{constructor(device,source){this.source=source;}async evaluateMaterial(q,capture){fs.writeFileSync(process.env.STONE_WINDOW_PROBE,JSON.stringify({source:this.source,capture,queries:Array.from(q)}));throw Error('intentional teacher-call stop');}dispose(){}}\`),shortCircuit:true};
   if(s.endsWith('/shader-herder.mjs'))return {url:'data:text/javascript,'+encodeURIComponent('export async function withKaminosGpu(fn){await fn({device:{},adapterInfo:{route:"configuration-fixture"}})};export async function withGpuErrorScopes(d,n,fn){return fn()}'),shortCircuit:true};return next(s,c);}`);
  const config=path.join(dir,'config.json'),probe=path.join(dir,'probe.json'),out=path.join(dir,'out');
  await fs.writeFile(config,JSON.stringify({sourceKind:'stone-transition',source:{cells:4,halo:0},window:{uvOrigin:[.375,.125],uvScale:.25},fit:{resolution:128,steps:1,batch:1,queries:1,heldout:1,samples:1,heldoutSamples:1,bounces:1}}));
  await assert.rejects(run(process.execPath,['--loader',loader,'tools/ground-material-fit.mjs',config,out],{cwd:process.cwd(),env:{...process.env,GREENROOM_JOB_ID:'configuration-fixture-only',STONE_WINDOW_PROBE:probe}}));
  const observed=JSON.parse(await fs.readFile(probe,'utf8'));
  assert.equal(observed.capture.tileSize,.7,'fit ignored the requested physical reference width');
  assert.equal(observed.capture.tileDepth,.7);assert.equal(observed.capture.resolution,128);
  assert.equal(observed.source.config.width,2.8,'window rescaled the actual stones');
  assert.deepEqual(observed.source.window.worldCenter,[0,0,-.7]);
  assert.ok(observed.source.triangles.some(t=>t.a[2]>1.4),'surrounding source context was discarded');
  const invalidOut=path.join(dir,'invalid-comparison');
  const invalid=JSON.parse(await fs.readFile(config,'utf8'));invalid.comparisonSize=0;
  await fs.writeFile(config,JSON.stringify(invalid));await fs.rm(probe);
  await assert.rejects(run(process.execPath,['--loader',loader,'tools/ground-material-fit.mjs',config,invalidOut],{cwd:process.cwd(),env:{...process.env,GREENROOM_JOB_ID:'configuration-fixture-only',STONE_WINDOW_PROBE:probe}}));
  const failure=JSON.parse(await fs.readFile(path.join(invalidOut,'report.json'),'utf8'));
  assert.equal(failure.phase,'configuration','invalid comparison size reached the accelerator route');
  assert.match(failure.error,/comparison size/i);
  await assert.rejects(fs.access(probe));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
