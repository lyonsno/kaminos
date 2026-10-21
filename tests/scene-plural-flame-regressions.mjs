// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {flamePoseToDomain} from '../scene-flame-emitter.mjs';
import {fireControlOwner} from '../scene-fire-domain.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fn=name=>{const a=html.indexOf(`function ${name}(`);if(name==='primaryAuthoredFlameSource')return html.slice(a).split('\n')[0];if(name==='applyVolumeEmitterFamilyRuntimeToCockpit')return html.slice(a,html.indexOf('  applyFlameEmitterPose =',a));return html.slice(a,html.indexOf('\n}',a)+2);};
test('selected radius bounds follow scale without changing the shared cockpit range',()=>{
 const text=fs.readFileSync(new URL('../flame-authoring.mjs',import.meta.url),'utf8'),a=text.indexOf('      function syncField('),code=text.slice(a,text.indexOf('\n      if(id===',a));
 let minimum=.01;const field={type:'number'},source={type:'range',min:'.02',max:'.5',value:'.01',disabled:false};
 const h={id:'volume-immersed-radius',field,source,document:{activeElement:null},readControlBounds:()=>({min:minimum,max:null}),readSourceControl:()=>({value:.01}),syncFlameRangeBounds:()=>assert.fail('selected bounds do not belong to the shared cockpit'),flameControlDisplayValue:(_id,x)=>x};
 vm.createContext(h);vm.runInContext(code,h);h.syncField(true);assert.equal(field.min,'0.01');assert.equal(field.max,'');assert.equal(source.min,'.02');minimum=.04;h.syncField(true);assert.equal(field.min,'0.04');
});
test('actual deletion and membership Undo/Redo preserve a surviving source with different fuel',async()=>{
 const pose={position:[0,-.5,0],rotation:[0,0,0],scale:[1,1,1]},make=(id,fuel)=>({id,type:'flame-emitter',transform:pose,emissionEnabled:true,emission:{domainId:'flame-field',settings:{'volume-immersed-fuel':{value:fuel}}},object:{userData:{kaminosSceneObject:{}}}});
 const a=make('flame-emitter',.2),b=make('other',.8);let cockpit=.2;const published=[];
 const h={flamePoseToDomain,performance,structuredClone,FLAME_EMITTER_TYPE:'flame-emitter',FLAME_EMITTER_ID:'flame-emitter',FIRE_DOMAIN_ID:'flame-field',CAMERA_TYPE:'camera',fireControlOwner,sceneObjects:[a,b],sceneGroups:[],scene:{remove(){}},sceneMembershipRetainedObjects:new Map(),sceneCameras:null,flameDomainTranslation:[0,0,0],flameDomainScale:1,flameDomainFollowSource:false,flameEmitterPose:pose,flameEmitterInjectionSuspended:false,authoredFlamePresent:true,
  sceneObjectTransformState:()=>pose,setSceneObjectMounted(){},setFlameDomainTranslation(){},serializeSceneObject:entry=>structuredClone({...entry,object:undefined}),setSceneSelection(){},renderSceneObjectList(){},updateTransformInspector(){},pruneSceneGroups(){},ensureAuthoredFlameEmitter(){},renderVolumeEmitterReceipt(){},volumePrototype:{debugState:()=>({frameCount:1})},volumeEmitterRuntimeFrame:0,routeExternalEmitters:null,
  document:{getElementById:()=>({value:'ring'})},window:{__kaminosVolumeEmitterReceipt:{effective:{family:'ring'}}},emitterCompilerControls:x=>x,readVolumeControls:()=>({emitterSourceLaw:'legacy-volume'}),readVolumeSettingsValues:()=>({domControls:{'volume-immersed-fuel':{value:cockpit}}}),setVolumeControlValue:(_id,v)=>cockpit=Number(v),applyVolumeEmitterFamilyRuntime:()=>({requested:{},effective:{family:'ring'}}),
  syncAuthoredFlameSources:()=>published.push(h.sceneObjects.map(x=>[x.id,x.emission.settings['volume-immersed-fuel'].value]))};
 vm.createContext(h);vm.runInContext(fn('primaryAuthoredFlameSource')+'\n'+fn('detachSelectionMember')+'\nasync '+fn('writeSelectionMembershipUnchecked')+'\n'+fn('applyVolumeEmitterFamilyRuntimeToCockpit'),h);
 if(html.includes('function projectAuthoredFlameSourceControls('))vm.runInContext(fn('projectAuthoredFlameSourceControls'),h);
 h.applyFlameEmitterPose=p=>h.applyVolumeEmitterFamilyRuntimeToCockpit(h.readVolumeControls(),p);
 h.writeAuthoredFlameEmitterPose=()=>{if(h.projectAuthoredFlameSourceControls)h.projectAuthoredFlameSourceControls();h.applyFlameEmitterPose(pose);h.syncAuthoredFlameSources();};
 const snapshot=()=>({objects:h.sceneObjects.map(h.serializeSceneObject),groups:[],selection:{ids:[],activeId:null},domain:[0,0,0],domainFollowSource:false});
 const edits=createSceneEdits({read:()=>null,write(){}});edits.register('@members',{read:snapshot,write:h.writeSelectionMembershipUnchecked,check:v=>v});
 const before=snapshot();h.detachSelectionMember('flame-emitter');edits.recordApplied('@members',before,snapshot(),'Remove source');assert.equal(b.emission.settings['volume-immersed-fuel'].value,.8);assert.equal(published.at(-1)[0][1],.8);
 await edits.undo();assert.equal(h.sceneObjects.length,2);assert.equal(h.sceneObjects[1].emission.settings['volume-immersed-fuel'].value,.8);
 await edits.redo();assert.equal(h.sceneObjects.length,1);assert.equal(h.sceneObjects[0].emission.settings['volume-immersed-fuel'].value,.8);
});
test('refusing a plural restore preserves the complete current scene and usable save state',async()=>{
 const stop=html.indexOf('  setFlameDomainTranslation(restorePlan.flameDomainTranslation',html.indexOf('async function loadSceneFile('));
 const start=html.indexOf('async function loadSceneFile(');const prefix=html.slice(start,stop)+'\n}';const mutations=[];
 const original={name:'existing',route:{}},objects=[{id:'kept'}];const h={authoringBusy:false,vantageCaptureHeld:false,scenePlacementTools:null,sceneLoadRequests:{begin:()=>1,isCurrent:()=>true},currentSceneFile:'existing.json',getVolumePrimitiveState:()=>[],flameDomainTranslation:[0,0,0],flameDomainScale:1,flameDomainFollowSource:false,sceneSaveBlockedByFailedRestore:false,planSceneRestore:()=>({objects:[{id:'a',type:'flame-emitter'},{id:'b',type:'flame-emitter'}],composition:{name:'incoming',route:{}},flameSourcePresent:true}),assertSceneObjectsReloadable(){},isCompositionAuthoring:()=>true,window:{kaminosViewportSettings:{set:()=>mutations.push('display')},__kaminosVolumeEmitterReceipt:{effective:{family:'ring'}}},viewportDisplay:{},activeSceneComposition:original,sceneObjects:objects,FLAME_EMITTER_TYPE:'flame-emitter',FLAME_EMITTER_ID:'flame-emitter',setAnnularBurner:()=>mutations.push('burner'),setRimLight:()=>mutations.push('rim'),setInfo(){},volumePrototype:{},requirePluralFlameSourceRuntime:()=>{throw Error('This flame runtime does not yet support multiple authored sources');}};
 vm.createContext(h);vm.runInContext(prefix,h);await assert.doesNotReject(()=>h.loadSceneFile({text:async()=>JSON.stringify({})},{mounted:true}));assert.deepEqual(mutations,[]);assert.equal(h.activeSceneComposition,original);assert.equal(h.sceneObjects,objects);assert.equal(h.currentSceneFile,'existing.json');assert.equal(h.sceneSaveBlockedByFailedRestore,false);
});
