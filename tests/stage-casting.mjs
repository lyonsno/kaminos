// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import * as mold from '../stage-mold.mjs';
import {Raycaster,Vector3} from '../lib/three.core.js';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
import {buildSceneDocument,planSceneRestore,isReloadableSceneObjectRecord} from '../scene-persistence-core.js';
const recipe={schema:'kaminos.stage-mold.v1',label:'O',pitch:.1,wallHeight:.4,baseThickness:.1,rows:['#########','#.......#','#.#####.#','#.#####.#','#.#####.#','#.#####.#','#.#####.#','#.......#','#########']};
test('casting occupies the open strokes and preserves the counter as an actual hole',()=>{
 assert.equal(typeof mold.createStageCasting,'function','mold needs a separate positive casting');
 const object=mold.createStageCasting(recipe);object.updateMatrixWorld(true);
 const hits=x=>new Raycaster(new Vector3(x,1,0),new Vector3(0,-1,0)).intersectObject(object);
 assert.equal(hits(0).length,0);assert.ok(hits(-.3).length);assert.equal(hits(-.4).length,0);
 assert.ok(Math.abs(hits(-.3)[0].point.y-.4)<1e-6);
 const entry=createSceneObjectRecord(object,{id:'cast',source:'kaminos:stage-casting-v1',type:'pbr',burnable:{enabled:true,material:'wood'}},{id:'cast'});
 const saved=planSceneRestore(JSON.parse(JSON.stringify(buildSceneDocument({objects:[entry]})))).objects[0];
 assert.equal(isReloadableSceneObjectRecord(saved),true);assert.deepEqual(saved.stageCasting,recipe);assert.equal(saved.burnable.enabled,true);
 object.geometry.dispose();object.material.dispose();
});

test('hover arrives exactly once and does not keep overwriting native edits',async()=>{
 const {createCastingTransfer}=await import('../casting-transfer.mjs');let current,arrivals=0;
 const transfer=createCastingTransfer({write:p=>current=p,arrive:()=>arrivals++});
 const a={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},b={position:[3,1,2],rotation:[Math.PI/2,.3,0],scale:[1,1,1]};
 transfer.start(a,b,{seconds:4,lift:1});transfer.advance(2);assert.ok(current.position[1]>.5);assert.throws(()=>transfer.start(a,b),/already moving/);
 transfer.advance(9);assert.deepEqual(current,b);assert.equal(arrivals,1);current.position[0]=5;transfer.advance(1);assert.equal(current.position[0],5);assert.equal(arrivals,1);
});

test('casting pickup includes the mold parent transform',async()=>{
 const t=await import('../casting-transfer.mjs');const {Group,Quaternion,Euler}=await import('../lib/three.core.js');
 assert.equal(typeof t.castingPickupPose,'function');
 const parent=new Group(),child=new Group();parent.position.set(3,2,-1);parent.rotation.y=.7;parent.scale.setScalar(2);child.position.set(1,.5,2);child.rotation.x=.2;parent.add(child);parent.updateMatrixWorld(true);
 const offset=[.5,0,-.3],p=t.castingPickupPose(child,offset),expected=child.localToWorld(new Vector3(...offset));
 assert.ok(new Vector3(...p.position).distanceTo(expected)<1e-9);assert.ok(p.scale.every(v=>Math.abs(v-2)<1e-9));
 const q=new Quaternion().setFromEuler(new Euler(...p.rotation));assert.ok(q.angleTo(child.getWorldQuaternion(new Quaternion()))<1e-7);
});
