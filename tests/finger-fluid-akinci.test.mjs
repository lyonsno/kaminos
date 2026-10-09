import test from 'node:test';
import assert from 'node:assert/strict';
import * as cohesion from '../finger-fluid-cohesion.mjs';
import {readFileSync} from 'node:fs';

test('published force model is explicitly selectable beside the retained profiles',()=>{
 assert.equal(cohesion.resolveFingerFluidCohesionModel({cohesionModel:'akinci_2013'}),'akinci_2013');
});
test('published surface force does not silently use the heuristic reference',()=>{
 assert.throws(()=>cohesion.evaluateFingerFluidCohesionAcceleration({weightedDirection:[1,0,0],totalWeight:1,strength:1,cohesionModel:'akinci_2013'}),/evaluateAkinciSurface/);
});
test('surface grid is built from committed positions independently of prediction',()=>{
 const source=readFileSync(new URL('../finger-fluid-akinci.mjs',import.meta.url),'utf8');
 assert.match(source,/fn surface_build_grid/);
 assert.match(source,/gridCoord\(particles\[i\]\.position\.xyz\)/);
});
test('closed asymmetric neighborhood preserves internal momentum',()=>{
 const result=cohesion.evaluateAkinciSurface({positions:[[0,0,0],[.04,0,0],[.067,.017,0],[.016,.027,.032]],volume:.055**3,coefficient:.05});
 assert.ok(result.accelerations.some(a=>Math.hypot(...a)>1));
 assert.ok(result.densityRatios.some(r=>Math.abs(r-result.densityRatios[0])>.01));
 result.centerOfMassAcceleration.forEach(x=>assert.ok(Math.abs(x)<1e-12));
});
test('surface response is rotation and translation covariant, and linear in coefficient',()=>{
 const input={positions:[[0,0,0],[.04,0,0],[.067,.017,0]],volume:.055**3,coefficient:.05};
 const a=cohesion.evaluateAkinciSurface(input),b=cohesion.evaluateAkinciSurface({...input,coefficient:.1,positions:input.positions.map(([x,y,z])=>[2-y,-3+x,1+z])});
 const c=cohesion.evaluateAkinciSurface({...input,coefficient:0});
 for(let i=0;i<a.accelerations.length;i++){
  const [x,y,z]=a.accelerations[i];
  [-2*y,2*x,2*z].forEach((v,k)=>assert.ok(Math.abs(v-b.accelerations[i][k])<1e-9));
  assert.deepEqual(c.accelerations[i],[0,0,0]);
 }
});
test('other material phases do not enter a water density or normal field',()=>{
 const one=cohesion.evaluateAkinciSurface({positions:[[0,0,0]],volume:.055**3,coefficient:.05});
 const two=cohesion.evaluateAkinciSurface({positions:[[0,0,0],[.03,0,0]],phases:[0,1],volume:.055**3,coefficient:.05});
 assert.equal(two.densityRatios[0],one.densityRatios[0]);
 assert.deepEqual(two.accelerations,[[0,0,0],[0,0,0]]);
});
test('Akinci Eq2 has nonzero short-range repulsion and independent analytic values',()=>{
 assert.equal(typeof cohesion.akinciCohesionKernel,'function','Published cohesion kernel implementation missing');
 const C=cohesion.akinciCohesionKernel;
 const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12);
 close(C(.5,1),.5/Math.PI);close(C(.25,1),-.078125/Math.PI);
 assert.ok(C(1e-8,1)<0);assert.equal(C(1,1),0);assert.equal(C(2,1),0);
 close(C(.25*3,3)*27,C(.25,1));
});
