import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createIPBFPressureControlState,ipbfBetaForRadius,ipbfPressureReplayURL} from '../finger-fluid-webgpu-core.js';
import {createInvestigationRecording,investigationOperations} from '../investigation-recording.mjs';

const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
class Input extends EventTarget {
  constructor(id){super();this.id=id;this.type=id.endsWith('-number')||id==='ipbf-beta'?'number':'range';this.min='0';this.max='8';this.value='';}
  removeAttribute(name){delete this[name];}
}
function fixture(){
  const nodes=new Map(),find=id=>{if(!nodes.has(id))nodes.set(id,new Input(id));return nodes.get(id);};
  const root={hidden:true,ownerDocument:{activeElement:null},querySelector:s=>find(s.slice(1)),querySelectorAll:()=>[...nodes.values()]};
  const state=createIPBFPressureControlState({baseRadius:.185,pressureRadiusScale:1,beta:60,densityIterations:3,capillaryStrength:.72,cohesionModel:'ipbf_free_surface'});
  const controls=()=>({available:true,particleCount:12288,cohesionModel:'ipbf_free_surface',...state.read()});
  const solver={available:true,getPressureControls:controls,setPressureControls:p=>{state.request(p);return controls();}};
  const clock={generation:1,step:47,available:true,paused:true};
  const window={_kaminosDirty(){},kaminosFingerFluidBenchSessionState:()=>({...clock})};
  const context=vm.createContext({window,document:{getElementById:()=>root},URLSearchParams,location:{href:'http://localhost/?finger_fluid_pressure_cockpit=1&finger_fluid_pressure_cockpit_linked=0',search:'?finger_fluid_pressure_cockpit=1'},history:{replaceState(){}},URL,
    fingerFluidPressureCockpit:null,fingerFluidBenchSolver:solver,fingerFluidBenchState:{},fingerFluidBenchSimulationPaused:true,
    fingerFluidBenchConfig:{},ipbfBetaForRadius,ipbfPressureReplayURL,investigationOperations,installFluidWorkbench(){},resetFingerFluidPressureCockpitWater(){},resumeFingerFluidBenchAfterWitness(){},
  });
  const cockpit=readFileSync(new URL('../finger-fluid-pressure-cockpit.mjs',import.meta.url),'utf8');
  vm.runInContext(cockpit.slice(cockpit.indexOf('/**')).replace('export function','function'),context);
  const start=source.indexOf('function installFingerFluidPressureCockpit() {'),end=source.indexOf('\nfunction kaminosFingerFluidBenchDebugState()',start);
  vm.runInContext(source.slice(start,end),context);context.installFingerFluidPressureCockpit();
  return {context,window,clock,find,state};
}
const recording=()=>createInvestigationRecording({id:'input',source:{revision:'fixture'},initial:{clock:{generation:1,step:47}},startingConditions:{kind:'live-runtime',reconstructAfterRestart:false}});

test('actual cockpit intermediate input reaches shared recording with requested and pending effective values',()=>{
  const f=fixture(),r=recording();
  try{
    for(const value of ['.11','.12']){f.find('ipbf-radius').value=value;f.find('ipbf-radius').dispatchEvent(new Event('input'));}
    const events=r.snapshot().operations;
    assert.equal(events.length,2,'each human slider input must reach shared investigation ingress');
    for(const [i,expected] of [.11,.12].entries())assert.ok(Math.abs(events[i].requested.radius-expected)<1e-12);
    assert.deepEqual(events.map(e=>e.effective.radius),[.185,.185],'held requests must not impersonate submitted solver settings');
    assert.deepEqual(events.map(e=>e.clock.step),[47,47]);
    assert.deepEqual(events.map(e=>e.clock.generation),[1,1]);
    assert.equal(events[1].controlState.effectiveGeneration,0);
    assert.equal(events[1].controlState.generation,2);
    assert.equal(events[1].actor,'unattributed');
    assert.equal(f.context.fingerFluidBenchConfig.ipbfPressureRadiusScale,.12/.185);
  }finally{r.finish();}
});

test('agent apply uses the same ingress and a UI pause has its own observed state',()=>{
  const f=fixture(),r=recording();
  try{
    f.window.kaminosFingerFluidPressureCockpitApply({densityIterations:2});
    f.find('ipbf-pause').dispatchEvent(new Event('click'));
    const events=r.snapshot().operations;
    assert.deepEqual(events.map(e=>e.kind),['fluid.controls','fluid.pause']);
    assert.equal(events[0].requested.densityIterations,2);
    assert.equal(events[1].effective.paused,false);
  }finally{r.finish();}
});

test('ordinary controls change retains the complete shared navigation pose only while recording',()=>{
  const callbacks=[];
  const pose={position:[1,2,3],target:[0,0,0],up:[0,-1,0],near:.01,far:1000,fov:50,projection:'perspective'};
  let reads=0;
  const context=vm.createContext({window:{kaminosNavigationState:()=>{reads++;return structuredClone(pose);},kaminosFingerFluidBenchSessionState:()=>({generation:1,step:47})},investigationOperations,needsRender:false,idleFrames:0,controls:{addEventListener:(kind,fn)=>callbacks.push(fn)}});
  const start=source.indexOf('  const markDirty = () => { needsRender = true; idleFrames = 0; };'),end=source.indexOf("  transformControls.addEventListener('change'",start);
  vm.runInContext(source.slice(start,end),context);
  for(const callback of callbacks)callback();assert.equal(reads,0);
  const r=recording();try{
    for(const callback of callbacks)callback();
    const events=r.snapshot().operations;
    assert.equal(events.length,1,'real shared controls change must reach recording');
    assert.equal(events[0].kind,'camera.pose');assert.deepEqual(events[0].effective,pose);
  }finally{r.finish();}
});

test('reset records a new runtime generation and retains superseded or failed outcomes',async()=>{
  const start=source.indexOf('async function resetFingerFluidPressureCockpitWater() {'),end=source.indexOf('\n\nfunction installFluidWorkbench()',start);
  for(const outcome of ['applied','superseded','failed','startup-failed','unavailable']){
    const clock={generation:1,step:47,available:true,paused:true};
    const context=vm.createContext({investigationOperations,window:{_kaminosDirty(){},kaminosFingerFluidBenchSessionState:()=>({...clock})},
      fingerFluidCompositionCameraState:()=>({fov:50}),fingerFluidBenchStartGeneration:1,fingerFluidBenchRunning:true,
      fingerFluidBenchSolver:{destroy(){}},fingerFluidBenchSolverPromise:null,fingerFluidBenchConfig:{},fingerFluidPressureCockpit:{update(){}},
      stopFingerFluidBench(){context.fingerFluidBenchStartGeneration++;context.fingerFluidBenchRunning=false;},
      async startFingerFluidBench(){context.fingerFluidBenchStartGeneration++;clock.generation++;clock.step=0;await Promise.resolve();
        context.fingerFluidBenchRunning=outcome!=='failed';context.fingerFluidBenchSolver={available:outcome!=='unavailable'};
        if(outcome==='startup-failed'){context.stopFingerFluidBench();return 'failed';}
        if(outcome==='superseded')context.fingerFluidBenchStartGeneration++;},
      syncFingerFluidCompositionCamera(){},fingerFluidBenchCamera:null});
    vm.runInContext(source.slice(start,end),context);
    const r=recording();try{
      await context.resetFingerFluidPressureCockpitWater();
      const events=r.snapshot().operations;
      assert.deepEqual(events.map(e=>[e.kind,e.phase]),[['fluid.reset','started'],['fluid.reset',['startup-failed','unavailable'].includes(outcome)?'failed':outcome]]);
      assert.equal(events[0].clock.generation,1);assert.equal(events[0].clock.step,47);
      assert.equal(events[1].clock.generation,2);assert.equal(events[1].clock.step,0);
    }finally{r.finish();}
  }
});
