import test from 'node:test';
import assert from 'node:assert/strict';
import {createIPBFGridShader} from '../finger-fluid-ipbf-wgsl.mjs';
import {dampIPBFVelocity} from '../finger-fluid-ipbf-reference.mjs';

// Execute the production velocity publication body on explicit vectors.
// This narrowly translates its WGSL vector operations; native conformance
// must separately execute the generated WGSL. No pressure solver is mocked.
function publish(particles, alternative, {dt=.01,beta=1,damping=false}={}) {
  const shader=createIPBFGridShader({radius:1,volume:.1,beta,damping});
  const start=shader.indexOf('fn ipbf_velocity('), open=shader.indexOf('{',start);
  let end=open+1, depth=1;
  while(depth){if(shader[end]==='{')depth++;if(shader[end]==='}')depth--;end++;}
  const body=shader.slice(open+1,end-1)
    .replaceAll('(position-particles[i].position.xyz)/params.dt','difference(position,particles[i].position.xyz).map(v=>v/params.dt)')
    .replaceAll('(alternate-particles[i].position.xyz)/params.dt','difference(alternate,particles[i].position.xyz).map(v=>v/params.dt)')
    .replaceAll('vec4<f32>','vec4').replaceAll('var velocity','let velocity');
  const difference=(a,b)=>a.map((v,k)=>v-b[k]);
  const distance=(a,b)=>Math.hypot(...difference(a,b));
  const vec4=(xyz,w)=>({xyz:[...xyz],w});
  const ipbf_damp=(v,a,d,R,b)=>dampIPBFVelocity({velocity:v,alternativeVelocity:a,positionDifference:d,supportRadius:R,beta:b});
  const run=new Function('gid','particles','ipbfStates','params','ipbfDampingEnabled','ipbfRadius','ipbfBeta','difference','distance','vec4','ipbf_damp',body);
  const states=alternative.map(xyz=>({alternative:{xyz}}));
  for(let x=0;x<particles.length;x++)run({x},particles,states,{dt,particleCount:particles.length},damping,1,beta,difference,distance,vec4,ipbf_damp);
}
const fixture=(old,current)=>old.map((v,i)=>({
  position:{xyz:[i*.05,0,0],w:1},predicted:{xyz:[i*.05+.01*current[i][0],.01*current[i][1],.01*current[i][2]],w:.7},
  velocity:{xyz:v,w:i===2?-.5:.08},delta:{xyz:[0,0,0],w:24.3},
}));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} differs from ${b}`);

test('IPBF publishes reconstructed velocity to the field viscosity reads, retaining metadata',()=>{
  const old=[[0,0,0],[0,0,0],[0,0,0]],current=old.map(()=>[2,0,0]),p=fixture(old,current),before=structuredClone(p);
  publish(p,p.map(x=>x.predicted.xyz));
  for(let i=0;i<p.length;i++){
    p[i].velocity.xyz.forEach((v,a)=>close(v,current[i][a]));
    assert.deepEqual(p[i].velocity.xyz,p[i].delta.xyz);
    assert.equal(p[i].velocity.w,before[i].velocity.w);
    assert.equal(p[i].delta.w,24.3);
    assert.deepEqual(p[i].position,before[i].position);assert.deepEqual(p[i].predicted,before[i].predicted);
  }
});

test('smoothing preserves a uniform correction rather than attenuating it through old neighbors',()=>{
  const p=fixture([[0,0,0],[0,0,0]],[[2,0,0],[2,0,0]]);
  publish(p,p.map(x=>x.predicted.xyz));
  for(const blend of [.07,.14,.24]){
    const smoothed=(1-blend)*p[0].delta.xyz[0]+blend*p[1].velocity.xyz[0];
    close(smoothed,2);
  }
});

test('viscosity neighbor input includes paper damping, rather than raw reconstruction',()=>{
  const p=fixture([[.1,0,0],[.1,0,0]],[[3,0,0],[3,0,0]]);
  const alt=p.map(x=>x.position.xyz.map((v,a)=>v+.01*[1,0,0][a]));
  publish(p,alt,{beta:.04,damping:true});
  const expected=Math.sqrt(5); // difference=.02, beta*R=.04, halfway toward alternative energy
  for(const x of p){close(x.delta.xyz[0],expected);close(x.velocity.xyz[0],expected);}
});

