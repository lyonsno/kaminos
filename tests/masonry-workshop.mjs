// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from '../lib/three.core.js';
import definition from '../experiments/masonry-workshop.experiment.mjs';
import {openExperiment} from '../workbench-experiments.mjs';
import {createWorkbenchSceneHost} from '../workbench-scene-host.mjs';
function fixture(){
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),borrowed=new THREE.Group();scene.add(borrowed);
 const rows=new Map(),events=[];const controls={target:new THREE.Vector3(),update(){}};
 const shared=createWorkbenchSceneHost({scene,camera,controls,loadAsset(){throw Error('No asset');},registerObject(root,metadata){const row={id:root.uuid,root,...metadata};rows.set(root,row);return row;},findObject:root=>rows.get(root),removeObject({root}){scene.remove(root);rows.delete(root);},redraw(){},onFrame(){throw Error('No private frame loop');}});
 return {scene,borrowed,rows,events,host:{controls:{},scene:{open:async()=>shared.open(),refreshPresentation({root,id}){assert.equal(rows.get(root)?.id,id);}}}};
}
test('workshop edits real registered geometry, retains transforms and rejects invalid edits',async()=>{
 const f=fixture(),updates=[];const instance=await openExperiment(definition,{host:f.host,inputs:{source:{cells:8}},record:e=>f.events.push(e),onInputsChange:e=>updates.push(e)});
 assert.equal(f.rows.size,5,'four stones and the ray target are independently registered scene objects');
 const [{root}]=f.rows.values();assert.equal(root.geometry.groups.length,0,'one shadow draw without override-material group collisions');assert.ok(!Array.isArray(root.material));root.position.set(2,3,4);const original=root.geometry.getAttribute('position').array.slice();
 const changed=await instance.invoke('source',{relief:.045});
 assert.equal(changed.source.relief,.045);assert.notDeepEqual(root.geometry.getAttribute('position').array,original);assert.deepEqual(root.position.toArray(),[2,3,4]);
 assert.equal(changed.representations.nvidia,'unimplemented');assert.equal(changed.representations.sbtf,'unimplemented');
 await assert.rejects(instance.invoke('source',{height:-1}),/Invalid masonry/);assert.equal((await instance.read()).source.relief,.045);
 const sourceData=await instance.invoke('sourceData');assert.equal(sourceData.stones.length,4);assert.equal(sourceData.stones[0].source.config.relief,.045);
 const region=await instance.invoke('display',{mode:'regions'});assert.equal(region.display,'regions');assert.ok(root.material.isMeshBasicMaterial);assert.ok(root.geometry.getAttribute('color'),'region colors live on the vertices');
 await assert.rejects(instance.invoke('display',{mode:'learned'}),/masonry view/);assert.equal((await instance.read()).display,'regions');
 assert.ok(f.events.some(e=>e.kind==='masonry.source'&&e.phase==='applied'));
 await instance.dispose();assert.deepEqual(f.scene.children,[f.borrowed]);
});
test('bad initial source fails before opening the shared scene',async()=>{
 let opened=false;await assert.rejects(openExperiment(definition,{host:{scene:{open(){opened=true;throw Error('Opened');}}},inputs:{source:{width:-1}},record(){}}),/Invalid masonry/);assert.equal(opened,false);
});

test('a recipe invalid for a derived stone leaves all previous source state intact',async()=>{
 const f=fixture();const instance=await openExperiment(definition,{host:f.host,inputs:{source:{cells:8}},record(){}});
 const before=await instance.invoke('sourceData');
 await assert.rejects(instance.invoke('source',{seed:Number.MAX_SAFE_INTEGER}),/Invalid masonry/);
 const after=await instance.invoke('sourceData');assert.deepEqual(after.recipe.source,before.recipe.source,'accepted recipe is retained');
 const digest=data=>createHash('sha256').update(JSON.stringify(data.stones.map(s=>s.source))).digest('hex');
 assert.equal(digest(after),digest(before),'all existing source geometry is retained');
 await instance.dispose();
});


test('numeric controls mount before installing drag and release their handles',async()=>{
 const f=fixture(),elements=[];let cleaned=0;
 const document={activeElement:null,createElement(tag){const node={tag,children:[],style:{},attributes:{},listeners:{},append(...children){for(const c of children){c.parentNode=this;this.children.push(c);}},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,v){this.listeners[k]=v;}};elements.push(node);return node;}};
 f.host.controls={document,installNumberDrag({input}){assert.ok(input.parentNode,'numeric drag requires an attached input');return {dispose(){cleaned++;}};}};
 const instance=await openExperiment(definition,{host:f.host,inputs:{source:{cells:8}},record(){}});
 await instance.mount({root:document.createElement('panel'),document});
 const bevel=elements.find(e=>e.attributes['aria-label']==='Corner rounding');assert.ok(Number(bevel.max)<115,'rounding upper range must leave room for current relief');
 const input=elements.find(e=>e.attributes['aria-label']==='Margin relief');document.activeElement=input;input.value='300';input.listeners.change();
 await instance.invoke('flushEdits');
 assert.equal(Number(input.value),25,'rejected focused draft returns to the accepted value');
 const status=elements.find(e=>e.attributes.role==='status');assert.match(status.textContent,/Invalid masonry/);
 await instance.dispose();assert.equal(cleaned,6,'all numeric drag listeners are released');
});

test('inspection line stays in the recorded world and returns explicitly world normals',async()=>{
 const f=fixture();const instance=await openExperiment(definition,{host:f.host,inputs:{source:{cells:8}},record(){}});
 const [stone,,,,probe]=[...f.rows.values()].map(r=>r.root);stone.position.set(0,.14,0);stone.rotation.z=Math.PI/4;stone.scale.set(2,1,1);stone.updateMatrixWorld(true);
 const origin=new THREE.Vector3(0,1,0).applyMatrix4(stone.matrixWorld),direction=new THREE.Vector3(0,-1,0).transformDirection(stone.matrixWorld);
 const hit=await instance.invoke('inspect',{origin:origin.toArray(),direction:direction.toArray()});
 assert.ok(hit.source.hit);assert.ok(Math.abs(hit.sourceWorldNormal[0]+Math.SQRT1_2)<1e-6);assert.ok(Math.abs(hit.sourceWorldNormal[1]-Math.SQRT1_2)<1e-6);
 const line=f.scene.getObjectByProperty('isLine',true),point=()=>{line.updateWorldMatrix(true,false);return new THREE.Vector3().fromBufferAttribute(line.geometry.getAttribute('position'),0).applyMatrix4(line.matrixWorld).toArray();};
 const before=point();probe.position.x+=.4;assert.deepEqual(point(),before,'moving the target does not move a recorded ray');await instance.dispose();
});

test('display and integral tessellation are independently exercised and retained',async()=>{
 const f=fixture();const instance=await openExperiment(definition,{host:f.host,inputs:{source:{cells:8},displayCells:6},record(){}});
 const [stone]=[...f.rows.values()].map(r=>r.root);
 assert.equal(stone.geometry.getAttribute('position').count,12*6*6*3);
 const original=await instance.invoke('sourceData');
 await instance.invoke('resolution',{display:10});assert.equal(stone.geometry.getAttribute('position').count,12*10*10*3);
 assert.deepEqual((await instance.invoke('sourceData')).stones[0].source,original.stones[0].source,'display changes retain integral geometry');
 const displayed=stone.geometry;
 await instance.invoke('resolution',{integral:12});assert.equal(stone.geometry,displayed,'integral changes retain displayed mesh');
 assert.equal((await instance.invoke('sourceData')).stones[0].source.triangles.length,12*12*12);
 await instance.invoke('display',{mode:'integral'});assert.equal(stone.geometry.getAttribute('position').count,12*12*12*3);
 assert.deepEqual((await instance.invoke('recipe')).resolutions,{display:10,integral:12});await instance.dispose();
});

test('typing a leading one or decimal prefix does not rewrite the active draft',async()=>{
 const f=fixture(),elements=[];
 const document={activeElement:null,createElement(tag){const node={tag,children:[],style:{},attributes:{},listeners:{},append(...children){for(const c of children){c.parentNode=this;this.children.push(c);}},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,v){this.listeners[k]=v;}};elements.push(node);return node;}};
 f.host.controls={document,installNumberDrag({input}){input.readOnly=true;return {dispose(){}};}};
 const instance=await openExperiment(definition,{host:f.host,inputs:{source:{cells:8}},record(){}});
 try{
  await instance.mount({root:document.createElement('panel'),document});
  const input=elements.find(e=>e.attributes['aria-label']==='Display divisions');document.activeElement=input;input.readOnly=false;
  input.value='1';input.listeners.input();assert.equal(input.value,'1','leading 1 must remain a typing draft');
  input.value='16';input.listeners.input();await instance.invoke('flushEdits');assert.equal((await instance.read()).resolutions.display,16);
  const relief=elements.find(e=>e.attributes['aria-label']==='Margin relief');document.activeElement=relief;relief.readOnly=false;relief.value='0.0';relief.listeners.input();assert.equal(relief.value,'0.0','decimal prefix must survive typing');
  relief.value='0.05';relief.listeners.input();await instance.invoke('flushEdits');assert.equal((await instance.read()).source.relief,.00005);
  const seed=elements.find(e=>e.attributes['aria-label']==='Source seed');assert.equal(seed.max,'','unbounded seed drag retains single-seed step');
 }finally{await instance.dispose();}
});


test('optional operations are no-ops or return domain errors without payloads',async()=>{
 const f=fixture();const instance=await openExperiment(definition,{host:f.host,inputs:{source:{cells:6}},record(){}});
 try{await instance.invoke('source');await instance.invoke('resolution');await instance.invoke('tune');await assert.rejects(instance.invoke('display'),/masonry view/);await assert.rejects(instance.invoke('resolution',null),/masonry resolution/);}finally{await instance.dispose();}
});
test('inspection identifies the visible mesh while retaining integral and display hits',async()=>{
 const f=fixture();const instance=await openExperiment(definition,{host:f.host,inputs:{source:{cells:10},displayCells:6},record(){}});
 const ray={origin:[-.1,1,-.12],direction:[0,-1,0]};
 try{
  const displayed=await instance.invoke('inspect',ray);assert.equal(displayed.source.resolution,10);assert.equal(displayed.visibleHit.resolution,6);assert.deepEqual(displayed.visibleHit,displayed.displaySource);
  await instance.invoke('display',{mode:'integral'});const integral=await instance.invoke('inspect',ray);assert.deepEqual(integral.visibleHit,integral.source);
  await instance.invoke('display',{mode:'carrier'});const carrier=await instance.invoke('inspect',ray);assert.deepEqual(carrier.visibleHit,carrier.displayCarrier);
 }finally{await instance.dispose();}
});
