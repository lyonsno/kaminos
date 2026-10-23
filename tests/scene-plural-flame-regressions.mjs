// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {checkedRepetition} from '../scene-repetition.mjs';
import {normalizeFlameEmitterPose,flamePoseToDomain} from '../scene-flame-emitter.mjs';
import {flameSourceInputs,fireControlOwner} from '../scene-fire-domain.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fn=name=>{const a=html.indexOf(`function ${name}(`);if(name==='primaryAuthoredFlameSource')return html.slice(a).split('\n')[0];if(name==='applyVolumeEmitterFamilyRuntimeToCockpit')return html.slice(a,html.indexOf('  applyFlameEmitterPose =',a));return html.slice(a,html.indexOf('\n}',a)+2);};
test('selected radius bounds follow scale without changing the shared cockpit range',()=>{
 const text=fs.readFileSync(new URL('../flame-authoring.mjs',import.meta.url),'utf8'),a=text.indexOf('      function syncField('),code=text.slice(a,text.indexOf('\n      }',a)+8);
 let minimum=.01;const field={type:'number'},source={type:'range',min:'.02',max:'.5',value:'.01',disabled:false};
 const h={id:'volume-immersed-radius',field,source,document:{activeElement:null},readControlBounds:()=>({min:minimum,max:null}),readSourceControl:()=>({value:.01}),syncFlameRangeBounds:()=>assert.fail('selected bounds do not belong to the shared cockpit'),flameControlDisplayValue:(_id,x)=>x};
 vm.createContext(h);vm.runInContext(code,h);h.syncField(true);assert.equal(field.min,'0.01');assert.equal(field.max,'');assert.equal(source.min,'.02');minimum=.04;h.syncField(true);assert.equal(field.min,'0.04');
});
test('actual deletion and membership Undo/Redo preserve a surviving source with different fuel',async()=>{
 const pose={position:[0,-.5,0],rotation:[0,0,0],scale:[1,1,1]},make=(id,fuel)=>({id,type:'flame-emitter',transform:pose,emissionEnabled:true,emission:{domainId:'flame-field',settings:{'volume-immersed-fuel':{value:fuel}}},object:{userData:{kaminosSceneObject:{}}}});
 const a=make('flame-emitter',.2),b=make('other',.8);let cockpit=.2;const published=[];
 const h={isSceneItemVisible:()=>true,flamePoseToDomain,flamePoseInDomain:()=>true,effectiveFlameDomainControls:()=>({}),performance,structuredClone,FLAME_EMITTER_TYPE:'flame-emitter',FLAME_EMITTER_ID:'flame-emitter',FIRE_DOMAIN_ID:'flame-field',CAMERA_TYPE:'camera',fireControlOwner,sceneObjects:[a,b],sceneGroups:[],scene:{remove(){}},sceneMembershipRetainedObjects:new Map(),sceneCameras:null,flameDomainTranslation:[0,0,0],flameDomainScale:1,flameDomainFollowSource:false,flameEmitterPose:pose,flameEmitterInjectionSuspended:false,authoredFlamePresent:true,
  clearActiveSceneObjectSelection(){},sceneObjectTransformState:()=>pose,setSceneObjectMounted(){},setFlameDomainTranslation(){},serializeSceneObject:entry=>structuredClone({...entry,object:undefined}),setSceneSelection(){},renderSceneObjectList(){},updateTransformInspector(){},pruneSceneGroups(){},ensureAuthoredFlameEmitter(){},renderVolumeEmitterReceipt(){},volumePrototype:{debugState:()=>({frameCount:1})},volumeEmitterRuntimeFrame:0,routeExternalEmitters:null,
  document:{getElementById:()=>({value:'ring'})},window:{__kaminosVolumeEmitterReceipt:{effective:{family:'ring'}}},emitterCompilerControls:x=>x,readVolumeControls:()=>({emitterSourceLaw:'immersed-source'}),readVolumeSettingsValues:()=>({domControls:{'volume-immersed-fuel':{value:cockpit}}}),setVolumeControlValue:(id,v)=>{if(id==='volume-immersed-fuel')cockpit=Number(v);},applyVolumeEmitterFamilyRuntime:()=>({requested:{immersedControls:{immersedCentreX:0,immersedCentreY:-.5,immersedCentreZ:0,immersedYaw:0,immersedPitch:90}},effective:{family:'ring'}}),
  syncAuthoredFlameSources:()=>published.push(h.sceneObjects.map(x=>[x.id,x.emission.settings['volume-immersed-fuel'].value]))};
 h.checkedRepetition=checkedRepetition;vm.createContext(h);vm.runInContext(fn('primaryAuthoredFlameSource')+'\n'+fn('detachSelectionMember')+'\nasync '+fn('writeSelectionMembershipUnchecked')+'\n'+fn('applyVolumeEmitterFamilyRuntimeToCockpit'),h);
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

for(const removed of [['flame-emitter'],['flame-emitter','other']])test(`membership history restores distinct source poses and active publication after ${removed.length===1?'primary':'all-source'} deletion`,async()=>{
 const poses=[{position:[-.3,-.5,0],rotation:[0,0,.1],scale:[1,1,1]},{position:[.35,-.5,0],rotation:[0,.2,0],scale:[1,1,1]}];
 const make=(id,i)=>({id,type:'flame-emitter',source:'kaminos:analytic-flame',label:id,transform:structuredClone(poses[i]),emissionEnabled:true,emission:{domainId:'flame-field',settings:{'volume-immersed-fuel':{value:i?.8:.2}}},object:{pose:structuredClone(poses[i]),userData:{kaminosSceneObject:{}}}});
 const a=make('flame-emitter',0),b=make('other',1),published=[];let selected=[...removed];
 const shared={emitterSourceLaw:'immersed-source',immersedRadius:.1,immersedPitch:90};
 const h={structuredClone,normalizeFlameEmitterPose,FLAME_EMITTER_TYPE:'flame-emitter',FLAME_EMITTER_ID:'flame-emitter',CAMERA_TYPE:'camera',sceneObjects:[a,b],sceneGroups:[],scene:{remove(){}},sceneMembershipRetainedObjects:new Map(),sceneCameras:null,flameDomainTranslation:[0,0,0],flameDomainScale:1,flameDomainFollowSource:false,flameEmitterPose:structuredClone(poses[0]),flameEmitterInjectionSuspended:false,authoredFlamePresent:true,
 sceneObjectTransformState:object=>structuredClone(object.pose),applySceneObjectTransformState:(object,pose)=>{object.pose=structuredClone(pose);},setSceneObjectMounted(){},setFlameDomainTranslation(){},serializeSceneObject:entry=>({...structuredClone({...entry,object:undefined}),transform:structuredClone(entry.object.pose)}),setSceneSelection(){},renderSceneObjectList(){},updateTransformInspector(){},pruneSceneGroups(){},ensureAuthoredFlameEmitter(){},projectAuthoredFlameSourceControls(){},applyFlameEmitterPose(){},flamePoseInDomain:()=>true,effectiveFlameDomainControls:()=>({}),readVolumeControls:()=>shared,volumePrototype:{},window:{__kaminosVolumeEmitterReceipt:{effective:{family:'ring'}}},setInfo(){}};
 h.sceneSelectionMembers=()=>selected;h.clearActiveSceneObjectSelection=()=>{selected=[];};h.setSceneSelection=(ids)=>{for(const id of selected)h.selectionRootState(id);selected=[...ids];};
 h.syncAuthoredFlameSources=()=>published.push(flameSourceInputs(h.sceneObjects.map(h.serializeSceneObject),{controls:shared}));
 h.applyAuthoredScenePose=(id,p)=>h.applySceneObjectTransformState(h.sceneObjects.find(o=>o.id===id).object,p);
 h.checkedRepetition=checkedRepetition;vm.createContext(h);for(const name of ['primaryAuthoredFlameSource','detachSelectionMember','writeAuthoredFlameEmitterPose','selectionRootState'])vm.runInContext(fn(name),h);vm.runInContext('async '+fn('writeSelectionMembershipUnchecked'),h);
 const snapshot=()=>({objects:h.sceneObjects.map(h.serializeSceneObject),groups:[],selection:{ids:[...selected],activeId:selected.at(-1)??null},domain:[0,0,0],domainFollowSource:false});
 const edits=createSceneEdits({read:()=>null,write(){}});edits.register('@members',{read:snapshot,write:h.writeSelectionMembershipUnchecked,check:v=>v});
 const before=snapshot(),expected=flameSourceInputs(before.objects,{controls:shared});for(const id of removed)h.detachSelectionMember(id);h.clearActiveSceneObjectSelection();edits.recordApplied('@members',before,snapshot(),'Remove sources');
 await edits.undo();assert.equal(h.authoredFlamePresent,true,'Undo must restore source presence');assert.deepEqual(h.sceneObjects.map(o=>o.object.pose),poses,'Undo must restore each actual source pose');assert.deepEqual(published.at(-1),expected,'Undo must republish restored domain-space sources');
 await edits.redo();assert.equal(h.sceneObjects.length,2-removed.length);assert.equal(h.authoredFlamePresent,removed.length===1);assert.equal(published.at(-1).length,2-removed.length);
 await edits.undo();assert.deepEqual(published.at(-1),expected);
});

for(const enabled of [true,false])test(`burner graph history restores only the saved nonoriginal source (enabled=${enabled})`,async()=>{
 const pose={position:[.35,-.5,0],rotation:[0,.2,0],scale:[1.2,1.2,1.2]};
 const source={id:'other',type:'flame-emitter',label:'Independent source',transform:pose,emissionEnabled:enabled,emission:{domainId:'flame-field',settings:{'volume-immersed-fuel':{value:.8}}}};
 let cockpit=.2;const published=[],applications=[];
 const h={structuredClone,performance,normalizeFlameEmitterPose,flamePoseToDomain,fireControlOwner,
 FLAME_EMITTER_TYPE:'flame-emitter',FLAME_EMITTER_ID:'flame-emitter',FLAME_EMITTER_SOURCE:'kaminos:analytic-flame',FIRE_DOMAIN_ID:'flame-field',PROCEDURAL_MESH_TYPE:'procedural-mesh',GROUP_TYPE:'group',
 activeSceneObjectId:null,activeSceneGroupId:null,sceneObjects:[],sceneGroups:[],proceduralMeshes:new Map(),groupProxies:new Map(),scene:{add(){},remove(){}},
 authoredFlamePresent:false,flameEmitterPose:{position:[-.3,-.5,0],rotation:[0,0,0],scale:[1,1,1]},flameDomainTranslation:[0,0,0],flameDomainScale:1,flameDomainFollowSource:false,flameEmitterInjectionSuspended:false,
 volumePrototype:{debugState:()=>({frameCount:1})},volumeEmitterRuntimeFrame:0,routeExternalEmitters:null,
 window:{__kaminosVolumeEmitterReceipt:{effective:{family:'ring'}}},document:{getElementById:id=>({id,value:'ring'})},
 readVolumeControls:()=>({emitterSourceLaw:'immersed-source'}),readVolumeSettingsValues:()=>({domControls:{'volume-immersed-fuel':{value:cockpit}}}),setVolumeControlValue:(id,v)=>{if(id==='volume-immersed-fuel')cockpit=Number(v);},
 emitterCompilerControls:x=>x,flamePoseInDomain:()=>true,effectiveFlameDomainControls:()=>({}),
 applyVolumeEmitterFamilyRuntime:args=>{applications.push(args);return {requested:{immersedControls:{immersedCentreX:.35,immersedCentreY:-.5,immersedCentreZ:0,immersedYaw:0,immersedPitch:90}},effective:{family:'ring'}};},
 isFireLightFieldRoute:()=>true,createFlameEmitterHandle:()=>({userData:{kaminosSceneObject:{}}}),THREE:{},
 applySceneObjectTransformState:(o,p)=>{o.pose=structuredClone(p);},sceneObjectTransformState:o=>structuredClone(o.pose),
 registerSceneObject:(o,metadata)=>{const entry={...structuredClone(metadata),object:o};o.userData.kaminosSceneObject={...metadata};h.sceneObjects.push(entry);return entry;},
 refreshFlameDomainPreview(){},flameDomainGuide:null,updateFlameEmitterSupportOutline(){},styleHelperLines(){},isSceneItemVisible:()=>true,selectionCaptureSuspended:false,viewportHelpersVisible:true,viewportDisplay:{emitters:true,emitterOpacity:1},
 setFlameDomainTranslation:(v,s)=>{h.flameDomainTranslation=v;h.flameDomainScale=s;},disposeObjectTree(){},setSceneObjectGroupId(){},pruneSceneGroups(){},ensureGroupTarget(){},setActiveSceneGroup(){},setActiveSceneObject(){},clearActiveSceneObjectSelection(){},renderSceneObjectList(){},updateTransformInspector(){},renderVolumeEmitterReceipt(){},setInfo(){},
 syncAuthoredFlameSources:()=>published.push(h.sceneObjects.map(o=>({id:o.id,transform:structuredClone(o.object.pose),emission:structuredClone(o.emission),emissionEnabled:o.emissionEnabled}))) };
 vm.createContext(h);for(const name of ['primaryAuthoredFlameSource','projectAuthoredFlameSourceControls','ensureAuthoredFlameEmitter','applyVolumeEmitterFamilyRuntimeToCockpit','writeAuthoredFlameEmitterPose','writeBurnerGraphUnchecked'])vm.runInContext(fn(name),h);
 h.applyFlameEmitterPose=(p,opts)=>h.applyVolumeEmitterFamilyRuntimeToCockpit(h.readVolumeControls(),p,opts);
 const empty={objects:[],groups:[],domain:[0,0,0],domainScale:1,domainFollowSource:false},saved={...empty,objects:[source]};let current=empty;
 const edits=createSceneEdits({read:()=>null,write(){}});edits.register('@burner-graph',{read:()=>current,check:v=>v,write:v=>{h.writeBurnerGraphUnchecked(v);current=v;}});
 edits.recordApplied('@burner-graph',saved,empty,'Remove surviving source');
 for(let i=0;i<2;i++){
  await edits.undo();assert.deepEqual(Array.from(h.sceneObjects,o=>o.id),['other'],'Undo must not invent the original emitter');
  assert.deepEqual(published.at(-1),[{id:'other',transform:pose,emission:source.emission,emissionEnabled:enabled}]);
  assert.equal(applications.at(-1).sourceEnabled,enabled);
  await edits.redo();assert.equal(h.sceneObjects.length,0);assert.deepEqual(published.at(-1),[]);assert.equal(applications.at(-1).sourceEnabled,false);
 }
 assert.ok(published.every(records=>records.every(o=>o.id==='other')),'no intermediate publication may invent a source');
});


test('history notifications keep selected-source inspector values instead of projecting the primary cockpit',()=>{
 const start=html.indexOf('  edits.subscribe(()=>{\n    flameInspector?.sync();');
 assert.ok(start>=0,'production inspector history subscription exists');
 const code=html.slice(start,html.indexOf('  syncRimAuthoringHandle();',start));
 const selected={fuel:.8,enabled:false},primary={id:'volume-immersed-fuel',type:'range',value:'.2'};
 const alias={type:'number',value:'.8',dataset:{authoringAlias:primary.id}};
 let notify;const writes=[];
 const h={edits:{subscribe:fn=>{notify=fn;}},flameInspector:{sync:()=>{alias.value=String(selected.fuel);}},
 document:{activeElement:null,querySelectorAll:()=>[alias],getElementById:()=>primary},flameControlDisplayValue:(_id,value)=>value};
 vm.runInNewContext(code,h);notify();writes.push(alias.value);
 selected.fuel=.65;notify();writes.push(alias.value);
 selected.fuel=.8;notify();writes.push(alias.value);
 assert.deepEqual(writes,['0.8','0.65','0.8'],'begin, edit and Undo must display the selected supply');
 assert.equal(primary.value,'.2','inspector refresh must leave primary supply untouched');
});

test('shared parameter history writes let the inspector choose its selected-source projection',()=>{
 const a=html.indexOf('    const write=state=>{',html.indexOf('for(const control of collectVolumeCockpitControlElements(document))'));
 assert.ok(a>=0);const code=html.slice(a,html.indexOf('    const check=state=>{',a))+'write({value:.3});';
 const control={id:'volume-immersed-fuel',type:'range',value:'.2',dataset:{},dispatchEvent(){}};
 const alias={type:'number',value:'.8'};
 vm.runInNewContext(code,{control,Event,KeyboardEvent:Event,setVolumeControlValue:(_id,value)=>{control.value=String(value);},
 flameInspector:{sync:()=>{alias.value='.8';}},document:{querySelectorAll:()=>[alias]},flameControlDisplayValue:(_id,value)=>value});
 assert.equal(alias.value,'.8','a primary cockpit write must not impersonate another selected source');
 assert.equal(control.value,'0.3');
});
