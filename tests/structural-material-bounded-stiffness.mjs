// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as regimes from '../structural-material-stone-regime.mjs';
import {stoneMaterialParameters} from '../structural-material-workbench-host.mjs';

test('Workbench routes the named stiffness profile and rejects a substituted comparison',()=>{
 assert.equal(stoneMaterialParameters('').get('material'),'stiff-brittle-v2');
 assert.equal(stoneMaterialParameters('?stoneResponse=stiff-brittle-v1').get('material'),'stiff-brittle-v1');
 assert.throws(()=>stoneMaterialParameters('?stoneResponse=typo'),/response/i);
});

test('bounded stone stiffens against weight without changing normalized grip and fracture response',()=>{
 assert.equal(typeof regimes.configureBoundedStoneRegime,'function','Bounded Stone needs an explicit stiffness/grip/fracture profile');
 const source={young:1000,poisson:.25,density:1000},before=structuredClone(source),current=regimes.configureBoundedStoneRegime(source),legacy=regimes.configureBoundedStoneRegime(source,'stiff-brittle-v1');
 assert.deepEqual(source,before);
 assert.equal(current.name,'bounded-stiff-brittle-v2');assert.equal(current.material.young,10000000);
 assert.equal(legacy.material.young,100000);assert.equal(legacy.threshold,180);assert.equal(legacy.gripStiffness,200000);
 assert.equal(current.material.density,legacy.material.density);assert.equal(current.material.poisson,legacy.material.poisson);
 assert.equal(current.threshold/current.material.young,legacy.threshold/legacy.material.young);
 assert.equal(current.gripStiffness/current.material.young,legacy.gripStiffness/legacy.material.young);
 assert.equal(current.threshold,18000);assert.equal(current.gripStiffness,20000000);
 assert.throws(()=>regimes.configureBoundedStoneRegime(source,'typo'),/Unknown/);
 for(const patch of [{density:0},{density:Infinity},{poisson:.5},{poisson:NaN}])assert.throws(()=>regimes.configureBoundedStoneRegime({...source,...patch}),/material/i);
});

test('the actual bounded reset consumes the effective profile for mechanics and hand coupling',()=>{
 const source=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8'),start=source.indexOf(' if(bounded){const '),end=source.indexOf('\n if(coherentGrains)',start),seen=[];
 assert.ok(start>=0&&end>start);
 const context={bounded:true,axialFixture:false,body:{positions:[],tetrahedra:[]},manifest:{material:{young:1000,poisson:.25,density:1000},model:{volume:1}},parameters:new URLSearchParams(),configuration:{gripStiffness:200000},configureBoundedStoneRegime:regimes.configureBoundedStoneRegime,
  prepareSolidTopology(input,material){seen.push(material);return{material,positions:[],elements:[],bonds:[],colorCount:1};},packSolidTopology:()=>({}),initialArrays:null,initialModel:null,materialRegime:null};
 vm.runInNewContext(source.slice(start,end),context);
 assert.equal(seen[0].young,10000000);assert.equal(context.configuration.gripStiffness,20000000);assert.equal(context.materialRegime.threshold,18000);
});
