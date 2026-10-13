import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFileSync}from'node:fs';
import{flamePoseInDomain,flamePoseToDomain,normalizeFlameEmitterPose,immersedControlsForFlamePose,flameDomainTranslationForAcceptedPose}from'../scene-flame-emitter.mjs';
import{buildSceneDocument,planSceneRestore}from'../scene-persistence-core.js';
const html=readFileSync(process.env.KAMINOS_HEIGHT_PAGE_SOURCE||new URL('../index.html',import.meta.url),'utf8'),grab=name=>{const at=html.indexOf(`function ${name}(`);return html.slice(at,html.indexOf('\n}',at)+2);};
const pose=y=>({position:[0,y,0],rotation:[0,0,0],scale:[1,1,1]});
test('effective height admits the added rows and excludes removed rows through editor and immersed mapping',()=>{
 for(const [ratio,y,inside]of[[3,4,true],[1,2,false]]){
  const shape={resolution:64,gridHeightRatio:ratio},t=[.5,-.3,.2],s=1.5,p={...pose(y),position:[t[0],t[1]+y*s,t[2]]};
  assert.equal(flamePoseInDomain(p,t,s,shape),inside);
  const local=flamePoseToDomain(p,t,s);
  if(inside){assert.equal(immersedControlsForFlamePose({...shape,immersedRadius:.2},local,true).immersedCentreY,y);assert.deepEqual(flameDomainTranslationForAcceptedPose(p,t,{scale:s,shape}),t);}
  else assert.throws(()=>immersedControlsForFlamePose({...shape,immersedRadius:.2},local,true),/outside/);
  const calls=[],context={normalizeFlameEmitterPose,flamePoseInDomain,readVolumeControls:()=>shape,flameEmitterInjectionSuspended:false,authoredFlamePresent:true,flameDomainTranslation:t,flameDomainScale:s,window:{__kaminosVolumeEmitterReceipt:{effective:{family:'ring'}}},applyFlameEmitterPose:(p,o)=>calls.push(o.sourceEnabled),ensureAuthoredFlameEmitter(){},setInfo(){},renderSceneObjectList(){}};
  vm.createContext(context);vm.runInContext(grab('writeAuthoredFlameEmitterPose'),context);context.writeAuthoredFlameEmitterPose(p);assert.equal(calls.at(-1),inside);
 }
});
test('following domain height is preserved through save and restore without recentering a legal tall source',()=>{
 const settings={domControls:{'volume-resolution':{value:64},'volume-grid-height-ratio':{value:3}},rendererControls:{},presentationControls:{}},composition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:'vsp-'+'a'.repeat(64),stationary:true},lightGainStops:0,route:{volume_light_field:'1'}};
 const doc=buildSceneDocument({objects:[{id:'flame-emitter',type:'flame-emitter',source:'kaminos:analytic-flame',transform:pose(4)}],fireSettings:settings,composition,flameDomainTranslation:[0,0,0],flameDomainFollowSource:true});
 assert.deepEqual(planSceneRestore(doc).flameDomainTranslation,[0,0,0]);
 doc.objects.find(o=>o.type==='simulation-domain').simulation.settings['volume-grid-height-ratio'].value=1;
 assert.throws(()=>planSceneRestore(doc),/outside/);
});
test('voxel readout names the effective grid through preview, refused requests and missing identity',()=>{
 const input={},status={textContent:''},output={textContent:''},shape={simGridDimensions:[64,160,64]},context={document:{getElementById:id=>id==='kiln-collision-enabled'?input:id==='kiln-collision-status'?status:id==='kiln-voxel-resolution'?output:{value:'96'}},sceneObjects:[],isAuthoredKilnCollisionRoute:()=>true,syncCollisionVoxelView(){},volumePrototype:{debugState:()=>shape},window:{__kaminosVolumeGridPreview:{dimensions:[96,288,96]}}};
 vm.createContext(context);vm.runInContext(grab('syncKilnCollisionControl'),context);context.syncKilnCollisionControl();assert.match(output.textContent,/64×160×64/);shape.simGridDimensions=[64,128,64];context.syncKilnCollisionControl();assert.match(output.textContent,/64×128×64/);delete shape.simGridDimensions;context.syncKilnCollisionControl();assert.match(output.textContent,/await|unavailable|unverified/i);
});

test('confirmed shape updates reevaluate an immersed source instead of retaining a stale suspension',()=>{
 const at=html.indexOf('  function applyVolumeEmitterFamilyRuntimeToCockpit('),end=html.indexOf('  applyFlameEmitterPose =',at),calls=[];
 const controls={resolution:64,gridHeightRatio:3,emitterSourceLaw:'immersed-source'},fields=new Map();
 const context={performance,structuredClone,flamePoseInDomain,flamePoseToDomain,flameEmitterPose:pose(4),flameDomainTranslation:[0,0,0],flameDomainScale:1,flameEmitterInjectionSuspended:true,authoredFlamePresent:true,routeExternalEmitters:null,volumeEmitterRuntimeFrame:0,volumePrototype:{debugState:()=>({frameCount:1})},document:{getElementById:id=>{if(id==='emitter-assay-family')return{value:'ring'};if(!fields.has(id))fields.set(id,{id,value:'0',textContent:''});return fields.get(id);}},emitterCompilerControls:x=>x,applyVolumeEmitterFamilyRuntime:request=>{calls.push(request.sourceEnabled);return {requested:{immersedControls:immersedControlsForFlamePose(request.controls,request.emitterPose,request.sourceEnabled)},effective:{family:'ring'}};},window:{},setVolumeControlValue(id,v){fields.get(id).value=String(v);},renderVolumeEmitterReceipt(){},ensureAuthoredFlameEmitter(){}};
 vm.createContext(context);vm.runInContext(html.slice(at,end),context);context.applyVolumeEmitterFamilyRuntimeToCockpit(controls);assert.equal(calls.at(-1),true);assert.equal(context.flameEmitterInjectionSuspended,false);
 context.applyVolumeEmitterFamilyRuntimeToCockpit({...controls,gridHeightRatio:1});assert.equal(calls.at(-1),false);assert.equal(context.flameEmitterInjectionSuspended,true);assert.deepEqual(context.flameEmitterPose.position,[0,4,0]);
});
