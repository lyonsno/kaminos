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
 const f=fixture(),updates=[];const instance=await openExperiment(definition,{host:f.host,inputs:{source:{cells:8}},record:e=>f.events.push(e),updateInputs:e=>updates.push(e)});
 assert.equal(f.rows.size,5,'four stones and the ray target are independently registered scene objects');
 const [{root}]=f.rows.values();assert.ok(root.geometry.groups.length<=3,'one draw group per material region');root.position.set(2,3,4);const original=root.geometry.getAttribute('position').array.slice();
 const changed=await instance.invoke('source',{relief:.045});
 assert.equal(changed.source.relief,.045);assert.notDeepEqual(root.geometry.getAttribute('position').array,original);assert.deepEqual(root.position.toArray(),[2,3,4]);
 assert.equal(changed.representations.nvidia,'unimplemented');assert.equal(changed.representations.sbtf,'unimplemented');
 await assert.rejects(instance.invoke('source',{height:-1}),/Invalid masonry/);assert.equal((await instance.read()).source.relief,.045);
 const sourceData=await instance.invoke('sourceData');assert.equal(sourceData.stones.length,4);assert.equal(sourceData.stones[0].source.config.relief,.045);
 const region=await instance.invoke('display',{mode:'regions'});assert.equal(region.display,'regions');assert.ok(root.material.every(m=>m.isMeshBasicMaterial));
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
