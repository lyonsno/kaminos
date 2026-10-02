import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {defaultLocalLiquidSetup, normalizeLocalLiquidSetup} from '../local-liquid-setup.mjs';
import {buildSceneDocument, planSceneRestore} from '../scene-persistence-core.js';
import {measureFingerFluidParticleAllocationCapacity, evaluateFingerFluidParticleAllocationRequest} from '../finger-fluid-webgpu-core.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function harness() {
  const start=html.indexOf('async function applyLocalLiquidPerformance(values) {');
  const end=html.indexOf('\nfunction refreshLocalLiquidPerformance',start);
  assert.ok(start>=0 && end>start,'performance controls must rebuild the live host, not only change saved labels');
  const calls=[];
  const context={structuredClone,normalizeLocalLiquidSetup,measureFingerFluidParticleAllocationCapacity,evaluateFingerFluidParticleAllocationRequest,
    localLiquidSetup:defaultLocalLiquidSetup(),localLiquidGeneration:4,localLiquidFailure:null,
    localLiquidHost:{dispose:()=>calls.push('dispose')},localLiquidHostMount:{isLoading:()=>false},
    scenePlacementTools:{edits:{state:()=>({active:null,replaying:false})}},sceneSaveBlockedByFailedRestore:false,authoringBusy:false,
    sharedGpu:{device:{limits:{maxBufferSize:268435456,maxStorageBufferBindingSize:134217728}}},
    refreshLocalLiquidPerformance:()=>{},setInfo:text=>calls.push(text),
    mountLocalLiquidHost:async()=>{calls.push(['mount',context.localLiquidSetup.particleCount,context.localLiquidSetup.densityIterations]);return true;},
    window:{_kaminosDirty:()=>{}}};
  vm.runInNewContext(html.slice(start,end)+'\nthis.apply=applyLocalLiquidPerformance;',context);
  return {context,calls};
}

test('changing the fluid budget retires the old solver and mounts the requested work',async()=>{
  const {context,calls}=harness();
  await context.apply({particleCount:12288,densityIterations:1});
  assert.equal(context.localLiquidGeneration,5);
  assert.equal(context.localLiquidHost,null);
  assert.deepEqual(calls.slice(0,2),['dispose',['mount',12288,1]]);
  const document=buildSceneDocument({objects:[],localLiquid:context.localLiquidSetup});
  assert.deepEqual(planSceneRestore(document).localLiquid,normalizeLocalLiquidSetup({...defaultLocalLiquidSetup(),particleCount:12288,densityIterations:1}));
});

test('invalid and device-impossible budgets leave the live water untouched',async()=>{
  for (const values of [{particleCount:512,densityIterations:1},{particleCount:49152,densityIterations:0},{particleCount:1e9,densityIterations:1}]) {
    const {context,calls}=harness();
    await assert.rejects(context.apply(values));
    assert.equal(context.localLiquidGeneration,4);
    assert.ok(context.localLiquidHost);
    assert.deepEqual(calls,[]);
  }
});

test('a superseded restart cannot publish success into a later scene',async()=>{
  const {context,calls}=harness();
  let finish;
  context.mountLocalLiquidHost=()=>new Promise(resolve=>{finish=resolve;});
  const applying=context.apply({particleCount:24576,densityIterations:2});
  context.localLiquidGeneration++;
  context.localLiquidSetup=null;
  finish(false);
  assert.equal(await applying,false);
  assert.deepEqual(calls,['dispose']);
});

test('performance evidence rejects fallback, unchanged solver work, false pause and unsaved budget',()=>{
  const source=readFileSync(new URL('../scene-object-witness.mjs',import.meta.url),'utf8');
  const start=source.indexOf('function assertLocalLiquidPerformanceEvidence(');
  const end=source.indexOf('\nasync function runLocalLiquidPerformanceScenario',start);
  assert.ok(start>=0 && end>start);
  const context={};
  vm.runInNewContext(source.slice(start,end)+'\nthis.check=assertLocalLiquidPerformanceEvidence;',context);
  const state={mounted:true,backend:'WebGPUBackend',failure:null,effectiveRoute:'kaminos/finger-fluid/local-analytic-host-frame-v0',
    lastFrame:{submittedByHost:true,presentedByHost:true},emitters:[{id:'same-source'}],
    setup:{particleCount:12288,densityIterations:1},solver:{particleCount:12288,densityIterationsPerStep:1,stepCount:2}};
  const valid={before:structuredClone(state),after:structuredClone(state),paused:{paused:true,stepBefore:4,stepAfter:4},saved:{localLiquid:state.setup}};
  assert.doesNotThrow(()=>context.check(valid));
  for (const mutate of [
    e=>{e.after.backend='WebGLBackend';},
    e=>{e.after.effectiveRoute='fallback';},
    e=>{e.after.lastFrame.presentedByHost=false;},
    e=>{e.after.solver.particleCount=49152;},
    e=>{e.after.solver.densityIterationsPerStep=3;},
    e=>{e.after.solver.stepCount=0;},
    e=>{e.paused.stepAfter=5;},
    e=>{e.after.emitters=[];},
    e=>{e.saved.localLiquid.particleCount=49152;},
  ]) {
    const bad=structuredClone(valid); mutate(bad);
    assert.throws(()=>context.check(bad));
  }
});
