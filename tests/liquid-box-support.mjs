// kaminos-test: node
import assert from 'node:assert/strict';
import {sceneLiquidCollider,sceneLiquidDistance,packSceneLiquidColliders} from '../scene-liquid-support.mjs';
import {seamRailSupportBoxes} from '../examples/burner-designs/seam-rail-water-support.mjs';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const box=(parameters={width:2,height:2,depth:2},transform=pose)=>sceneLiquidCollider({id:'box',type:'procedural-mesh',geometry:{kind:'box',parameters},transform});
const c=box();assert.ok(c,'authored boxes must enter the water collision collection');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
near(sceneLiquidDistance(c,[0,0,0]).distance,-1);
assert.deepEqual(sceneLiquidDistance(c,[0,1.5,0]),{distance:.5,normal:[0,1,0]});
const corner=sceneLiquidDistance(c,[2,2,1]);near(corner.distance,Math.sqrt(2));near(corner.normal[0],Math.SQRT1_2);near(corner.normal[1],Math.SQRT1_2);
const transformed=box(undefined,{position:[3,4,5],rotation:[0,0,Math.PI/2],scale:[2,3,4]});
near(sceneLiquidDistance(transformed,[3,6.5,5]).distance,.5);
near(sceneLiquidDistance(transformed,[6.5,4,5]).distance,.5);
near(sceneLiquidDistance(transformed,[3,4,9.5]).distance,.5);
const reflected=box(undefined,{...pose,scale:[-2,3,4]});near(sceneLiquidDistance(reflected,[-2.5,0,0]).distance,.5);
// Actual Seam rail lips: this gap is air; the two physical lips stay distinct.
const lips=seamRailSupportBoxes.filter(p=>p.name.endsWith('lip')).map(p=>box({width:p.size[0],height:p.size[1],depth:p.size[2]},{...pose,position:p.position}));
assert.equal(lips.length,2);
for(const lip of lips)assert.ok(sceneLiquidDistance(lip,[0,.1115,0]).distance>.0089,'slot must not become a bounding-box solid');
for(let i=0;i<2;i++)assert.ok(sceneLiquidDistance(lips[i],[0,.1115,[-.0315,.0315][i]]).distance<0);
const packed=packSceneLiquidColliders([c,transformed]);assert.equal(packed.length,40);assert.equal(packed[0],3);near(packed[15],2);
const {buildSceneDocument,planSceneRestore}=await import('../scene-persistence-core.js');
const record={id:'rail-lip',type:'procedural-mesh',source:'kaminos:geometry',geometry:{kind:'box',parameters:{width:.58,height:.025,depth:.045}},transform:pose};
const restored=planSceneRestore(buildSceneDocument({objects:[record]})).objects[0];
assert.ok(sceneLiquidCollider(restored));assert.equal(sceneLiquidCollider({...restored,waterCollision:false}),null);
console.log('water box face/corner/interior, transformed scale, open slot and persistence passed');
