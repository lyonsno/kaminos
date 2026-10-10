import test from 'node:test';
import assert from 'node:assert/strict';
import * as fixtures from '../finger-fluid-discriminator.mjs';
import {createIPBFGridShader} from '../finger-fluid-ipbf-wgsl.mjs';
import * as evidence from '../tools/fluid-discriminator-evidence.mjs';

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
