// Test: node --test tests/visual-work-scheduling.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkWater,checkOverlap} from '../examples/visual-work/scheduling-evidence.mjs';

const state=()=>({mounted:true,backend:'WebGPUBackend',failure:null,
  effectiveRoute:'kaminos/finger-fluid/local-analytic-host-frame-v0',
  setup:{particleCount:12288,densityIterations:1},
  solver:{particleCount:12288,densityIterationsPerStep:1,stepCount:190},
  lastFrame:{submittedByHost:true,presentedByHost:true},paused:true});
const evidence=()=>({requestedSteps:180,startStep:10,state:state(),samples:[{step:11,at:100},{step:190,at:200}]});
test('scheduling evidence rejects fallback, wrong work and incomplete stepping',()=>{
  assert.doesNotThrow(()=>checkWater(evidence()));
  for(const mutate of [e=>e.state.backend='WebGLBackend',e=>e.state.solver.particleCount=49152,
    e=>e.state.solver.densityIterationsPerStep=3,e=>e.state.solver.stepCount=189,
    e=>e.state.effectiveRoute='fallback',e=>e.state.lastFrame.presentedByHost=false,
    e=>e.state.paused=false,e=>e.samples=[]]) {
    const bad=evidence();mutate(bad);assert.throws(()=>checkWater(bad));
  }
});
test('an overlap claim requires water progress during the actual preview interval',()=>{
  const arm={preview:{start:90,end:210,activeStart:120,activeEnd:180},water:[{samples:[{at:130,step:11},{at:160,step:12}]}]};
  assert.doesNotThrow(()=>checkOverlap(arm));
  for(const samples of [[],[{at:100,step:11},{at:190,step:12}], [{at:130,step:11},{at:160,step:11}]])
    assert.throws(()=>checkOverlap({...arm,water:[{samples}]}));
});
