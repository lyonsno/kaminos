import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateIPBF,cubicSplineKernel} from '../finger-fluid-ipbf-reference.mjs';
import * as boundary from '../finger-fluid-ipbf-reference.mjs';

const plane={normal:[0,1,0],offset:0};
const fixture={positions:[[0,.1,0],[.15,.12,0],[.1,.25,.1]],inertial:[[0,.1,0],[.15,.12,0],[.1,.25,.1]],masses:[.2,.25,.17],restDensity:1,supportRadius:1,dt:.1,compliance:.002};
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
function capIntegral(d,R){
 if(d<=-R)return 1;if(d<0)return 1-capIntegral(-d,R);if(d>=R)return 0;
 const steps=2048,h=(R-d)/steps;
 let sum=0;for(let k=0;k<=steps;k++){
  const r=d+k*h;
  sum+=(k===0||k===steps?1:k%2?4:2)*2*Math.PI*r*(r-d)*cubicSplineKernel([r,0,0],R).value;
 }
 return sum*h/3;
}

test('wall density enters pressure with matching force and local Hessian',()=>{
 const free=evaluateIPBF(fixture);
 const wall=evaluateIPBF({...fixture,boundaryPlanes:[plane]});
 for(let i=0;i<fixture.positions.length;i++){
  const expected=capIntegral(fixture.positions[i][1],1);
  near(wall.densities[i]-free.densities[i],expected,1e-8);
 }
 const s={...fixture,boundaryPlanes:[plane]},eps=1e-5;
 for(let i=0;i<s.positions.length;i++)for(let a=0;a<3;a++){
  const energyAt=dx=>{const positions=s.positions.map(v=>v.slice());positions[i][a]+=dx;return evaluateIPBF({...s,positions}).energy;};
  near(wall.forces[i][a],-(energyAt(eps)-energyAt(-eps))/(2*eps),2e-7);
 }
 assert.ok(wall.forces.some((v,i)=>v.some((x,a)=>Math.abs(x-free.forces[i][a])>.01)),'wall must affect the pressure solve');
});

test('cubic halfspace integral and derivatives match independent kernel quadrature',()=>{
 assert.equal(typeof boundary.cubicSplineHalfspace,'function','the boundary integral must be exposed for independent checking');
 for(const R of [.185,1,2.3])for(const q of [-1.2,-.7,-.5,-.2,0,.2,.5,.7,.99,1,1.2]){
  const d=q*R,v=boundary.cubicSplineHalfspace(d,R);
  near(v.value,capIntegral(d,R),2e-9);
  const h=R*1e-5;
  const left=boundary.cubicSplineHalfspace(d-h,R),right=boundary.cubicSplineHalfspace(d+h,R);
  near(v.first,(right.value-left.value)/(2*h),2e-7/R);
  near(v.second,(right.first-left.first)/(2*h),2e-6/(R*R));
  near(v.value+boundary.cubicSplineHalfspace(-d,R).value,1);
 }
});

test('two fixed plane union approximation has consistent gradient and Hessian',()=>{
 const planes=[plane,{normal:[1,0,0],offset:-.1}],p=[.14,.2,.05],R=.7,h=1e-5;
 const v=boundary.evaluateIPBFBoundaryPlanes(p,R,planes);
 for(let a=0;a<3;a++){
  const lo=p.slice(),hi=p.slice();lo[a]-=h;hi[a]+=h;
  const l=boundary.evaluateIPBFBoundaryPlanes(lo,R,planes),r=boundary.evaluateIPBFBoundaryPlanes(hi,R,planes);
  near(v.gradient[a],(r.value-l.value)/(2*h),1e-7);
  for(let b=0;b<3;b++)near(v.hessian[b][a],(r.gradient[b]-l.gradient[b])/(2*h),2e-7);
 }
 assert.ok(v.value>=0&&v.value<=1);
});

test('boundary derivatives enter the self constraint Hessian used by the Newton solve',()=>{
 const s={...fixture,boundaryPlanes:[plane]},e=evaluateIPBF(s),h=2e-4;
 for(let i=0;i<s.positions.length;i++){
  const term=e.localTerms[i].find(v=>v.source===i);
  for(let a=0;a<3;a++)for(let b=0;b<3;b++){
   const constraintAt=(da,db)=>{const positions=s.positions.map(v=>v.slice());positions[i][a]+=da;positions[i][b]+=db;return evaluateIPBF({...s,positions}).constraints[i];};
   const D=a===b?(constraintAt(h,0)-2*constraintAt(0,0)+constraintAt(-h,0))/(h*h):(constraintAt(h,h)-constraintAt(h,-h)-constraintAt(-h,h)+constraintAt(-h,-h))/(4*h*h);
   near(term.hessian[a][b],D,2e-5);
  }
  for(let a=0;a<3;a++)near(e.hessians[i][a].reduce((sum,x,b)=>sum+x*e.updates[i][b],0),e.forces[i][a],1e-8);
 }
});

test('remote boundary is neutral and malformed planes fail explicitly',()=>{
 const a=evaluateIPBF(fixture),b=evaluateIPBF({...fixture,boundaryPlanes:[{normal:[0,1,0],offset:-4}]});
 for(const key of ['densities','forces','hessians','updates'])assert.deepEqual(a[key],b[key]);
 for(const malformed of [null,[{normal:[0,0,0],offset:0}],[{normal:[0,2,0],offset:0}],[{normal:[0,1,0],offset:NaN}]])assert.throws(()=>evaluateIPBF({...fixture,boundaryPlanes:malformed}),/boundary/);
});
