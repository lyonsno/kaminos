// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Euler} from '../lib/three.core.js';
import {defaultBurnerRecipe,checkedBurnerRecipe,compileBurnerSources,synchronizeBurnerSources} from '../burner-recipe.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {flameSourceInputs} from '../scene-fire-domain.mjs';
import {resolveImmersedSourceConfig,immersedCoverageMapForConfig} from '../volume-core.js';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test('Crown supplies the twelve actual ports and preserves a transformed radial aim',()=>{
 const r=defaultBurnerRecipe('crown-ring');r.aim=25;const transformed={position:[2,3,4],rotation:[.3,.5,.2],scale:[3,3,3]},ports=compileBurnerSources(r,transformed);assert.equal(ports.length,12);
 const p=ports[0],expected=new Vector3(0,.157,.135).multiplyScalar(3).applyEuler(new Euler(...transformed.rotation)).add(new Vector3(2,3,4));p.transform.position.forEach((v,i)=>near(v,expected.toArray()[i]));
 const direction=new Vector3(0,1,0).applyEuler(new Euler(...p.transform.rotation)),want=new Vector3(0,Math.cos(25*Math.PI/180),Math.sin(25*Math.PI/180)).applyEuler(new Euler(...transformed.rotation));near(direction.distanceTo(want),0);
 assert.equal(p.emission.settings['volume-immersed-radius'].value,.006);assert.deepEqual(p.transform.scale,[3,3,3]);
});
test('opening zero disables all outlets, bounds never bounce, and saved body recipe round trips',()=>{
 const r=defaultBurnerRecipe('crown-ring');r.opening=0;assert.ok(compileBurnerSources(r,pose).every(p=>!p.emissionEnabled));assert.equal(checkedBurnerRecipe(r).opening,0);
 assert.throws(()=>checkedBurnerRecipe({...r,opening:2}),/opening/);assert.throws(()=>checkedBurnerRecipe({...r,feed:NaN}),/feed/);
 const saved=buildSceneDocument({objects:[{id:'body',type:'glb',source:'/api/read?root=generated-meshes&path=body.glb',burner:r,transform:pose}]});assert.deepEqual(planSceneRestore(saved).objects[0].burner,r);
});
test('recipe synchronization binds copies through their own group with no original IDs',()=>{
 const a=defaultBurnerRecipe('crown-ring'),b={...a,feed:.8,on:false};const source=(id,index)=>({id,emission:{burnerPort:{designId:'crown-ring',index}}});
 const scene={objects:[{id:'body',burner:a,transform:pose},{id:'copy',burner:b,transform:{...pose,position:[2,0,0]}},source('port',0),source('copy-port',0)],groups:[{id:'a',objectIds:['body','port']},{id:'b',objectIds:['copy','copy-port']}]};
 synchronizeBurnerSources(scene,{pose:e=>e.transform,write:(e,p)=>Object.assign(e,p)});
 assert.equal(scene.objects[2].emission.settings['volume-immersed-speed'].value,.18);assert.equal(scene.objects[3].emission.settings['volume-immersed-speed'].value,.8);assert.equal(scene.objects[3].emissionEnabled,false);near(scene.objects[3].transform.position[0],2);
});
test('Seam reaches the solver as its narrow rotated rectangle, with decreasing area as it closes',()=>{
 const r=defaultBurnerRecipe('seam-rail');const p=compileBurnerSources(r,{...pose,rotation:[0,Math.PI/2,0]})[0];
 const record={...p,id:'port',type:'flame-emitter',source:'kaminos:analytic-flame'},shared={resolution:64,gridHeightRatio:2,pressureSolver:'converged-open-top',emitterSourceLaw:'immersed-source'};
 const controls=flameSourceInputs([record],{controls:shared})[0].controls,config=resolveImmersedSourceConfig(controls,{grid:64,gridHeight:128});
 assert.equal(config.effective.pattern.kind,'rectangle');near(Math.abs(config.effective.basis.e1[2]),1);
 const map=immersedCoverageMapForConfig(config);assert.ok(map.totalCoverage>0);assert.ok(map.totalCoverage<40,'slot cannot become the whole source disc');
 r.opening=.25;const smaller=compileBurnerSources(r,pose)[0];const c=flameSourceInputs([{...record,...smaller}],{controls:shared})[0].controls;const reduced=immersedCoverageMapForConfig(resolveImmersedSourceConfig(c,{grid:64,gridHeight:128}));near(reduced.totalCoverage/map.totalCoverage,.25);
});
test('a burner template cannot smuggle field settings or non-finite supply into its ports',()=>{
 assert.throws(()=>checkedBurnerRecipe({...defaultBurnerRecipe('crown-ring'),sourceSettings:{'volume-resolution':{value:128}}}),/source|owner/i);
 assert.throws(()=>checkedBurnerRecipe({...defaultBurnerRecipe('crown-ring'),sourceSettings:{'volume-immersed-fuel':{type:'range',value:1,rawValue:'NaN'}}}),/finite/i);
});
test('malformed rectangle support is rejected before the solver sees a partial collection',()=>{
 const p=compileBurnerSources(defaultBurnerRecipe('seam-rail'),pose)[0],record={...p,id:'port',type:'flame-emitter',source:'kaminos:analytic-flame'};
 record.emission.aperture.halfWidth=3;assert.throws(()=>flameSourceInputs([record]),/aperture/i);
});
