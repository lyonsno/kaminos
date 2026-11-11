// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as witness from '../tools/particle-carrier-witness.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const settings={enabled:true,acquisitionMode:1,capacity:8192,acquisitionSamples:2048,depthMode:1,depthSlices:16,targetScale:.5,depthScale:.5,exchangeStrength:1,exchangeCellSize:1,stateLife:1,followFraction:.75,debugView:0};
function state(){return {active:true,backend:'webgpu:apple',effectiveRoute:'native-3d-compute-fluid-raymarch-v0',gridHeight:{widthCells:8,heightCells:12},worldSmoke:{effective:'off'},simStepCount:28,simulationPaused:true,width:2,height:2,splitIntegral:{effective:'source-observations',freshEvaluations:1},opticalParticles:{effective:'world-optical-particles',recordFloats:24,slots:8192,freshSamples:2048,outputSize:[2,2],targetSize:[1,1],effectiveDepthMode:1,depthField:{width:1,height:1,slices:16},step:28,frames:30,reset:false,settings:{...settings},exchange:{grouping:'gpu-count-exclusive-prefix-scatter',cellDims:[8,12,8],cellCount:768,bytes:1000}},simulationReaction:{burnTime:3,cooling:30,heatRelease:4,sootYield:2,smokeLife:100}};}
test('carrier witness rejects missing or fallback native grouping and effective configuration drift',()=>{
 witness.verifyCarrierState(state(),settings);
 const fallback=state();fallback.effectiveRoute='demo';assert.throws(()=>witness.verifyCarrierState(fallback,settings),/route/i);
 const backend=state();backend.backend='wasm';assert.throws(()=>witness.verifyCarrierState(backend,settings),/backend|webgpu/i);
 const missing=state();delete missing.opticalParticles.exchange;assert.throws(()=>witness.verifyCarrierState(missing,settings),/group|exchange/i);
 const cpu=state();cpu.opticalParticles.exchange.grouping='cpu-fallback';assert.throws(()=>witness.verifyCarrierState(cpu,settings),/group|exchange/i);
 const coarse=state();coarse.worldSmoke.effective='one-way-world-field';assert.throws(()=>witness.verifyCarrierState(coarse,settings),/single|coarse|world/i);
 const drift=state();drift.opticalParticles.settings.acquisitionSamples=1024;assert.throws(()=>witness.verifyCarrierState(drift,settings),/acquisitionSamples/);
});
test('requested settings cannot hide stale effective population, grouping or render allocations',()=>{
 const truncated=state();truncated.opticalParticles.slots=4096;assert.throws(()=>witness.verifyCarrierState(truncated,settings),/capacity|population|slots/i);
 const samples=state();samples.opticalParticles.freshSamples=1024;assert.throws(()=>witness.verifyCarrierState(samples,settings),/samples|acquisition/i);
 const grouping=state();grouping.opticalParticles.exchange.cellDims=[4,6,4];grouping.opticalParticles.exchange.cellCount=96;assert.throws(()=>witness.verifyCarrierState(grouping,settings),/group|cell/i);
 const target=state();target.opticalParticles.targetSize=[2,2];assert.throws(()=>witness.verifyCarrierState(target,settings),/target|size/i);
 const slices=state();slices.opticalParticles.depthField.slices=8;assert.throws(()=>witness.verifyCarrierState(slices,settings),/slices|depth/i);
});
function snapshot(){
 const current=state(),records=new Float32Array(8192*24);records.set([0,0,0,2,1,2,3,.1,2,1,.2,1,0,0,0,.2,1,0,1,1,1,1,.1,3]);
 return {state:current,frame:{ok:true,effectiveRoute:current.effectiveRoute,backend:current.backend,simStepCount:28,simAdvanced:false,renderPhaseTimeMs:1000,renderPhaseFrame:8},available:true,particleState:{step:28,slots:8192,frames:30},records,image:{width:2,height:2,rgba:Buffer.from([255,100,20,255,0,0,0,255,0,0,0,255,0,0,0,255])}};
}
test('snapshot guard rejects missing, partial, blank and stale primary evidence',()=>{
 const good=snapshot();assert.equal(witness.verifyCarrierSnapshot(good,settings).active,1);
 const partial=snapshot();partial.records=new Float32Array(24);assert.throws(()=>witness.verifyCarrierSnapshot(partial,settings),/partial.*population/);
 const absent=snapshot();absent.available=false;assert.throws(()=>witness.verifyCarrierSnapshot(absent,settings),/missing retained/);
 const image=snapshot();image.image.rgba=Buffer.alloc(4);assert.throws(()=>witness.verifyCarrierSnapshot(image,settings),/partial.*image/);
 const dark=snapshot();dark.image.rgba=Buffer.alloc(16);assert.throws(()=>witness.verifyCarrierSnapshot(dark,settings),/blank native image/);
 assert.equal(witness.verifyCarrierSnapshot(dark,settings,{allowBlank:true}).nonblank,false,'an explicitly labeled diagnostic may reveal zero material');
 const noCarriers=snapshot();noCarriers.records.fill(0);assert.throws(()=>witness.verifyCarrierSnapshot(noCarriers,settings),/blank active/);
 const stale=snapshot();stale.particleState.step=27;assert.throws(()=>witness.verifyCarrierSnapshot(stale,settings),/stale/);
 const reset=snapshot();reset.state.opticalParticles.reset=true;assert.throws(()=>witness.verifyCarrierSnapshot(reset,settings),/reset/);
 const invalid=snapshot();invalid.records[20]=NaN;assert.throws(()=>witness.verifyCarrierSnapshot(invalid,settings),/nonfinite/);
});
test('pause comparison rejects state mutation and preserves pixel drift as a separate measured observation',()=>{
 const live=snapshot(),paused=snapshot();live.state.simulationPaused=false;live.frame.simAdvanced=true;paused.image.rgba[0]-=17;
 const result=witness.verifyCarrierPause(live,paused);assert.equal(result.recordsExact,true);assert.equal(result.image.exact,false);assert.equal(result.image.changedPixels,1);assert.equal(result.image.absoluteChannelDelta,17);assert.equal(result.image.maxChannelDelta,17);
 const mutated=snapshot();mutated.records[20]+=.1;let disputed;assert.throws(()=>witness.verifyCarrierPause(live,mutated,observation=>{disputed=observation;}),/changed.*bytes/);assert.equal(disputed.recordsExact,false);assert.equal(disputed.image.exact,true,'image evidence must remain available when the carrier assertion fails');
 const advanced=snapshot();advanced.state.simStepCount++;assert.throws(()=>witness.verifyCarrierPause(live,advanced),/advanced simulation/);
});
test('development history rejects cached successful frames and partial runs',()=>{
 assert.deepEqual(witness.verifyCarrierAdvanceHistory([{ok:true,step:3},{ok:true,step:4}],2,2),{start:2,end:4,count:2});
 assert.throws(()=>witness.verifyCarrierAdvanceHistory([{ok:true,step:3},{ok:true,step:3}],2,2),/cached|nonadvancing/);assert.throws(()=>witness.verifyCarrierAdvanceHistory([{ok:true,step:3}],2,2),/partial/);
});
test('continued evidence requires motion, composition and survival rather than age or newly initialized emission',()=>{
 const a=new Float32Array(24);a.set([0,0,0,2,1,2,3,.1,2,1,.2,1,0,0,0,.2,1,0,1,1,1,1,.1,3]);const b=a.slice();b[3]++;
 assert.throws(()=>witness.verifyCarrierProgress(a,b),/motion/);b[0]=.1;assert.throws(()=>witness.verifyCarrierProgress(a,b),/composition/);b[20]=.8;assert.throws(()=>witness.verifyCarrierProgress(a,b),/survival/);b[15]=.3;b[8]=.8;
 assert.deepEqual(witness.verifyCarrierProgress(a,b),{retained:1,moved:1,materialChanged:1,survivalAdvanced:1},'current intrinsic emission may evolve without impersonating replacement');
});
test('follow evidence must count consumed source rows from the same actual step',()=>{
 const statistics={available:true,identity:{step:28},followed:3,evaluated:2048};assert.equal(witness.verifyCarrierFollow(statistics,28).followed,3);
 assert.throws(()=>witness.verifyCarrierFollow({...statistics,followed:undefined},28),/consumed/);assert.throws(()=>witness.verifyCarrierFollow({...statistics,followed:0},28),/consumed/);assert.throws(()=>witness.verifyCarrierFollow(statistics,29),/stale/);assert.throws(()=>witness.verifyCarrierFollow({...statistics,followed:2049},28),/exceed/);
});
test('recipe rejects accidental budget/config substitution without truncating caller-authored step counts',()=>{
 assert.equal(witness.carrierRecipe({url:'/index.html',developSteps:93}).developSteps,93);
 assert.equal(witness.carrierRecipe({url:'/index.html',source:{raySteps:160}}).source.raySteps,160,'authored ray budget must not be silently capped');
 assert.throws(()=>witness.carrierRecipe({url:'/index.html',particles:{capacity:4096}}),/config capacity/);assert.throws(()=>witness.carrierRecipe({url:'/index.html',particles:{depthSlices:8}}),/config depthSlices/);assert.throws(()=>witness.carrierRecipe({url:'/index.html',developSteps:0}),/step counts/);
});
test('diagnostic views retain requested depth settings while explicitly exposing unsliced unassisted rendering',()=>{
 const diagnostic=state(),expected={...settings,debugView:1,fillExtinction:1};diagnostic.opticalParticles.settings={...expected};diagnostic.opticalParticles.effectiveDepthMode=0;diagnostic.opticalParticles.depthField=null;diagnostic.opticalParticles.gridAssist={requested:true,effective:'off',effectiveStrength:0};
 witness.verifyCarrierState(diagnostic,expected);
 const hiddenAssist=structuredClone(diagnostic);hiddenAssist.opticalParticles.gridAssist.effective='current-single-grid-extinction';assert.throws(()=>witness.verifyCarrierState(hiddenAssist,expected),/diagnostic|assist/);
 const wrongDepth=structuredClone(diagnostic);wrongDepth.opticalParticles.effectiveDepthMode=1;assert.throws(()=>witness.verifyCarrierState(wrongDepth,expected),/diagnostic|depth/i);
 const normal=state();normal.opticalParticles.effectiveDepthMode=0;assert.throws(()=>witness.verifyCarrierState(normal,settings),/depth/i);
});
test('raw disputed image and complete records are retained before a snapshot guard rejects the evidence',async()=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'carrier-witness-artifact-'));try{const bad=snapshot();bad.image.rgba=Buffer.alloc(4);const saved=await witness.writeCarrierSnapshot(out,'partial',bad);assert.throws(()=>witness.verifyCarrierSnapshot(bad,settings),/partial/);assert.equal((await fs.stat(saved.files.records)).size,8192*96);assert.deepEqual(await fs.readFile(saved.files.rgba),Buffer.alloc(4));const metadata=JSON.parse(await fs.readFile(saved.files.metadata));assert.equal(metadata.image.bytes,4);assert.equal(metadata.state.effectiveRoute,state().effectiveRoute);}finally{await fs.rm(out,{recursive:true});}
});
test('wrong runtime source fails before browser loading and leaves a durable terminal phase and source receipt',async()=>{
 const server=http.createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({source:{commit:'stale',repoRoot:'/wrong',dirty:false}}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const out=await fs.mkdtemp(path.join(os.tmpdir(),'carrier-witness-runtime-'));
 try{const recipePath=path.join(out,'recipe.json');await fs.writeFile(recipePath,JSON.stringify({url:'/index.html'}));const report=await witness.runParticleCarrierWitness({origin:`http://127.0.0.1:${server.address().port}`,out,expectedCommit:'requested',repoRoot:'/requested',recipePath,playwrightModule:'must-never-import',ChromeForTesting:'/must-never-launch'});assert.equal(report.status,'failed');assert.equal(report.failurePhase,'runtime');assert.match(report.error,/wrong source revision/);assert.equal(report.effectiveExecutable,undefined);assert.equal(report.runtime.source.commit,'stale');const persisted=JSON.parse(await fs.readFile(path.join(out,'report.json')));assert.equal(persisted.failurePhase,'runtime');assert.equal(persisted.status,'failed');assert.deepEqual(persisted.snapshots,[]);}finally{await new Promise(resolve=>server.close(resolve));await fs.rm(out,{recursive:true});}
});
