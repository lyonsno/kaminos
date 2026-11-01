// kaminos-test: node
import assert from 'node:assert/strict';import * as T from '../lib/three.core.js';
import {createPosedSkeleton,loadPosedSkeletonSources} from '../experiments/creature-motion/posed-skeleton.experiment.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';import {sceneContentBounds,frameSceneObjectRecord} from '../scene-frame-selected.mjs';
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I}],data={manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},positions:[0,0,0,0,0,1,0,0,2],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]},source:{caseSha256:'a'.repeat(64)}};
const scene=new T.Scene(),assets=[],edits=createSceneEdits({read:()=>null,write:()=>{}}),document={getElementById:()=>null,defaultView:{kaminosSceneEdits:edits,kaminosSelection:{set(){}}}};
const session={attach:async root=>{scene.add(root);const asset={id:'object-'+assets.length,root};assets.push(asset);return asset;},redraw(){},setView(){},readView:()=>({position:[3,2,3],target:[0,0,0]}),dispose:async()=>{for(const a of assets)a.root.removeFromParent();}};
const host={controls:{document,components:{register:()=>({changed:f=>f(),dispose(){}})}},scene:{open:async()=>session}};
const entry=await createPosedSkeleton({host,inputs:{}},{loadSources:async()=>data});
try{const creature=assets.find(a=>a.root.name.includes('pose skeleton')),size=sceneContentBounds(creature.root).getSize(new T.Vector3());assert(size.length()<3,'Native creature framing must exclude the 30-unit comparison stage');const stage=assets.find(a=>a!==creature);assert(stage,'Reference stage is separately registered');scene.updateMatrixWorld(true);const before=stage.root.matrixWorld.clone();creature.root.position.set(2,0,0);creature.root.rotation.z=.4;scene.updateMatrixWorld(true);assert.deepEqual(stage.root.matrixWorld.toArray(),before.toArray());const c=new T.PerspectiveCamera(50,1,.01,1000),controls={target:new T.Vector3(),update(){}};c.position.set(3,2,3);assert(frameSceneObjectRecord({object:creature.root},c,controls));assert(c.position.distanceTo(controls.target)<6,'Native Frame Selected must remain near the creature');}finally{await entry.dispose();}assert(assets.every(a=>!a.root.parent));console.log('Actual posed factory keeps the stage separate through native framing and whole-creature transforms, and cleans both registrations');

// Generated casts can contain more vertices than a JS call accepts as arguments.
const count=340494,dense={...data,manifest:{...data.manifest,vertices:count},rest:new Float32Array(count*3),weights:new Float32Array(count*2)};
dense.rest[(count-1)*3+1]=-3;for(let i=0;i<count;i++)dense.weights[i*2+1]=1;
const start=assets.length,large=await createPosedSkeleton({host,inputs:{view:{position:[4,2,4],target:[0,0,0]}}},{loadSources:async()=>dense});
try{assert.equal(assets.slice(start).find(a=>a.root.name==='Pose reference floor').root.position.y,-3.04);}finally{await large.dispose();}

// A generated body can be posed before any motion producer has run.
const staticData={...data};delete staticData.motion;delete staticData.frame;
const staticEntry=await createPosedSkeleton({host,inputs:{}},{loadSources:async()=>staticData});
try{
 assert.equal(staticEntry.read().base.kind,'rest');
 const before=staticEntry.operations.snapshot();
 assert.throws(()=>staticEntry.operations.base({kind:'motion'}),/No motion source/);
 assert.deepEqual(staticEntry.operations.snapshot(),before,'Missing motion must not mutate the current pose');
 staticEntry.operations.axis({joint:'pelvis',axis:[0,1,0],degrees:20});
 assert.notDeepEqual(staticEntry.operations.snapshot(),before,'Static bind must permit actual joint rotation');
 staticEntry.operations.reset();
 assert.deepEqual(staticEntry.operations.snapshot(),before);
}finally{await staticEntry.dispose();}
assert(assets.every(a=>!a.root.parent));

const calls=[];const dependencies={loadSkin:async x=>{calls.push('skin');return staticData;},loadMotion:async()=>{calls.push('motion');throw Error('rejected motion source');}};
assert.equal((await loadPosedSkeletonSources({case:'fixture'},dependencies)).source.poseRoute,'static-bind');
for(const key of ['motion','motion_data','motion_sha256','prefix','prefix_sha256','frame','frame_sha256'])await assert.rejects(loadPosedSkeletonSources({[key]:null},dependencies),/rejected motion source/);
assert.deepEqual(calls,['skin',...Array(7).fill('motion')],'Partial or rejected motion inputs must never fall back to static binding');
