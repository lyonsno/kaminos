// kaminos-test: node
import assert from 'node:assert/strict';
import * as regions from '../scene-source-regions.mjs';
import {sceneSourceDomain} from '../scene-volume-source.mjs';
import {FLAME_EMITTER_SOURCE} from '../scene-flame-emitter.mjs';
assert.equal(typeof regions.regionRaySample,'function','multi-emitter proposal requires replayable rays and actual mixture density');
const domain=sceneSourceDomain([1,1,1]),guides=[{id:'left',lo:[-.8,-.8,-.8],hi:[-.2,.8,.8]},{id:'right',lo:[.2,-.8,-.8],hi:[.8,.8,.8]}];
const plan=regions.regionPlan(guides,10,domain);assert.deepEqual(plan.counts,[3,4,3]);assert.equal(plan.counts.reduce((a,b)=>a+b),10);
assert.deepEqual(regions.regionPlan([...guides].reverse(),10,domain),plan,'record order cannot change the sampling pattern');
const p=[0,0,5];for(let i=0;i<48;i++){
 const ray=regions.regionRaySample(p,i,guides,48,{domain,grid:16});assert(ray.pdf>0&&Number.isFinite(ray.pdf));assert(Math.abs(Math.hypot(...ray.direction)-1)<1e-12);
 assert.deepEqual(ray,regions.regionRaySample(p,i,guides,48,{domain,grid:16}),'no frame history');
 assert.deepEqual(ray.point,regions.regionRaySample(p,i,guides,96,{domain,grid:16}).point,'progressive prefix must preserve cached rays');
}
// All eight receivers in a 2x2x2 block use distinct strata on every unit axis.
const units=[];for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++)units.push(regions.regionRaySample([-.9375+x*.125,-.9375+y*.125,-.9375+z*.125],1,guides,48,{domain,grid:16}).unit);
for(let a=0;a<3;a++)assert.equal(new Set(units.map(p=>Math.floor(p[a]*8))).size,8);
// Correct PDF sums overlapping proposal chords, weighted by actual finite counts.
const nested=[{id:'a',lo:[-.5,-.5,-.5],hi:[.5,.5,.5]},{id:'b',lo:[-.25,-.25,-.25],hi:[.25,.25,.25]}];
const pdf=regions.regionRaySample([0,0,5],0,nested,10,{domain,grid:16}).pdf;
assert(Number.isFinite(pdf));
const expected=.3*(6**3-4**3)/24+.4*(5.5**3-4.5**3)/3+.3*(5.25**3-4.75**3)/(3*.125);
assert(Math.abs(regions.regionPdf([0,0,5],[0,0,-1],nested,10,domain)-expected)<1e-10);
let omega=0;const n=65536;for(let i=0;i<n;i++)omega+=1/regions.regionRaySample(p,i,guides,n,{domain,grid:16}).pdf;
assert(Math.abs(omega/n-4*Math.atan(1/(4*Math.sqrt(18))))<.003,'full support solid-angle reference');
const descriptor=v=>({value:v,type:'number'}),record=(id,x)=>({id,type:'flame-emitter',source:FLAME_EMITTER_SOURCE,transform:{position:[x,-.5,0],rotation:[0,0,0],scale:[1,1,1]},emission:{domainId:'flame-field',settings:{'volume-immersed-radius':descriptor(.1),'volume-emitter-source-law':{value:'immersed-source'}}}});
const records=[record('b',.5),record('a',-.5)];const derived=regions.authoredSourceRegions(records,{transform:{translate:[0,0,0],scale:1},domain,controls:{plumeHeight:1,emitterSourceDepth:.1}});
assert.deepEqual(derived.map(g=>g.id),['a','b']);assert(derived[0].hi[0]<derived[1].lo[0]);
assert.equal(regions.authoredSourceRegions([{...records[0],emissionEnabled:false},records[1]],{domain,controls:{plumeHeight:1}}).length,1);
assert.throws(()=>regions.regionPlan([guides[0],guides[0]],24,domain),/identity/);
assert.throws(()=>regions.regionPlan([{...guides[0],hi:[NaN,1,1]}],24,domain),/finite/);
assert.deepEqual(regions.regionPlan([],24,domain).counts,[6,18],'no authored emitter retains full-volume coverage');
console.log('multi-region finite mixture, full support, complementary stable phases and authored source contracts passed');
