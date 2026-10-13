import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {normalizeFlameEmitterPose,normalizeFlameDomainTranslation,normalizeFlameDomainScale} from '../scene-flame-emitter.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=name=>{const start=html.indexOf(`function ${name}(`);assert.ok(start>=0,name);return (html.slice(start-6,start)==='async '?'async ':'')+html.slice(start,html.indexOf('\n}',start)+2);};
function fixture(family='ring'){
 const c={THREE,structuredClone,normalizeFlameEmitterPose,normalizeFlameDomainTranslation,normalizeFlameDomainScale,
 scene:new THREE.Scene(),sceneObjects:[],sceneGroups:[],sceneCameras:null,scenePlacementTools:null,
 activeSceneComposition:{},activeSceneFieldId:'flame-field',activeSceneObjectId:null,viewportHelpersVisible:true,viewportDisplay:{domains:true,domainOpacity:.82,domainWidth:1,emitters:true,emitterWidth:1,emitterOpacity:.82},styleHelperLines(){},selectionCaptureSuspended:false,
 FLAME_EMITTER_ID:'flame-emitter',flameDomainTranslation:[0,0,0],flameDomainScale:1,flameDomainFollowSource:true,flameDomainDraft:null,flameDomainProxy:null,flameDomainGuide:null,
 transformControls:null,document:{getElementById:()=>null},window:{__kaminosVolumeEmitterReceipt:{effective:{family}}},setInfo(){},volumePrimitivesInFlameDomain:()=>[],applyFlameEmitterPose(){throw Error('analytic source must not be invoked');},
 authoredFlamePresent:true,flameEmitterPose:{position:[0,-.76,0],rotation:[0,0,0],scale:[1,1,1]},flameEmitterInjectionSuspended:false,
 volumePrototype:{relocateOrdinaryDomain(){}},isFireLightFieldRoute:()=>true,disposeObjectTree(){},sceneSelectionMembers:()=>[],pruneSceneGroups(){},pruneSceneSelection(){},renderSceneObjectList(){},updateTransformInspector(){},setSceneSelection(){},ensureGroupTarget(){},applySceneObjectTransformState(o,p){o.position.fromArray(p.position);o.scale.fromArray(p.scale);}};
 vm.createContext(c);vm.runInContext(['flameDomainTopY','acceptedFlameDomainPose','checkedFlameDomainPose','domainTransformForPose','refreshFlameDomainPreview','writeFlameDomainPreview','setFlameDomainTranslation','settleAuthoredFlameDomain','writeAuthoredFlameEmitterPose','ensureAuthoredFlameEmitter','writeSelectionMembershipUnchecked'].map(grab).join('\n'),c);return c;
}
test('cluster membership replay and domain resize never invoke analytic placement',async()=>{
 const c=fixture('cluster');await c.writeSelectionMembershipUnchecked({objects:[],groups:[],selection:{ids:[],activeId:null},domain:[0,0,0]});
 c.settleAuthoredFlameDomain({operation:'commit',after:{position:[1,2,0],rotation:[0,0,0],scale:[2,2,2]}});
 assert.equal(c.flameDomainScale,2);assert.equal(c.flameDomainFollowSource,false);
});
test('source-free field retains and reconstructs its own bounds for preview/cancel',()=>{
 const c=fixture();const emitter=new THREE.Object3D();c.scene.add(emitter);c.sceneObjects=[{id:'flame-emitter',object:emitter}];c.flameDomainGuide=new THREE.Box3Helper(new THREE.Box3());c.scene.add(c.flameDomainGuide);
 c.authoredFlamePresent=false;c.ensureAuthoredFlameEmitter();
 assert.ok(c.flameDomainGuide,'removing the source must retain the field outline');assert.equal(c.sceneObjects.length,0);
 // A source-free saved scene starts without any old helper.
 c.scene.remove(c.flameDomainGuide);c.flameDomainGuide=null;c.flameDomainTranslation=[.2,-.5,0];c.flameDomainScale=1.5;c.ensureAuthoredFlameEmitter();
 assert.ok(c.flameDomainGuide,'source-free reopening reconstructs the field outline');assert.equal(c.flameDomainGuide.visible,true);
 assert.deepEqual(c.flameDomainGuide.box.min.toArray(),[-1.3,-2,-1.5]);
 c.writeFlameDomainPreview({position:[0,1,0],rotation:[0,0,0],scale:[2,2,2]});assert.deepEqual(c.flameDomainGuide.box.min.toArray(),[-2,-3,-2]);
 c.flameDomainDraft=null;c.refreshFlameDomainPreview();assert.deepEqual(c.flameDomainGuide.box.min.toArray(),[-1.3,-2,-1.5]);
});
