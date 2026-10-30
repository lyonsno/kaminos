import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {MLS_ROUTE,analyzeMlsParticles} from '../mls-juice-contract.mjs';
import {bindMlsWitnessSource,validateServedMlsSource,validateMlsGoinRequest,MLS_WITNESS_FILES} from './mls-witness-source.mjs';

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
  if(report.requested?.goinPile){
    const pile=report.state.runtime.solver.bodies;
    validateMlsGoinRequest(pile,report.requested.goinPile);
    assert(pile.contacts>0,'no liquid/pile contact');
    assert(pile.timeSeconds>=(report.seconds??4),'pile clock stalled');
    assert(pile.bodies.every(b=>[...b.position,...b.velocity,...b.angularVelocity,...b.quaternion].every(Number.isFinite)),'nonfinite pile state');
    assert(report.goinDisplacement?.some(v=>v>.2),'pile not displaced');
  }
}
if(process.argv.includes('--self-test')){
  const good={route:MLS_ROUTE,state:{runtime:{failure:null,frameCount:2,solver:{clock:{simulatedSeconds:4}}}},active:1,nonfinite:0,outside:0,video:'observed.webm',pageErrors:[],consoleErrors:[],
    source:{root:'/expected',head:'observed'},servedSource:{schema:'kaminos.runtime-config.v0',source:{repoRoot:'/expected',commit:'observed',dirty:false}},
    expectedFiles:{'/mls-juice-host.mjs':'sha'},servedFiles:{'/mls-juice-host.mjs':{status:200,sha256:'sha'}}};
  validateMlsWitness(good);
  assert.throws(()=>validateMlsWitness({...good,requested:{goinPile:{count:24}}}),/pile/);
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
  const verifySource=bindMlsWitnessSource({page,url:a.url,root:process.cwd(),files:[...MLS_WITNESS_FILES,'experiments/mls-juice.experiment.mjs',
    ...(report.requested.goinPile?['mls-goin-pile.mjs','mls-goin-contact.wgsl','node_modules/cannon-es/dist/cannon-es.js']:[])],out,report});
  report.phase='load';save();await page.goto(a.url);
  await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='mls-juice');
  report.initial=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  await verifySource();save();
  assert.equal(report.initial.runtime.requestedRoute,MLS_ROUTE);
  const requestedGrid=report.requested.gridSize??64;
  assert.deepEqual(report.initial.runtime.solver.domain.gridDimensions,Array.isArray(requestedGrid)?requestedGrid:[requestedGrid,requestedGrid,requestedGrid],'domain mismatch');
  assert.equal(report.initial.jetSpeed,report.requested.jetSpeed??1.955,'jet speed mismatch');
  if(report.requested.goinPile)assert.equal(report.initial.runtime.solver.bodies.bodies.length,report.requested.goinPile.count??24,'requested pile missing');
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
  report.phase='native-state';save();
  const words=await page.evaluate(async()=>Array.from(await window.kaminosWorkbenchExperiments.invoke('snapshot')));
  fs.writeFileSync(out+'/particles.json',JSON.stringify(words));
  const runtime=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  Object.assign(report,analyzeMlsParticles(words,{capacity:runtime.runtime.solver.particleCount,grid:runtime.runtime.solver.domain.gridDimensions,cell:runtime.runtime.solver.domain.cellSize}));
  report.state=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());report.route=report.state.runtime.effectiveRoute;
  if(report.requested.goinPile){
    const pile=report.state.runtime.solver.bodies;
    assert(pile.steps>0,'goin clock stalled');
    assert(pile.contacts>0,'no liquid/goin contact');
    assert(pile.bodies.every(b=>[...b.position,...b.velocity,...b.angularVelocity,...b.quaternion].every(Number.isFinite)),'nonfinite goin state');
    report.goinDisplacement=pile.bodies.map((b,i)=>Math.hypot(...b.position.map((v,j)=>v-report.initial.runtime.solver.bodies.bodies[i].position[j])));
    assert(report.goinDisplacement.some(v=>v>.2),'liquid did not dislodge a goin');
  }
  await page.screenshot({path:out+'/surface.png'});
  report.video=await page.video().path();
  await context.close();context=null;report.browserClosed=true;
  validateMlsWitness(report);report.status='complete';report.phase='complete';
}catch(error){report.error=String(error);report.stack=error.stack;process.exitCode=1;
  if(page){try{report.failureState=await page.evaluate(()=>({experiment:window.kaminosWorkbenchExperiments?.state(),text:document.body.innerText}));await page.screenshot({path:out+'/failure.png'});}catch(cause){report.failureCaptureError=String(cause);}}
}finally{if(context){await context.close();report.browserClosed=true;}save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:out+'/report.json'}));
