import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {normalizeFlameEmitterPose,normalizeFlameDomainTranslation,normalizeFlameDomainScale,effectiveFlameDomainControls} from '../scene-flame-emitter.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=name=>{const start=html.indexOf(`function ${name}(`);assert.ok(start>=0);return html.slice(start,html.indexOf('\n}',start)+2);};
const engine={translate:[0,0,0],scale:1};let rebuilds=0,sourceWrites=0,reject=false;
const ctx={THREE,structuredClone,normalizeFlameEmitterPose,normalizeFlameDomainTranslation,normalizeFlameDomainScale,effectiveFlameDomainControls,readVolumeControls:()=>({resolution:64,gridHeightRatio:2}),
 flameDomainTranslation:[0,0,0],flameDomainScale:1,flameDomainFollowSource:true,flameDomainDraft:null,flameDomainProxy:null,flameDomainGuide:{box:new THREE.Box3()},
 selectionCaptureSuspended:false,viewportHelpersVisible:true,viewportDisplay:{domains:true,domainOpacity:.82,domainWidth:1,emitters:true,emitterWidth:1,emitterOpacity:.82},styleHelperLines(){},sceneSelectionMembers:()=>[],FLAME_EMITTER_ID:'flame-emitter',activeSceneFieldId:'flame-field',transformControls:null,document:{getElementById:()=>null},window:{},setInfo(){},volumePrimitivesInFlameDomain:()=>[],applyFlameEmitterPose(){},
 authoredFlamePresent:true,flameEmitterPose:{position:[.2,-.76,0],rotation:[0,0,0],scale:[1,1,1]},flameEmitterInjectionSuspended:false,
 writeAuthoredFlameEmitterPose(){sourceWrites++;},volumePrototype:{relocateOrdinaryDomain(t,p,s){if(reject)throw Error('admission failed');engine.translate=[...t];engine.scale=s;rebuilds++;}}};
vm.createContext(ctx);vm.runInContext(['flameDomainTopY','acceptedFlameDomainPose','checkedFlameDomainPose','domainTransformForPose','refreshFlameDomainPreview','writeFlameDomainPreview','setFlameDomainTranslation','settleAuthoredFlameDomain'].map(grab).join('\n'),ctx);
const edits=createSceneEdits({read(){},write(){},captureContext:()=>ctx.flameDomainFollowSource,settled:ctx.settleAuthoredFlameDomain});
edits.register('@flame-domain',{read:()=>ctx.flameDomainDraft||ctx.acceptedFlameDomainPose(),write:ctx.writeFlameDomainPreview,check:ctx.checkedFlameDomainPose});
edits.subscribe(state=>{if(!state.active)ctx.flameDomainDraft=null;});
const original=structuredClone(ctx.flameEmitterPose);
edits.begin('@flame-domain');edits.preview({scale:[2,2,2]});
assert.equal(rebuilds,0);assert.deepEqual(ctx.flameDomainGuide.box.min.toArray(),[-2,-3,-2]);
edits.cancel();assert.equal(rebuilds,0);assert.deepEqual(ctx.flameDomainGuide.box.min.toArray(),[-1,-1,-1]);
edits.apply('@flame-domain',{scale:[2,2,2]});assert.equal(rebuilds,1);assert.equal(engine.scale,2);assert.equal(ctx.flameDomainFollowSource,false);
assert.deepEqual(ctx.flameEmitterPose,original);assert.equal(edits.state().undoCount,1);
edits.undo();assert.equal(engine.scale,1);assert.equal(ctx.flameDomainFollowSource,true);
edits.redo();assert.equal(engine.scale,2);assert.equal(ctx.flameDomainFollowSource,false);
assert.throws(()=>edits.apply('@flame-domain',{rotation:[0,.1,0]}),/world axes/);
assert.throws(()=>edits.apply('@flame-domain',{scale:[1,2,1]}),/uniform/);
assert.equal(edits.state().active,null);
console.log('Actual editor preview/cancel, one restart, history and source preservation pass');
