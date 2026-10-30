import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {MLS_ROUTE,analyzeMlsParticles} from '../mls-juice-contract.mjs';
import {sampleFrozenHill} from '../mls-hill-terrain.mjs';
import {bindMlsWitnessSource,validateServedMlsSource,MLS_WITNESS_FILES} from './mls-witness-source.mjs';

export function validateMlsWitness(report){
  validateServedMlsSource(report);
  assert.equal(report.route,MLS_ROUTE,'wrong effective fluid route');
  assert.equal(report.state?.runtime?.failure,null,'fluid failure');
  assert(report.state.runtime.frameCount>0,'no presented frames');
  assert(report.active>0,'no live native particles');
  assert.equal(report.nonfinite,0,'nonfinite particle state');
  assert.equal(report.outside,0,'particles escaped supported domain');
  assert(report.state.runtime.solver.clock.simulatedSeconds>=(report.seconds??4),'simulation did not advance');
  assert(report.video,'missing rendered motion recording');
  assert.deepEqual(report.pageErrors,[],'browser errors');
  assert.deepEqual(report.consoleErrors,[],'console or GPU validation errors');
  if(report.runtimeMapReads!==undefined)assert.equal(report.runtimeMapReads,0,'runtime GPU readback observed');
  if(report.requested?.terrainUrl){
    assert(report.terrainContact,'missing Hill contact evidence');
    assert.equal(report.state.runtime.solver.collision,'axis_aligned_domain_and_frozen_hill_triangles','wrong Hill contact route');
    assert.deepEqual(report.state.runtime.solver.terrain.source,report.terrainContact.source,'Hill source mismatch');
    assert.equal(report.terrainContact.penetrations,0,'Hill penetration');
    assert(report.terrainContact.touching>0,'no particles touching Hill');
    assert.equal(report.runtimeMapReads,0,'unverified runtime readback count');
  }
}
if(process.argv.includes('--self-test')){
  const good={route:MLS_ROUTE,state:{runtime:{failure:null,frameCount:2,solver:{clock:{simulatedSeconds:4}}}},active:1,nonfinite:0,outside:0,video:'observed.webm',pageErrors:[],consoleErrors:[],
    source:{root:'/expected',head:'observed'},servedSource:{schema:'kaminos.runtime-config.v0',source:{repoRoot:'/expected',commit:'observed',dirty:false}},
    expectedFiles:{'/mls-juice-host.mjs':'sha'},servedFiles:{'/mls-juice-host.mjs':{status:200,sha256:'sha'}}};
  validateMlsWitness(good);
  assert.throws(()=>validateMlsWitness({...good,requested:{terrainUrl:'/hill.json'}}),/Hill/);
  assert.throws(()=>validateMlsWitness({...good,runtimeMapReads:1}),/readback/);
  const hill={...good,requested:{terrainUrl:'/hill.json'},runtimeMapReads:0,terrainContact:{source:{commit:'x'},penetrations:0,touching:1},
    state:{runtime:{...good.state.runtime,solver:{...good.state.runtime.solver,collision:'axis_aligned_domain_and_frozen_hill_triangles',terrain:{source:{commit:'x'}}}}}};
  validateMlsWitness(hill);
  assert.throws(()=>validateMlsWitness({...hill,terrainContact:{...hill.terrainContact,source:{commit:'wrong'}}}),/source mismatch/);
  assert.throws(()=>validateMlsWitness({...hill,terrainContact:{...hill.terrainContact,penetrations:1}}),/penetration/);
  assert.throws(()=>validateMlsWitness({...hill,terrainContact:{...hill.terrainContact,touching:0}}),/touching/);
  assert.throws(()=>validateMlsWitness({...good,source:{root:'/expected',head:'observed'},servedSource:{source:{repoRoot:'/wrong',commit:'observed'}}}),/served source/);
  assert.throws(()=>validateMlsWitness({...good,servedSource:{...good.servedSource,source:{...good.servedSource.source,repoRoot:'/wrong'}}}),/root mismatch/);
  assert.throws(()=>validateMlsWitness({...good,servedSource:{...good.servedSource,source:{...good.servedSource.source,commit:'old'}}}),/revision mismatch/);
  assert.throws(()=>validateMlsWitness({...good,servedFiles:{'/mls-juice-host.mjs':{status:200,sha256:'stale'}}}),/bytes mismatch/);
  assert.throws(()=>validateMlsWitness({...good,servedFiles:{}}),/missing served source response/);
  for(const [key,value,message]of [['route','legacy',/route/],['active',0,/particles/],['nonfinite',1,/nonfinite/],['video',null,/recording/]])assert.throws(()=>validateMlsWitness({...good,[key]:value}),message);
  console.log('MLS witness false-route, empty-state, invalid-numerics and missing-video guards OK');process.exit(0);
}
const {values:a}=parseArgs({options:Object.fromEntries(['url','output','browser','playwright','seconds'].map(k=>[k,{type:'string'}]))});
const out=path.resolve(a.output);fs.mkdirSync(out,{recursive:true});
const report={status:'failed',phase:'input',argv:process.argv,at:new Date().toISOString(),pageErrors:[],consoleErrors:[],states:[],browserClosed:false,
  seconds:Number(a.seconds??4),evidenceScope:'synthetic moving nozzle in actual shared host; not live-hand feel or comparative performance'};
const save=()=>fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));save();let context,page;
try{
  assert(Number.isFinite(report.seconds)&&report.seconds>0,'invalid observation duration');
  report.source={root:process.cwd(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),diff:execFileSync('git',['diff','--stat'],{encoding:'utf8'})};
  for(const file of ['mls-juice-contract.mjs','mls-juice-solver.mjs','mls-juice-renderer.mjs','mls-juice-host.mjs','owner-live-fluid-session.mjs','experiments/mls-juice.experiment.mjs','vendor/splash-mls-mpm']){
    fs.mkdirSync(path.dirname(out+'/source/'+file),{recursive:true});fs.cpSync(file,out+'/source/'+file,{recursive:true});
  }
  fs.copyFileSync(new URL(import.meta.url),out+'/witness.mjs');
  report.browserExecutable=fs.realpathSync(a.browser);assert(!report.browserExecutable.includes('/Google Chrome.app/'),'independent browser required');
  report.requested=JSON.parse(new URL(a.url).searchParams.get('experiment_inputs')??'{}');
  const {chromium}=await import(pathToFileURL(a.playwright));report.phase='browser';save();
  context=await chromium.launchPersistentContext(out+'/profile',{executablePath:a.browser,headless:true,viewport:{width:1280,height:900},
    recordVideo:{dir:out+'/video',size:{width:1280,height:900}},args:['--use-mock-keychain','--password-store=basic','--autoplay-policy=no-user-gesture-required']});
  page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
  await page.addInitScript(()=>{window.hillWitnessMapReads=0;const original=GPUBuffer.prototype.mapAsync;GPUBuffer.prototype.mapAsync=function(mode,...args){if(mode&GPUMapMode.READ)window.hillWitnessMapReads++;return original.call(this,mode,...args);};});
  const terrainFile=report.requested.terrainUrl;
  if(terrainFile)assert(terrainFile.startsWith('/assets/')&&!terrainFile.includes('..'),'witness terrain must be a source-owned local asset');
  const verifySource=bindMlsWitnessSource({page,url:a.url,root:process.cwd(),files:[...MLS_WITNESS_FILES,'experiments/mls-juice.experiment.mjs',...(terrainFile?[terrainFile.slice(1)]:[])],out,report});
  report.phase='load';save();await page.goto(a.url);
  await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='mls-juice');
  report.initial=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  await verifySource();save();
  assert.equal(report.initial.runtime.requestedRoute,MLS_ROUTE);
  const requestedGrid=report.requested.gridSize??64;
  assert.deepEqual(report.initial.runtime.solver.domain.gridDimensions,Array.isArray(requestedGrid)?requestedGrid:[requestedGrid,requestedGrid,requestedGrid],'domain mismatch');
  assert.equal(report.initial.jetSpeed,report.requested.jetSpeed??1.955,'jet speed mismatch');
  report.phase='run';save();
  await page.getByRole('checkbox',{name:'Run',exact:true}).check();
  let state;
  do{
    state=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());report.states.push({epochMs:Date.now(),state});
    assert.equal(state.runtime.failure,null,'runtime failure');
    if(state.runtime.solver.clock.simulatedSeconds>=report.seconds)break;
    await page.waitForTimeout(100);
  }while(true);
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setRunning',false));
  report.runtimeMapReads=await page.evaluate(()=>window.hillWitnessMapReads);
  report.phase='native-state';save();
  const words=await page.evaluate(async()=>Array.from(await window.kaminosWorkbenchExperiments.invoke('snapshot')));
  fs.writeFileSync(out+'/particles.json',JSON.stringify(words));
  const runtime=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  Object.assign(report,analyzeMlsParticles(words,{capacity:runtime.runtime.solver.particleCount,grid:runtime.runtime.solver.domain.gridDimensions,cell:runtime.runtime.solver.domain.cellSize}));
  report.state=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());report.route=report.state.runtime.effectiveRoute;
  if(terrainFile){
    const hill=JSON.parse(fs.readFileSync(terrainFile.slice(1),'utf8')),domain=runtime.runtime.solver.domain;
    let penetrations=0,touching=0,covered=0,maxPenetration=0;
    for(let i=0;i<words.length;i+=20)if(words[i+3]>0){
      const p=[0,1,2].map(axis=>words[i+axis]*domain.cellSize+domain.originWorld[axis]);
      const ground=sampleFrozenHill(hill,p[0],p[2]);if(!ground)continue;covered++;
      const distance=(p[1]-ground.height)*ground.normal[1],penetration=domain.cellSize*.65-distance;
      maxPenetration=Math.max(maxPenetration,penetration);if(penetration>1e-4)penetrations++;
      if(Math.abs(penetration)<domain.cellSize*.1)touching++;
    }
    report.terrainContact={source:hill.source,penetrations,touching,covered,maxPenetration,authority:'paused_native_gpu_snapshot_against_source_triangles'};
  }
  await page.screenshot({path:out+'/surface.png'});
  report.video=await page.video().path();
  await context.close();context=null;report.browserClosed=true;
  validateMlsWitness(report);report.status='complete';report.phase='complete';
}catch(error){report.error=String(error);report.stack=error.stack;process.exitCode=1;
  if(page){try{report.failureState=await page.evaluate(()=>({experiment:window.kaminosWorkbenchExperiments?.state(),text:document.body.innerText}));await page.screenshot({path:out+'/failure.png'});}catch(cause){report.failureCaptureError=String(cause);}}
}finally{if(context){await context.close();report.browserClosed=true;}save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:out+'/report.json'}));
