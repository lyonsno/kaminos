// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {createWorkbenchFrameService,createWorkbenchSceneHost,disposeOwnedSceneTree} from '../workbench-scene-host.mjs';
import {createWalkingCreature} from '../experiments/creature-motion/walking.experiment.mjs';
import {createCreatureBinding} from '../experiments/creature-motion/binding.experiment.mjs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const presentation=html.match(/function refreshWorkbenchAssetPresentation\(handle\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(presentation,'observe the actual application presentation guard before testing removal');
class Element {constructor(){this.children=[];}append(...n){this.children.push(...n);}setAttribute(){}remove(){}}
const document={createElement:()=>new Element(),getElementById:()=>null};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}];
const data={manifest:{vertices:3,triangles:1,bones,channels:['fixed','pelvis'],presets:[{name:'rest',palette:[I,I]}]},
 rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),
 frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},
 positions:[0,.2,0,0,.2,1,0,.2,2],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]},
 source:{motionSha256:'a'.repeat(64),frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)}};

function fixture(){
 const scene=new THREE.Scene(),rows=[],errors=[],events=[];let next=0;
 const frames=createWorkbenchFrameService({onError:e=>errors.push(e.message)});
 const refresh=vm.runInNewContext(presentation+';refreshWorkbenchAssetPresentation',{
  sceneObjects:rows,selectedPlacementEntry:()=>null,updateTransformInspector(){},window:{_kaminosDirty(){}},
  sceneObjectTransformState:o=>({position:o.position.toArray()})});
 const removeObject=({id,root})=>{const i=rows.findIndex(x=>x.id===id&&x.object===root);if(i<0)return;rows.splice(i,1);root.removeFromParent();disposeOwnedSceneTree(root,[scene]);};
 const actual=createWorkbenchSceneHost({scene,camera:new THREE.PerspectiveCamera(),controls:{target:new THREE.Vector3(),update(){}},
  loadAsset:async()=>{throw Error('not used');},registerObject:(root,metadata)=>{const row={id:'owned-'+(++next),object:root,...metadata};rows.push(row);return row;},
  findObject:root=>rows.find(r=>r.object===root),removeObject,redraw(){},onFrame:frames.onFrame});
 return {host:{controls:{document},scene:{...actual,refreshPresentation:refresh}},rows,errors,events,frames,
  record:e=>events.push(e),remove(){const row=rows[0];removeObject({id:row.id,root:row.object});}};
}

for(const mode of ['source','cycle','path'])test('walking removal is terminal without a failed frame: '+mode,async()=>{
 const f=fixture(),entry=await createWalkingCreature({host:f.host,inputs:{mode,blend_frames:0,radius:4},record:f.record},{loadSources:async()=>structuredClone(data)});
 entry.operations.play();f.frames.tick(0);const updates=entry.read().skin.updates;
 f.remove();f.frames.tick(34);f.frames.tick(68);
 assert.deepEqual(f.errors,[],'ordinary removal must not hit the missing-registration presentation guard');
 assert.ok(!f.events.some(e=>e.kind==='walking.frame'&&e.phase==='failed'));
 assert.equal(f.frames.state().activeSubscriptions,0);assert.equal(entry.read().playback.status,'removed');
 assert.equal(entry.read().host.id,null);assert.equal(entry.read().skin.updates,updates);
 await entry.dispose();assert.equal(f.frames.state().activeSubscriptions,0);
});

test('binding removal ends its subscription and cannot pose an absent object',async()=>{
 const f=fixture(),entry=await createCreatureBinding({host:f.host,inputs:{},record:f.record},{loadSkin:async()=>structuredClone(data)});
 f.frames.tick(0);const updates=entry.read().skin.updates;
 f.remove();f.frames.tick(34);f.frames.tick(68);
 assert.equal(f.frames.state().activeSubscriptions,0,'removed body must not retain deformation work');
 assert.equal(entry.read().status,'removed');assert.equal(entry.read().host.id,null);
 assert.equal(entry.read().skin.updates,updates);assert.throws(()=>entry.operations.pose({name:'rest'}),/removed/);
 await entry.dispose();assert.equal(f.frames.state().activeSubscriptions,0);assert.deepEqual(f.errors,[]);
});
