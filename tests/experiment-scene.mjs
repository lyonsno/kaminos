import assert from 'node:assert/strict';
import test from 'node:test';
import { scene, mesh, water, layout, viewsAround, projectLayout, layoutSheet } from '../experiment-scene.mjs';
import { assertHeldWater } from '../experiment-work.mjs';
test('short scene program uses native scene records and preserves both emitters',()=>{
  const document=scene([water('a',{position:[-.5,1,0]}),water('b',{position:[.5,1,0]}),mesh('marker','box')]);
  assert.equal(document.schema,'kaminos.scene.v1');assert.equal(document.objects.length,3);
  assert.deepEqual(document.objects[0].transform.position,[-.5,1,0]);assert.ok(document.localLiquid);
  assert.equal(layout(document).length,3);
  assert.throws(()=>scene([mesh('a','box'),mesh('a','sphere')]),/unique/);
});
test('CPU bounds preserve authored translation, rotation and scale',()=>{
  const document=scene([mesh('box','box',{parameters:{width:2,height:1,depth:1},position:[3,2,1],rotation:[0,Math.PI/2,0],scale:[2,2,2]})]);
  const box=layout(document)[0];
  box.min.forEach((v,i)=>assert.ok(Math.abs(v-[2,1,-1][i])<1e-8));
  box.max.forEach((v,i)=>assert.ok(Math.abs(v-[4,3,3][i])<1e-8));
  for(const view of viewsAround([box]))for(const p of projectLayout([box],view)[0].points)
    assert.ok(p.every(Number.isFinite) && p.every(n=>Math.abs(n)<1),'all bounds fit in camera frustum');
  assert.match(layoutSheet([box],viewsAround([box])),/CPU authored layout bounds/);
});
test('unsupported assets need explicit bounds and caller bounds retain identity',()=>{
  const document=scene([{id:'asset',type:'glb',source:'/api/real.glb',transform:{position:[2,0,0],rotation:[0,0,0],scale:[1,1,1]}}]);
  assert.throws(()=>layout(document),/Supply layout bounds/);
  const [box]=layout(document,{assetBounds:{asset:{min:[-1,-1,-1],max:[1,1,1]}}});
  assert.equal(box.representation,'caller-supplied-asset-bounds');assert.deepEqual(box.min,[1,-1,-1]);
});
test('group editing frames preserve member world-space bounds',()=>{
  const object={...mesh('box','box',{position:[3,0,0]}),groupId:'g'};
  for(const transform of [{position:[3,0,0],rotation:[0,0,0],scale:[1,1,1]},
    {position:[0,2,0],rotation:[0,Math.PI/3,0],scale:[2,2,2]}]) {
    const document=scene([object],{groups:[{id:'g',objectIds:['box'],transform}]});
    const [bounds]=layout(document);
    assert.deepEqual(bounds.min,[2.5,-.5,-.5],'member poses already carry the world transform');
    assert.deepEqual(bounds.max,[3.5,.5,.5]);
  }
});
test('water observation refuses undrained, replaced/fallback and stale display state',()=>{
  const state={mounted:true,effectiveRoute:'real',requestedRoute:'real',sourceGeneration:2,
    clock:{runId:'r',paused:true,busy:false,completedSteps:60,submittedSteps:60},lastFrame:{submittedSteps:60}};
  assert.equal(assertHeldWater(state).completedSteps,60);
  for(const bad of [{...state,effectiveRoute:'fallback'},{...state,lastFrame:{submittedSteps:59}},
    {...state,clock:{...state.clock,completedSteps:59}},{...state,clock:{...state.clock,paused:false}}])assert.throws(()=>assertHeldWater(bad));
});
