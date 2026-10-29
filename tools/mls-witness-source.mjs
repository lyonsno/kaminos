import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {MLS_ROUTE} from '../mls-juice-contract.mjs';
import {RUNWAY_INPUTS} from '../experiments/hand-jet-runway.experiment.mjs';

export function resolveMlsHandRequest(experiment,inputs){
  assert(['hand-live','hand-browser-juice','hand-jet-runway'].includes(experiment),'unsupported hand experiment');
  return {particleCount:2400,fluidViscosity:.1,particleLifetimeSeconds:6,jetSpeed:1.15*1.7,sourceFlux:360,fluidGridSize:64,
    ...(experiment==='hand-jet-runway'?RUNWAY_INPUTS:{}),...inputs};
}

export function validateMlsHandRequest(state,requested){
  const solver=state.fingerJuice.runtime.solver;
  assert.equal(solver.particleCount,requested.particleCount,'capacity mismatch');
  assert.equal(solver.material.viscosity,requested.fluidViscosity,'viscosity mismatch');
  assert.equal(state.fingerJuice.packet.economics.lifetimeSeconds,requested.particleLifetimeSeconds,'packet lifetime mismatch');
  assert.equal(state.fingerJuice.packet.economics.jetSpeedWorldPerSecond,requested.jetSpeed,'jet speed mismatch');
  assert.equal(state.fingerJuice.load.requestedRate,requested.sourceFlux,'emission mismatch');
  const grid=requested.fluidGridSize;
  assert.deepEqual(solver.domain.gridDimensions,Array.isArray(grid)?grid:[grid,grid,grid],'domain mismatch');
}

export function validateMlsJetControl(before,after,speed){
  validateMlsHandWindow(before,after);
  assert.equal(after.sessionId,before.sessionId,'jet control restarted camera');
  assert.equal(after.fingerJuice.jetSpeedWorldPerSecond,speed,'jet control state unchanged');
  assert.equal(after.fingerJuice.packet.economics.jetSpeedWorldPerSecond,speed,'jet control packet unchanged');
  const active=after.fingerJuice.packet.emitters.filter(e=>e.active);
  assert(active.length>0,'jet control has no active emitters');
  for(const emitter of active)assert.equal(emitter.strength,speed,'jet control emitter unchanged');
  assert(after.fingerJuice.runtime.solver.liveInlets.totalAdmitted>=before.fingerJuice.runtime.solver.liveInlets.totalAdmitted,'jet control reset water');
}

export function validateMlsHandWindow(start,end){
  for(const state of [start,end]){
    assert.equal(state?.running,true,'hand stopped during populated window');
    assert.equal(state.starting,false);assert.equal(state.error,null,'hand failure during populated window');
    assert.equal(state.identity?.backend,'webgpu-local','hand backend changed');
    assert.equal(state.fingerJuice?.enabled,true);assert.equal(state.fingerJuice.backend,'mls-mpm');
    assert.equal(state.fingerJuice.error,null,'fluid failure during populated window');
    assert.equal(state.fingerJuice.runtime?.failure,null,'runtime failure during populated window');
    assert.equal(state.fingerJuice.runtime.effectiveRoute,MLS_ROUTE,'fluid route changed');
  }
  const progress={presentedFrames:end.fingerJuice.runtime.frameCount-start.fingerJuice.runtime.frameCount,
    simulatedSeconds:end.fingerJuice.runtime.solver.clock.simulatedSeconds-start.fingerJuice.runtime.solver.clock.simulatedSeconds,
    handResults:end.received-start.received};
  assert(progress.presentedFrames>0,'no presentation progress during populated window');
  assert(progress.simulatedSeconds>0,'no simulation progress during populated window');
  assert(progress.handResults>0,'no hand progress during populated window');
  return progress;
}

export function validateServedMlsSource(report){
  const source=report.servedSource?.source;
  assert.equal(report.servedSource?.schema,'kaminos.runtime-config.v0','missing served source schema');
  assert.equal(source?.repoRoot,report.source?.root,'served source root mismatch');
  assert.equal(source?.commit,report.source?.head,'served source revision mismatch');
  assert.equal(typeof source?.dirty,'boolean','missing served source dirty state');
  assert(Object.keys(report.expectedFiles??{}).length>0,'missing served source file identities');
  for(const [url,sha]of Object.entries(report.expectedFiles)){
    assert.equal(report.servedFiles?.[url]?.status,200,`missing served source response ${url}`);
    assert.equal(report.servedFiles[url].sha256,sha,`served source bytes mismatch ${url}`);
  }
}

export function bindMlsWitnessSource({page,url,root,files,out,report}){
  const base=new URL(url),pending=[];
  report.source={root:fs.realpathSync(root),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()};
  report.expectedFiles={};report.servedFiles={};
  for(const file of files){
    const bytes=fs.readFileSync(path.join(root,file)),pathname=file==='index.html'?base.pathname:'/'+file;
    report.expectedFiles[pathname]=createHash('sha256').update(bytes).digest('hex');
    fs.mkdirSync(path.dirname(path.join(out,'source',file)),{recursive:true});fs.writeFileSync(path.join(out,'source',file),bytes);
  }
  page.on('response',response=>{
    const uri=new URL(response.url());if(uri.origin!==base.origin||!Object.hasOwn(report.expectedFiles,uri.pathname))return;
    pending.push((async()=>{
      try{report.servedFiles[uri.pathname]={status:response.status(),sha256:createHash('sha256').update(await response.body()).digest('hex')};}
      catch(error){report.servedFiles[uri.pathname]={status:response.status(),error:String(error)};}
    })());
  });
  return async()=>{
    report.servedSource=await page.evaluate(async()=>{
      const response=await fetch('/api/runtime-config',{cache:'no-store'});if(!response.ok)throw Error('Served runtime config unavailable');return response.json();
    });
    await Promise.all(pending);validateServedMlsSource(report);
  };
}

export const MLS_WITNESS_FILES=['index.html','owner-live-fluid-session.mjs','mls-juice-contract.mjs','mls-juice-solver.mjs','mls-juice-renderer.mjs','mls-juice-host.mjs',
  'vendor/splash-mls-mpm/p2g_1.wgsl','vendor/splash-mls-mpm/p2g_2.wgsl','vendor/splash-mls-mpm/g2p.wgsl'];
