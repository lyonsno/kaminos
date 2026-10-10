import test from 'node:test';
import assert from 'node:assert/strict';
import * as fixtures from '../finger-fluid-discriminator.mjs';
import {createIPBFGridShader} from '../finger-fluid-ipbf-wgsl.mjs';
import * as evidence from '../tools/fluid-discriminator-evidence.mjs';
import {measureFingerFluidTruthSnapshot} from '../finger-fluid-webgpu-core.js';

function boxedEvidence(reference) {
  const simulation=new Float32Array(56),pressure=new Float32Array([reference.pressureRadius,.0113,0,0]);
  simulation[0]=1/240;new Uint32Array(simulation.buffer)[1]=reference.particleCount;
  reference.box.bounds.min.forEach((v,k)=>simulation[8+k]=v);
  reference.box.bounds.max.forEach((v,k)=>simulation[12+k]=v);
  return {box:reference.box,adapter:{vendor:'apple',isFallbackAdapter:false},
    dynamics:{effective:'pressure_surface',neighborSmoothing:false,vorticityConfinement:false,speedClipping:false,
      population:{...reference.population,particleData:undefined,particleVolume:reference.particleVolume}},
    pressure:{radius:reference.pressureRadius,boundaryPressure:'tangent_plane'},surface:{neighborhoodRadius:reference.surfaceRadius,coefficient:0},
    step:1,stages:{density:2,surface:3,vorticity:0},errors:[],
    particleSnapshot:{schema:'kaminos.finger-fluid-particle-words.v1',packing:'position_predicted_velocity_delta_vec4x4_f32_bits',particleCount:reference.particleCount,recordWords:16,stepCount:1,pressureSolver:'ipbf',boundaryPressureContract:'ipbf-cubic-tangent-plane-density-v1'},
    words:Array.from(new Uint32Array(reference.population.particleData.buffer)),
    diagnostics:{stepCount:1,readbackMode:'explicit_full_particle_gpu_diagnostics_v1',pressureControlInputs:{packing:'ipbf_vec4f_and_finger_fluid_params_v0_u32_bits',simulationWords:Array.from(new Uint32Array(simulation.buffer)),pressureWords:Array.from(new Uint32Array(pressure.buffer))}}};
}
test('box capture rejects a same-count drop routed as dam break and wrong finite population source',()=>{
  const drop=fixtures.createFingerFluidBoxReference({scene:'block_drop',resolution:16});
  const dam=fixtures.createFingerFluidBoxReference({scene:'dam_break',resolution:16});
  const actual=boxedEvidence(drop);
  assert.doesNotThrow(()=>evidence.validateBoxReferenceState(actual,drop,1));
  assert.throws(()=>evidence.validateBoxReferenceState(actual,dam,1),/population identity/);
  for(const [key,value] of [['fixture',undefined],['source','other'],['refinement',2]]) {
    const bad={...actual,dynamics:{...actual.dynamics,population:{...actual.dynamics.population,[key]:value}}};
    assert.throws(()=>evidence.validateBoxReferenceState(bad,drop,1),/population identity/);
  }
});
test('box boot rejects substituted scene and ignored requested pressure configuration',async()=>{
  const {boxReferenceConfiguration}=await import('../fluid-box-reference-view.mjs');
  const config=boxReferenceConfiguration({scene:'dam_break',resolution:16});
  const {population,...fixture}=config.fixture;
  const boot={fixture,dt:config.dt,config:config.solver};
  assert.equal(typeof evidence.validateBoxReferenceBoot,'function','Box boot admission is absent');
  assert.doesNotThrow(()=>evidence.validateBoxReferenceBoot(boot,config));
  assert.throws(()=>evidence.validateBoxReferenceBoot({...boot,fixture:{...fixture,scene:'block_drop'}},config),/boot/);
  assert.throws(()=>evidence.validateBoxReferenceBoot({...boot,config:{...boot.config,densityIterations:3}},config),/boot/);
});
test('box snapshot uses the actual planes, pressure radius and finite scene instead of playground geometry',()=>{
  for(const scene of ['dam_break','block_flop']) {
    const f=fixtures.createFingerFluidBoxReference({scene,resolution:16});
    const options={scene,diagnosticBox:f.box,kernelRadius:f.pressureRadius};
    const snapshot=measureFingerFluidTruthSnapshot(f.population.particleData,f.particleCount,options);
    assert.equal(snapshot.scene,scene);
    assert.equal(snapshot.populationMode,'closed_particle_population');
    assert.equal(snapshot.maximumBoundaryPenetration,0);
    assert.equal(snapshot.retainedParticleCount,f.particleCount);
    assert.equal(snapshot.geometry.kind,'reference_box');
    assert.deepEqual(snapshot.geometry.bounds,f.box.bounds);
    let nearWall=0;
    for(let i=0;i<f.particleCount;i++){
      const p=Array.from(f.population.particleData.subarray(i*16,i*16+3));
      const distance=Math.min(...f.box.planes.map(plane=>plane.normal.reduce((sum,n,k)=>sum+n*p[k],0)-plane.offset));
      nearWall+=Number(distance<f.pressureRadius);
    }
    assert.equal(snapshot.boundaryParticleCount,nearWall);
    const changed=f.population.particleData.slice();changed[0]=f.box.bounds.min[0]+f.box.collisionRadius-.01;
    assert.equal(measureFingerFluidTruthSnapshot(changed,f.particleCount,options).maximumBoundaryPenetration,.01);
  }
});

test('box references preserve physical volume and feature dimensions across resolution',()=>{
  assert.equal(typeof fixtures.createFingerFluidBoxReference,'function','Box reference capability is absent');
  for(const scene of ['block_drop','dam_break','block_flop']){
    const a=fixtures.createFingerFluidBoxReference({scene,resolution:16});
    const b=fixtures.createFingerFluidBoxReference({scene,resolution:32});
    assert.equal(b.particleCount,8*a.particleCount);
    assert.ok(Math.abs(a.representedVolume-b.representedVolume)<1e-12);
    assert.equal(a.spacing,2*b.spacing);
    assert.equal(a.pressureRadius/a.spacing,2);
    assert.equal(b.pressureRadius/b.spacing,2);
    assert.deepEqual(a.box.bounds,b.box.bounds);
    for(const f of [a,b]){
      fixtures.validateFingerFluidDiagnosticPopulation(f.population);
      assert.equal(f.population.particleData.length,f.particleCount*16);
      for(let i=0;i<f.particleCount;i++)for(let k=0;k<3;k++){
        const p=f.population.particleData[16*i+k];
        assert.ok(p>=f.box.bounds.min[k]&&p<=f.box.bounds.max[k]);
        assert.equal(f.population.particleData[16*i+8+k],0);
      }
    }
  }
});
test('deterministic gate release and drop have distinct initial height and no emitter',()=>{
  assert.equal(typeof fixtures.createFingerFluidBoxReference,'function','Box reference capability is absent');
  const a=fixtures.createFingerFluidBoxReference({scene:'dam_break',resolution:16});
  const b=fixtures.createFingerFluidBoxReference({scene:'block_drop',resolution:16});
  assert.equal(a.particleCount,b.particleCount);
  assert.deepEqual(a.population.particleData,fixtures.createFingerFluidBoxReference({scene:'dam_break',resolution:16}).population.particleData);
  assert.ok(b.population.particleData[1]>a.population.particleData[1]+1);
  assert.equal(a.box.planes.length,6);
  assert.throws(()=>fixtures.createFingerFluidBoxReference({scene:'unknown'}),/scene/);
  assert.throws(()=>fixtures.createFingerFluidBoxReference({resolution:3}),/resolution/);
});
test('explicit box planes feed the pressure density, gradient and Hessian',()=>{
  const planes=[{normal:[0,1,0],offset:-1},{normal:[1,0,0],offset:-1.5}];
  const shader=createIPBFGridShader({radius:.1,volume:.001,boundaryMode:'tangent_plane',boundaryPlanes:planes});
  assert.match(shader,/dot\(vec3<f32>\(1,0,0\),position\)-\(-1.5\)/);
  assert.match(shader,/rho\+=boundary.value;gradient\+=boundary.gradient;D\+=boundary.hessian/);
  assert.doesNotMatch(shader,/analyticObstacleSupportEnabled/);
  assert.throws(()=>createIPBFGridShader({radius:.1,volume:.001,boundaryMode:'collision_only',boundaryPlanes:planes}),/planes/);
  assert.throws(()=>createIPBFGridShader({radius:.1,volume:.001,boundaryMode:'tangent_plane',boundaryPlanes:[{normal:[2,0,0],offset:0}]}),/unit normals/);
});
test('box evidence rejects missing or substituted physical walls before accepting a response',()=>{
  assert.equal(typeof evidence.validateBoxReferenceState,'function','Box evidence admission is absent');
  const reference=fixtures.createFingerFluidBoxReference({resolution:16});
  assert.throws(()=>evidence.validateBoxReferenceState({},reference,1),/box/);
  assert.throws(()=>evidence.validateBoxReferenceState({box:{...reference.box,bounds:{min:[0,0,0],max:[1,1,1]}}},reference,1),/box/);
});
