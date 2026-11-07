// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {createSurfaceSplatObject} from '../surface-splat-object.mjs';
import {installSurfaceFieldMaterials} from '../surface-field-material.mjs';
import {createPreparedAssetPool,disposePreparedAsset} from '../scene-asset-preparation.mjs';
import {exportCloneInWorld} from '../scene-export.mjs';
import {createRepetitionView} from '../scene-repetition.mjs';
import {createGiProxyRegistry} from '../scene-gi-proxies.mjs';
import {createSceneBeautyLodController,seedInitialBeautyLevels} from '../scene-lod-budget.mjs';
import {createFireShadowCasters} from '../fire-shadow-casters.mjs';
import {renderFireShadowBatch} from '../fire-light-field-shadow.mjs';
const payload=()=>({data:new Float32Array([0,0,0,0,0,1,.8,.3,.1,0,.5,.3]),meta:{count:1,stride:12,radius:.03},footprints:new Float32Array([1,0,0,.06,0,1,0,.06])});
const object=()=>{const mesh=new T.Mesh(new T.BoxGeometry(.6,.4,.2),new T.MeshStandardMaterial());mesh.castShadow=true;return createSurfaceSplatObject(mesh,payload());};
const find=root=>root.getObjectByProperty('isSurfaceSplatObject',true);
test('startup preparation retains glass material/controller ownership and releases it',async()=>{
 let loadCount=0;const pool=createPreparedAssetPool({load:async()=>{loadCount++;return {scene:new T.Group().add(object())};}});
 const [a,b]=await Promise.all([pool.acquire('glass'),pool.acquire('glass')]);
 const x=find(a.scene),y=find(b.scene),material=x.splats.root.children[0].material;
 assert.equal(material.transmission,1);x.splats.set({ior:1.7});assert.equal(material.ior,1.7);
 assert.notEqual(x.splats,y.splats);assert.equal(loadCount,2,'custom runtime objects are individually owned');
 disposePreparedAsset(a);assert.ok(x.splats===null);assert.doesNotThrow(()=>y.splats.set({ior:1.6}));disposePreparedAsset(b);
});
test('startup preparation preserves ordinary texture and PBR properties of vertex field materials',async()=>{
 const pool=createPreparedAssetPool({load:async()=>{const g=new T.PlaneGeometry();g.setAttribute('_kaminos_material',new T.Float32BufferAttribute(new Array(8).fill(.3),2));const source=new T.MeshStandardMaterial({map:new T.DataTexture(new Uint8Array([100,150,200,255]),1,1),color:0x123456,roughness:.4,metalness:.2});const root=new T.Group().add(new T.Mesh(g,source));installSurfaceFieldMaterials(root);return root;}});
 const a=await pool.acquire('field');assert.ok(a.children[0].material.map);assert.equal(a.children[0].material.color.getHex(),0x123456);assert.equal(a.children[0].material.roughness,.4);disposePreparedAsset(a);
});
test('triangle export restores visible fallback materials and retires temporary reconstruction',()=>{
 const root=new T.Group().add(object()),clone=exportCloneInWorld(root),splat=find(clone);
 assert.ok(splat.splats===null);assert.ok(splat.proxy.material.visible);assert.equal(splat.children.length,1);assert.ok(find(root).splats);find(root).dispose();
});
test('repeated splat assets retain independent visible fields and all flame shadow instances',()=>{
 const root=new T.Group().add(object()),view=createRepetitionView(),scene=new T.Scene();scene.add(root);
 const settings={schema:'kaminos.repetition.v1',mode:'line',count:3,axis:'y',angle:360,step:[1,0,0],space:'world',center:[0,0,0],mirror:[false,false,false]};
 view.sync(root,settings,{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]});
 const copies=root.children.filter(n=>n.userData.kaminosRepetitionCopy).map(find);assert.equal(copies.length,2);assert.ok(copies.every(n=>n?.splats&&n.splats!==find(root).splats));
 const casters=createFireShadowCasters({scene});renderFireShadowBatch({scene,casterScene:casters,shadows:[{render(batch){assert.equal(batch.triangleCount,36);assert.equal(batch.casters.length,3);}}]});
 view.clear(root);assert.ok(copies.every(n=>n.splats===null));assert.ok(find(root).splats);casters.dispose();find(root).dispose();
});
test('a seeded proxy tier cannot replace splats during interactive camera work',async()=>{
 const root=new T.Group().add(object()),scene=new T.Scene();scene.add(root);root.userData.kaminosSceneObject={id:'splats',source:'/api/read?root=generated-meshes&path='+('a'.repeat(64))+'.glb'};
 const registry=createGiProxyRegistry({THREE:T,fetchJson:async()=>({levels:[],choice:null})});await registry.attach(root);
 const coarse=new T.Group().add(new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial()));seedInitialBeautyLevels(root,[{sha:'b'.repeat(64),faces:12,root:coarse}]);
 const controller=createSceneBeautyLodController({THREE:T,scene,giProxies:registry,loadLevel:async()=>{throw Error('unexpected mesh beauty load');}}),camera=new T.PerspectiveCamera(40,1,.1,100);camera.position.z=2;camera.updateMatrixWorld(true);
 controller.update(camera,192);assert.deepEqual(controller.interactiveRoots([root],{matchDisplay:true}).map(n=>n.uuid),[root.uuid]);assert.deepEqual(controller.interactiveRoots([root]).map(n=>n.uuid),[root.uuid]);controller.dispose();registry.clear();find(root).dispose();
});
