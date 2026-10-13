// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {VOLUME_UNIFORM_FLOATS} from '../volume-core.js';
import {getSceneObjectRecords} from '../scene-persistence-core.js';
import {FIRE_DOMAIN_ID,FIRE_DOMAIN_TYPE,FIRE_DOMAIN_SOURCE} from '../scene-fire-domain.mjs';
import {OPTICAL_TRACE_IDENTITY,traceChunkPlan,validateTraceSpecialization,compareOpticalTraces} from '../volume-optical-trace.mjs';

// Execute the driver's capture loop and actual terminal/failure handling. Browser
// and filesystem substitutes establish admission policy, not native GPU behavior.
const script=readFileSync(new URL('../scripts/capture-optical-trace.mjs',import.meta.url),'utf8');
const body='try {\n'+script.slice(script.indexOf('  for(const fraction of'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
// Exercise the actual load admission, including legacy burner migration.
const scene={objects:[{id:'kiln',type:'glb',source:'/kiln.glb'},
  {id:'flame-emitter',type:'flame-emitter',source:'kaminos:analytic-flame'},
  {id:'burner',type:'burner-bed',source:'kaminos:annular-bed',burner:{schema:'kaminos.annular-burner.v1'},
    transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}]};
const identity=({id,type,source})=>({id,type,source});
const migrated=getSceneObjectRecords(scene).map(identity);
assert.equal(migrated.find(o=>o.id==='burner').type,'procedural-mesh');
const domain={id:FIRE_DOMAIN_ID,type:FIRE_DOMAIN_TYPE,source:FIRE_DOMAIN_SOURCE};
const loadBody=script.slice(script.indexOf('  await guard(page.waitForFunction(()=>window.kaminosSceneAuthoring'),script.indexOf('  report.hold='));
async function admit(objects) {
  const window={kaminosSceneAuthoring:{read:()=>({objects})}};
  const env={scene,report:{},assert,getSceneObjectRecords,FIRE_DOMAIN_ID,FIRE_DOMAIN_TYPE,FIRE_DOMAIN_SOURCE,
    guard:p=>p,page:{waitForFunction:async()=>{},evaluate:async fn=>new Function('window',`return (${fn})();`)(window)}};
  await new AsyncFunction(...Object.keys(env),loadBody)(...Object.values(env));
}
await admit([...migrated,domain]);
await admit(migrated);
for(const invalid of [migrated.slice(1),[...migrated,{...domain,id:'unrelated'}],
  [...migrated,domain,domain],migrated.map(o=>o.id==='kiln'?{...o,source:'/wrong.glb'}:o)]) {
  await assert.rejects(admit(invalid),assert.AssertionError);
}
const controls={physicalColorMode:2,toneMapping:'agx',boundarySidecarWidth:0,raySteps:36};
const light={model:'distributed-volume-direct-radiance-v0',source:'same-generation-raw-emission-extinction',
  support:'full-height-geometry-visible-receivers',generation:152,frame:151,receivers:8192,directions:24,legacyDispatched:false};
const state={effectiveRoute:'native-3d-compute-fluid-raymarch-v0',backend:'WebGPU:apple',simStepCount:151,
  controls,physicalColor:{incidentLight:light}};
const raw=new Float32Array(96);
for(let s=0;s<3;s++)raw.set([0,s,1,1,s/2,0,1,.1,0,0,0,.5,0,0,1,.04,1,1,-.002,2,0,0,0,0,0,1,.1,0,.5,.5,.5,1],s*32);
async function run(mutate=()=>{}) {
  const writes=new Map();let closed=false,generation=152;
  const report={status:'running',chunks:[],comparisons:[],errors:[],state:structuredClone(state)};
  const window={__kaminosVolumePrototype:{
    sampleOpticalTraceChunk:async options=>{
      const uniforms=Array(VOLUME_UNIFORM_FLOATS).fill(0);uniforms[368]=2;
      const chunk={ok:true,identity:OPTICAL_TRACE_IDENTITY,phase:'complete',
        plan:traceChunkPlan({...options,width:1,height:1,maxBytes:384}),
        values:raw.slice(),counts:{validRows:3,emittingRows:3},
        effective:{route:state.effectiveRoute,backend:state.backend,simStepCount:151,
          uniforms,controls:structuredClone(controls),incidentLight:{...light,generation:++generation},
          specialization:{effective:options.specialization==='auto'?'lean-emissive-raymarch-v0':'full-authored-raymarch-v0'}}};
      mutate(chunk,options);return chunk;
    },sampleFrame:async()=>({ok:true,image:{rgba:[1,2,3,255]}}),
  }};
  const environment={report,width:1,height:1,subdivisions:2,rgba:[1,2,3,255],out:'/synthetic',
    page:{evaluate:async(fn,options)=>new Function('window','options',`return (${fn})(options);`)(window,options),screenshot:async()=>{}},
    fs:{writeFile:async(path,bytes)=>writes.set(path,Buffer.from(bytes))},
    save:async()=>writes.set('/synthetic/report.json',JSON.stringify(report)),
    browser:{close:async()=>{closed=true;}},server:null,process:{exitCode:0},assert,createHash,
    validateTraceSpecialization,compareOpticalTraces,VOLUME_UNIFORM_FLOATS};
  await new AsyncFunction(...Object.keys(environment),body)(...Object.values(environment));
  assert.equal(closed,true);
  assert.equal(JSON.parse(writes.get('/synthetic/report.json')).status,report.status);
  return {report,writes,exitCode:environment.process.exitCode};
}
assert.equal((await run()).report.status,'observed');
assert.equal((await run(c=>{c.effective.additional='compatible';c.effective.controls.additional=42;c.effective.incidentLight.additional=true;})).report.status,'observed');
const cases=[
  ['missing route',c=>{delete c.effective.route;},/route/],
  ['fallback route',c=>{c.effective.route='fallback';},/route/],
  ['fallback backend',c=>{c.effective.backend='software-fallback';},/backend/],
  ['advanced state',c=>{c.effective.simStepCount=152;},/simStepCount/],
  ['missing uniforms',c=>{delete c.effective.uniforms;},/uniform/],
  ['empty uniforms',c=>{c.effective.uniforms=[];},/uniform/],
  ['nonfinite uniforms',c=>{c.effective.uniforms[42]=NaN;},/uniform/],
  ['wrong material',c=>{c.effective.uniforms[368]=1;},/uniform/],
  ['missing controls',c=>{delete c.effective.controls;},/control/],
  ['empty controls',c=>{c.effective.controls={};},/control/],
  ['changed control',c=>{c.effective.controls.raySteps=48;},/control/],
  ['missing lighting',c=>{delete c.effective.incidentLight;},/incident/],
  ['empty lighting',c=>{c.effective.incidentLight={};},/incident/],
  ['wrong lighting',c=>{c.effective.incidentLight.source='fallback';},/incident/],
  ['missing generation',c=>{delete c.effective.incidentLight.generation;},/generation/],
  ['invalid generation',c=>{c.effective.incidentLight.generation=-1;},/generation/],
  ['miss then hit',c=>{c.values[2]=0;},/mixed hit\/miss/],
  ['hit then miss',c=>{c.values[34]=0;},/mixed hit\/miss/],
];
for(const [name,mutate,reason] of cases) for(const arm of ['both','auto']) {
  const {report,writes,exitCode}=await run((chunk,options)=>{
    if(arm==='both'||options.specialization==='auto')mutate(chunk);
  });
  assert.equal(report.status,'failed',name);
  assert.equal(exitCode,1,name);
  assert.match(report.error,reason,name);
  assert.equal(report.chunks.length,arm==='both'&&!name.includes(' then ')?1:2,`${name}: reject at first applicable admission`);
  assert.ok(writes.has('/synthetic/trace-0.25-force-full.f32'),`${name}: retain raw before rejection`);
  assert.equal(report.chunks[0].sha256,createHash('sha256').update(writes.get('/synthetic/trace-0.25-force-full.f32')).digest('hex'));
}
console.log('actual capture loop rejects shared bad receipts and mixed rays, preserving raw data and failed reports');
