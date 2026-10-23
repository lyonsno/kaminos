// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import {checkedRepetition,repetitionMatrices,createRepetitionView} from '../scene-repetition.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {createSceneColliderCollection} from '../scene-collider.mjs';
import {collectStaticSceneGeometry} from '../scene-light-geometry.mjs';
const pose=(position=[0,0,0],rotation=[0,0,0],scale=[1,1,1])=>({position,rotation,scale});
const config=(patch={})=>({schema:'kaminos.repetition.v1',mode:'circle',count:6,axis:'y',angle:360,step:[1,0,0],space:'world',center:[0,0,0],mirror:[false,false,false],...patch});
const point=(m,p)=>new T.Vector3(...p).applyMatrix4(m).toArray();
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-7,`${a} != ${b}`));
const mesh=()=>{const m=new T.Mesh(new T.BoxGeometry(.2,.6,.1),new T.MeshStandardMaterial());m.castShadow=true;return m;};
test('six circular placements include one source, preserve radius, and omit duplicate full-circle endpoint',()=>{
 const matrices=repetitionMatrices(config(),pose([2,0,0]));assert.equal(matrices.length,6);near(point(matrices[0],[2,0,0]),[2,0,0]);near(point(matrices[3],[2,0,0]),[-2,0,0]);
 assert.equal(new Set(matrices.map(m=>point(m,[2,0,0]).map(n=>n.toFixed(5)).join(','))).size,6);
});
test('partial circles include the end angle and linear local spacing follows orientation',()=>{
 const circle=repetitionMatrices(config({count:3,angle:90}),pose());near(point(circle[2],[1,0,0]),[0,0,-1]);
 const line=repetitionMatrices(config({mode:'line',count:3,step:[2,0,0],space:'local'}),pose([1,0,0],[0,0,Math.PI/2]));near(point(line[2],[1,0,0]),[1,4,0]);
});
test('mirror axis combinations precede array placements and reflect around the specified center',()=>{
 const matrices=repetitionMatrices(config({mode:'none',mirror:[true,false,true],center:[1,0,0]}),pose());assert.equal(matrices.length,4);near(point(matrices[1],[3,0,2]),[-1,0,2]);near(point(matrices[3],[3,0,2]),[-1,0,-2]);
 assert.equal(repetitionMatrices(config({count:3,mirror:[true,false,false]}),pose()).length,6);
});
test('invalid or incompatible settings fail explicitly and caller values are not capped',()=>{
 for(const patch of [{mode:'scatter'},{count:0},{count:1.5},{count:Infinity},{step:[0,NaN,0]},{axis:'w'},{center:[0,0]},{mirror:[1,false,false]},{space:'camera'}])assert.throws(()=>checkedRepetition(config(patch)));
 assert.equal(checkedRepetition(config({count:2049,angle:900})).count,2049);assert.equal(checkedRepetition(null),null);
});
test('derived copies share source geometry/material, update pose without rebuilding, and clear without disposing source',()=>{
 const root=mesh();root.position.x=2;const view=createRepetitionView(),settings=config();let geometryDisposals=0,materialDisposals=0;
 root.geometry.addEventListener('dispose',()=>geometryDisposals++);root.material.addEventListener('dispose',()=>materialDisposals++);
 assert.equal(view.sync(root,settings,pose([2,0,0])),5);assert.equal(root.children.length,5);assert.ok(root.children.every(c=>c.geometry===root.geometry&&c.material===root.material));const ids=root.children.map(c=>c.uuid);
 root.position.x=3;view.sync(root,settings,pose([3,0,0]));assert.deepEqual(root.children.map(c=>c.uuid),ids);root.updateMatrixWorld(true);near(root.children[2].getWorldPosition(new T.Vector3()).toArray(),[-3,0,0]);
 view.clear(root);assert.equal(root.children.length,0);assert.equal(geometryDisposals,0);assert.equal(materialDisposals,0);
});
test('repeated children are ordinary picked meshes, fire obstacles and static-light geometry',()=>{
 const root=mesh();root.position.x=2;const view=createRepetitionView();view.sync(root,config(),pose([2,0,0]));root.updateMatrixWorld(true);
 const cast=new T.Raycaster(new T.Vector3(-2,0,2),new T.Vector3(0,0,-1));assert.ok(cast.intersectObject(root,true).some(hit=>hit.object!==root));
 const collection=createSceneColliderCollection(T);collection.update([{id:'baffle',type:'procedural-mesh',collision:{domainId:'flame-field',enabled:true},object:root}]);assert.equal(collection.state().meshCount,6);
 const scene=new T.Scene();scene.add(root);assert.equal(collectStaticSceneGeometry(scene).triangles.length,72);root.visible=false;assert.equal(collectStaticSceneGeometry(scene).triangles.length,0);
});
test('mirrored light surfaces keep outward normals',()=>{
 const scene=new T.Scene(),root=mesh();root.scale.x=-1;scene.add(root);const {surfaces}=collectStaticSceneGeometry(scene);
 for(const s of surfaces)assert.ok(new T.Vector3(...s.position).dot(new T.Vector3(...s.normal))>0,'normal faces outward after reflection');
});
test('object and group repetition survives scene-document save and normalize',()=>{
 const object={id:'baffle',type:'procedural-mesh',source:'kaminos:geometry',geometry:{kind:'box',parameters:{width:1,height:1,depth:1}},transform:pose(),repetition:config()};
 const document=buildSceneDocument({objects:[object],groups:[{id:'ring',type:'group',objectIds:['baffle'],transform:pose(),repetition:config({mode:'line'})}]});
 assert.equal(document.version,11);assert.deepEqual(document.objects[0].repetition,config());assert.deepEqual(document.groups[0].repetition,config({mode:'line'}));const restored=planSceneRestore(document);assert.deepEqual(restored.objects[0].repetition,config());assert.deepEqual(restored.groups[0].repetition,config({mode:'line'}));
});

import {sceneLiquidCollider,sceneLiquidDistance,createSceneLiquidSupport} from '../scene-liquid-support.mjs';
import {createPolyEditMode} from '../poly-edit-mode.mjs';
test('Edit Mode sees the source topology while its repeated copies remain visible',()=>{
 const root=mesh();root.position.x=2;createRepetitionView().sync(root,config(),pose([2,0,0]));root.updateMatrixWorld(true);
 const camera=new T.PerspectiveCamera(40,1,.01,100);camera.position.z=10;camera.updateMatrixWorld();const edit=createPolyEditMode({camera,canvas:{getBoundingClientRect:()=>({left:0,top:0,width:1000,height:1000})}});
 edit.enter(root,{objectId:'source'});assert.equal(edit.geometry().indices.length/3,12);edit.exit();assert.equal(root.children.length,5);
});
test('mirrored analytic water support preserves the reflected surface and repeated supports all reach the solver packet',()=>{
 globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2};globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2};
 const root=mesh();root.position.x=2;createRepetitionView().sync(root,config({mirror:[true,false,false],count:3}),pose([2,0,0]));root.updateMatrixWorld(true);
 const record={id:'bowl',type:'procedural-mesh',geometry:{kind:'bowl',parameters:{radius:.7,thickness:.08}},object:root};
 const writes=[],device={limits:{maxTextureDimension2D:16384},createBuffer:()=>({destroy(){}}),createTexture:args=>({height:args.size[1],createView:()=>({}),destroy(){}}),queue:{writeTexture(){},writeBuffer:(...args)=>writes.push(args)}};
 const support=createSceneLiquidSupport(device,[record]);assert.equal(support.read().memberIds.length,6);support.dispose();
 const reflected=mesh();reflected.scale.set(-1,1,1);const collider=sceneLiquidCollider({...record,object:reflected});assert.ok(sceneLiquidDistance(collider,[0,0,0]).distance>=0);assert.ok(sceneLiquidDistance(collider,[0,-.7,0]).distance<0);
});

import fs from 'node:fs';import vm from 'node:vm';import {createSceneEdits} from '../scene-edit-session.mjs';
test('an absent repetition begins, previews, cancels and undoes through the real edit ledger',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('function ensureRepetitionTarget('),end=html.indexOf('\nfunction ',start+1),source=html.slice(start,end);
 let settings=null;const record={id:'source'},edits=createSceneEdits({read(){throw Error('unexpected pose read');},write(){throw Error('unexpected pose write');}}),context={repetitionOwner:()=>({id:'source',record}),polyEdit:null,repetitionEditTargets:new Set(),scenePlacementTools:{edits},checkedRepetition,writeSceneRepetition:(id,value)=>{settings=value;record.repetition=value;}};vm.createContext(context);vm.runInContext(source,context);
 const id=context.ensureRepetitionTarget('source');edits.begin(id,'Array');edits.preview({settings:config()});assert.equal(settings.count,6);edits.cancel();assert.equal(settings,null);edits.apply(id,{settings:config()});assert.equal(settings.count,6);edits.apply(id,{settings:null});assert.equal(settings,null);edits.undo();assert.equal(settings.count,6);edits.undo();assert.equal(settings,null);
});
