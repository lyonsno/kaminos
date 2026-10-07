import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const url=new URL('../finger-fluid-ipbf-reference.mjs',import.meta.url);
const api=existsSync(url)?await import(url.href):{};
const close=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const fixture=()=>({positions:[[-0.1,0,0],[0.1,0.04,0],[0,0.15,0.06]],inertial:[[-0.12,0,0],[0.12,0.04,0],[0,0.17,0.06]],masses:[0.3,0.35,0.25],restDensity:1,supportRadius:1,dt:1/60,compliance:0.001});

test('IPBF numerical reference exports the paper update',()=>{
 for(const n of ['cubicSplineKernel','evaluateIPBF','iterateIPBF','dampIPBFVelocity','stepIPBF'])assert.equal(typeof api[n],'function',`missing numerical capability ${n}`);
});
test('cubic spline is normalized in 3D and vanishes outside support',()=>{
 const n=20000,h=1/n;let sum=0;
 for(let i=0;i<n;i++){const r=(i+.5)*h;sum+=4*Math.PI*r*r*api.cubicSplineKernel([r,0,0],1).value*h;}
 close(sum,1,1e-8);
 assert.equal(api.cubicSplineKernel([1,0,0],1).value,0);
 assert.deepEqual(api.cubicSplineKernel([2,0,0],1).gradient,[0,0,0]);
});
test('kernel gradient and Hessian independently match finite differences',()=>{
 for(const v of [[.15,.07,.02],[.7,.12,.03]]){
  const k=api.cubicSplineKernel(v,1),e=1e-5;
  for(let a=0;a<3;a++){
   const plus=v.slice(),minus=v.slice();plus[a]+=e;minus[a]-=e;
   const p=api.cubicSplineKernel(plus,1),m=api.cubicSplineKernel(minus,1);
   close(k.gradient[a],(p.value-m.value)/(2*e),2e-7);
   for(let b=0;b<3;b++)close(k.hessian[b][a],(p.gradient[b]-m.gradient[b])/(2*e),2e-6);
  }
 }
 const k=api.cubicSplineKernel([0,0,0],1);assert.deepEqual(k.gradient,[0,0,0]);assert.ok(k.hessian.flat().every(Number.isFinite));
});
test('global variational force agrees with energy gradient, including unequal masses',()=>{
 const s=fixture(),r=api.evaluateIPBF(s),e=1e-6;
 assert.ok(r.constraints.some(c=>c>0));
 for(let i=0;i<s.positions.length;i++)for(let a=0;a<3;a++){
  const p=structuredClone(s),m=structuredClone(s);p.positions[i][a]+=e;m.positions[i][a]-=e;
  close(r.forces[i][a],-(api.evaluateIPBF(p).energy-api.evaluateIPBF(m).energy)/(2*e),2e-6);
 }
});
test('clamped free-surface pressure supplies no suction or singular update',()=>{
 const s={...fixture(),positions:[[0,0,0]],inertial:[[0,0,0]],masses:[.01],compliance:0};
 const r=api.evaluateIPBF(s);assert.equal(r.constraints[0],0);r.forces[0].forEach(v=>close(v,0));assert.deepEqual(api.iterateIPBF(s).positions,s.positions);
});
test('Jacobi commits exactly half the simultaneous Newton update',()=>{
 const s=fixture(),r=api.evaluateIPBF(s),next=api.iterateIPBF(s);
 for(let i=0;i<s.positions.length;i++)for(let a=0;a<3;a++)close(next.positions[i][a],s.positions[i][a]+.5*r.updates[i][a]);
 const reversed={...s,positions:s.positions.toReversed(),inertial:s.inertial.toReversed(),masses:s.masses.toReversed()};
 const back=api.iterateIPBF(reversed).positions.toReversed();
 for(let i=0;i<back.length;i++)for(let a=0;a<3;a++)close(back[i][a],next.positions[i][a],1e-10);
});
test('approximate Hessian uses column norms for second derivative contribution',()=>{
 const r=api.evaluateIPBF(fixture());
 for(let i=0;i<r.hessians.length;i++){
  const H=r.hessians[i];
  for(let a=0;a<3;a++){assert.ok(H[a][a]>0);for(let b=0;b<3;b++)close(H[a][b],H[b][a]);}
  for(const v of [[1,0,0],[1,2,-3],[.4,-.8,1]])assert.ok(v.reduce((z,x,a)=>z+x*H[a].reduce((q,y,b)=>q+y*v[b],0),0)>0);
 }
 // For a single active density constraint: Hessian=gg^T+diag(norm(columns(C*D))).
 const s={...fixture(),positions:[[0,0,0],[.2,.04,0]],inertial:[[0,0,0],[.2,.04,0]],masses:[.3,.3],compliance:0};
 const q=api.evaluateIPBF(s);
 for(let a=0;a<3;a++)for(let b=0;b<3;b++){
  let expected=0;
  for(const term of q.localTerms[0]){expected+=term.gradient[a]*term.gradient[b];if(a===b)expected+=Math.hypot(...term.hessian.map(row=>term.constraint*row[a]));}
  close(q.hessians[0][a][b],expected);
 }
});
test('pressure forces preserve net internal force and translation covariance',()=>{
 const s=fixture();s.compliance=0;s.inertial=structuredClone(s.positions);const r=api.evaluateIPBF(s);
 for(let a=0;a<3;a++)close(r.forces.reduce((q,v)=>q+v[a],0),0);
 const t={...s,positions:s.positions.map(v=>v.map((x,a)=>x+[2,-3,5][a])),inertial:s.inertial.map(v=>v.map((x,a)=>x+[2,-3,5][a]))};
 const z=api.evaluateIPBF(t);for(let i=0;i<s.positions.length;i++)for(let a=0;a<3;a++)close(z.updates[i][a],r.updates[i][a]);
});
test('paper damping reduces only excess energy, preserves direction and handles rest',()=>{
 const v=api.dampIPBFVelocity({velocity:[3,0,0],alternativeVelocity:[1,0,0],positionDifference:.5,supportRadius:1,beta:1});
 close(v[0],Math.sqrt(5));assert.deepEqual(v.slice(1),[0,0]);
 assert.deepEqual(api.dampIPBFVelocity({velocity:[1,0,0],alternativeVelocity:[2,0,0],positionDifference:0,supportRadius:1}),[1,0,0]);
 assert.deepEqual(api.dampIPBFVelocity({velocity:[0,0,0],alternativeVelocity:[0,0,0],positionDifference:0,supportRadius:1}),[0,0,0]);
});
test('step exposes settings and computes damping alternate from the start of final iteration',()=>{
 const s={...fixture(),compliance:0},vel=s.positions.map(()=>[0,-.1,0]),acc=s.positions.map(()=>[0,-9.2,0]);
 const out=api.stepIPBF({...s,velocities:vel,accelerations:acc,iterations:2,damping:true});
 assert.equal(out.effective.iterations,2);assert.equal(out.effective.kernel,'cubic_spline');assert.equal(out.effective.relaxation,.5);
 const y=s.positions.map((v,i)=>v.map((x,a)=>x+s.dt*vel[i][a]+s.dt*s.dt*acc[i][a]));
 const first=api.iterateIPBF({...s,positions:y,inertial:y});
 const alt=api.iterateIPBF({...s,positions:first.positions,inertial:y,compliance:.001});
 for(let i=0;i<y.length;i++)for(let a=0;a<3;a++)close(out.alternativePositions[i][a],alt.positions[i][a]);
 assert.ok(out.positions.flat().every(Number.isFinite));
});
test('invalid numerical input fails explicitly',()=>{
 assert.throws(()=>api.evaluateIPBF({...fixture(),masses:[1]}),/mass/i);
 assert.throws(()=>api.evaluateIPBF({...fixture(),compliance:-1}),/compliance/i);
 assert.throws(()=>api.evaluateIPBF({...fixture(),positions:[[NaN,0,0]]}),/finite|position/i);
 assert.throws(()=>api.stepIPBF({...fixture(),velocities:[[0,0,0]],iterations:0}),/iteration/i);
});
