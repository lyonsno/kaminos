import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('completed explicit diagnostics replace stale bench runtime before readout',async()=>{
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=source.indexOf('async function requestFingerFluidBenchDiagnostics(options={}) {');
  const end=source.indexOf('\nfunction setFingerFluidBenchLiveInletPacket',start);
  const body=source.slice(source.indexOf(') {',start)+3,end).replace(/}\s*$/,'');
  const state={runtime:{stepCount:32,diagnostics:{stepCount:31},effectivePressureIterations:3}};
  const runtime={stepCount:32,diagnostics:{stepCount:32},densityIterationsPerStep:5,capillaryStrength:.25,
    livePressureControls:{available:true,requested:{densityIterations:5,capillaryStrength:.25}}};
  let shown;
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('fingerFluidBenchSolver','fingerFluidBenchRunning','updateFingerFluidBenchReadout','fingerFluidBenchState',
    'const options={captureParticleState:true};'+body)({available:true,requestDiagnostics:async()=>({stepCount:32}),getDebugState:()=>runtime},true,()=>{shown=state.runtime.diagnostics.stepCount;},state);
  assert.equal(state.runtime.diagnostics.stepCount,32);
  assert.equal(shown,32);
  assert.equal(state.runtime.effectivePressureIterations,5);
});

test('the actual cockpit resume callback restores a held witness frame loop',()=>{
  const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const body=source.match(/setPaused:value=>\{([^}]+)\}/)?.[1];
  assert.ok(body);
  let resumes=0;
  const setter=new Function('resumeFingerFluidBenchAfterWitness','let fingerFluidBenchSimulationPaused=true;return value=>{'+body+'};')(()=>resumes++);
  setter(false);assert.equal(resumes,1);
  setter(true);assert.equal(resumes,1);
});
