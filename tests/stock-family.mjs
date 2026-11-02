// kaminos-test: node
import assert from 'node:assert/strict';
import {createStockWarp, deformStock, validateRecipe, DEFAULT_RECIPE} from '../experiments/stock-family/model.mjs';

const profile={min:-.5,max:.5,xMin:-.17,xMax:.17,locks:[[-.5,-.45],[-.43,-.23],[.22,.39],[.45,.5]]};
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const identity=createStockWarp(profile,{length:1,bend:0,protect:true});
for(const p of [[.1,.05,-.5],[-.1,-.07,.3],[0,0,0]]){
  identity.point(p).position.forEach((v,i)=>near(v,p[i]));
}
const extended=createStockWarp(profile,{length:2,bend:80,protect:true});
for(const [a,b] of [[-.40,-.28],[.24,.37],[-.49,-.46]]){
  const p=extended.point([.1,.02,a]).position,q=extended.point([.1,.02,b]).position;
  near(Math.hypot(...p.map((v,i)=>v-q[i])),b-a);
}
// The cross-section remains rigid at every station, including both mouths.
for(const z of [-.5,-.2,0,.5]){
  const p=extended.point([-.1,.01,z]).position,q=extended.point([.1,.01,z]).position;
  near(Math.hypot(...p.map((v,i)=>v-q[i])),.2);
}
// Analytic normal transport agrees with a finite-difference tangent plane.
const p=[.12,.03,.1],h=1e-6,center=extended.point(p),q=extended.point([p[0],p[1],p[2]+h]);
const t=q.position.map((v,i)=>(v-center.position[i])/h),normal=extended.normal([0,0,1],p);
near(normal.reduce((s,v,i)=>s+v*t[i],0),Math.hypot(...t),2e-5);
assert.throws(()=>createStockWarp(profile,{length:.4,bend:0,protect:true}),/protected/);
assert.throws(()=>createStockWarp(profile,{length:.6,bend:180,protect:true}),/fold/);
assert.throws(()=>createStockWarp(profile,{length:2,bend:360,protect:true}),/closed/);
assert.throws(()=>createStockWarp(profile,{length:NaN,bend:0,protect:true}),/finite/);
const positions=new Float32Array([-.1,0,-.2,.1,0,-.2,.1,0,.2]);
const normals=new Float32Array([0,1,0,0,1,0,0,1,0]),copy=positions.slice();
const result=deformStock(positions,normals,profile,{length:2,bend:-80,protect:true});
assert.deepEqual(positions,copy);assert.equal(result.positions.length,positions.length);
assert.ok(result.positions.every(Number.isFinite));assert.deepEqual(result.normals,normals);
const recipe=validateRecipe(structuredClone(DEFAULT_RECIPE));assert.deepEqual(validateRecipe(JSON.parse(JSON.stringify(recipe))),recipe);
assert.throws(()=>validateRecipe({...recipe,source:{...recipe.source,sha256:'bad'}}),/source/);
assert.throws(()=>validateRecipe({...recipe,variants:[{...recipe.variants[0],length:-1}]}),/length/);
console.log('stock family: identity, rigid bands, cross-sections, normals, refusal and recipe checks passed');
