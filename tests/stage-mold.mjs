// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {sceneLiquidCollider,sceneLiquidDistance} from '../scene-liquid-support.mjs';
import {packSceneLiquidTexture} from '../scene-liquid-support.mjs';
import {createStageMold,stageMoldField} from '../stage-mold.mjs';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
import {buildSceneDocument,planSceneRestore,isReloadableSceneObjectRecord} from '../scene-persistence-core.js';
import {Raycaster,Vector3} from '../lib/three.core.js';
const stageMold={schema:'kaminos.stage-mold.v1',label:'O',pitch:.1,wallHeight:.4,baseThickness:.1,
 rows:['#########','#.......#','#.#####.#','#.#####.#','#.#####.#','#.#####.#','#.#####.#','#.......#','#########']};
const record={id:'mold',type:'pbr',source:'kaminos:stage-mold-v1',stageMold,
 transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}};
test('letter mold supports the trough floor, both banks and the counter, while its mouth stays open',()=>{
 const c=sceneLiquidCollider(record);
 assert.ok(c,'the authored mold must participate in actual water contact');
 const at=p=>sceneLiquidDistance(c,p);
 assert.ok(at([-.3,.2,0]).distance>0,'letter stroke is a fluid channel');
 assert.ok(at([0,.2,0]).distance<0,'counter remains solid');
 assert.ok(at([-.4,.2,0]).distance<0,'outer bank remains solid');
 assert.ok(at([-.3,-.04,0]).distance<0,'channel has a real bottom');
 assert.ok(at([0,.5,0]).distance>0,'pour can enter from above');
 assert.ok(at([1,-.04,0]).distance>0,'mold does not create an invisible infinite floor');
 assert.ok(at([-.3,-.01,0]).normal[1]>.9,'floor pushes upward');
});
test('native placement transforms the mold collision along with its geometry',()=>{
 const c=sceneLiquidCollider({...record,transform:{position:[2,3,4],rotation:[0,Math.PI/2,0],scale:[2,2,2]}});
 assert.ok(c);
 assert.ok(sceneLiquidDistance(c,[2,3.4,4.6]).distance>0);
 assert.ok(sceneLiquidDistance(c,[2,3.4,4]).distance<0);
});
test('rendered top surfaces match channel floors and the raised counter',()=>{
 const object=createStageMold(stageMold);object.updateMatrixWorld(true);
 const hit=x=>new Raycaster(new Vector3(x,1,0),new Vector3(0,-1,0)).intersectObject(object)[0]?.point.y;
 assert.ok(Math.abs(hit(-.3))<1e-6,'ray through the O stroke reaches its floor');
 assert.ok(Math.abs(hit(0)-.4)<1e-6,'ray through the O counter hits the wall top');
 object.geometry.dispose();object.material.dispose();
});
test('native admission and saved-scene reconstruction preserve the physical mold without a font dependency',()=>{
 const object=createStageMold(stageMold),entry=createSceneObjectRecord(object,record,{id:record.id});
 const doc=buildSceneDocument({objects:[entry]});
 const restored=planSceneRestore(JSON.parse(JSON.stringify(doc))).objects[0];
 assert.deepEqual(restored.stageMold,stageMold);
 assert.equal(isReloadableSceneObjectRecord(restored),true);
 assert.ok(sceneLiquidDistance(sceneLiquidCollider(restored),[-.3,.2,0]).distance>0);
 assert.equal(isReloadableSceneObjectRecord({...restored,stageMold:{...stageMold,rows:['broken']}}),false);
 assert.throws(()=>sceneLiquidCollider({...record,stageMold:null}),/Stage mold/,'missing requested collision data must not silently disappear');
 object.geometry.dispose();object.material.dispose();
});
test('mixed primitive/mold texture keeps header indices separate from every complete raster',()=>{
 const sphere=sceneLiquidCollider({id:'sphere',type:'procedural-mesh',geometry:{kind:'sphere',parameters:{radius:1}},transform:record.transform});
 const a=sceneLiquidCollider(record),b=sceneLiquidCollider({...record,id:'second'}),packed=packSceneLiquidTexture([sphere,a,b]);
 assert.equal(packed.height,3+2*9);assert.equal(packed.width,9);
 const pixel=(x,y,c=0)=>packed.data[(y*packed.width+x)*4+c];
 assert.equal(pixel(0,0),0);assert.equal(pixel(0,1),3);assert.equal(pixel(0,2),3);
 const offsets=[pixel(3,1,3),pixel(3,2,3)];assert.deepEqual(offsets,[3,12]);
 const field=stageMoldField(stageMold);
 for(const offset of offsets)for(let z=0;z<9;z++)for(let x=0;x<9;x++)assert.equal(pixel(x,z+offset),field.data[z*9+x]);
});
