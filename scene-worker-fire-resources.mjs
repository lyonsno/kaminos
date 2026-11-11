import {planSceneRestore} from './scene-persistence-core.js';
import {createSceneWorkerFireSettingsLoader} from './scene-worker-fire-settings.mjs';
import {flameSourceInputs,checkedFireSourceRecord} from './scene-fire-domain.mjs';
import {FLAME_EMITTER_TYPE,createFlameEmitterHandle} from './scene-flame-emitter.mjs';
import {applySceneObjectTransformState} from './scene-object-state.mjs';
import {checkedFireRendering} from './scene-fire-render-settings.mjs';
import {LOCAL_LIQUID_EMITTER_TYPE,normalizeLocalLiquidEmitter} from './local-liquid-setup.mjs';
import {createLocalLiquidEmitterObject,isLocalLiquidEmitterSceneRecord} from './local-liquid-scene-object.mjs';
import {createAuthoredWaterFeature} from './authored-water-feature.mjs';
import {mountSceneRadianceResources} from './scene-radiance-resource-mount.mjs';
import {readFireShadowSceneSettings} from './fire-shadow-scene-settings.mjs';
import {createSceneFireLightReceiver} from './scene-fire-light-receiver.mjs';
import {createFireLightFieldShadow,renderFireShadowBatch} from './fire-light-field-shadow.mjs';
import {createFireShadowCasters} from './fire-shadow-casters.mjs';
import {createSceneFlameHDR} from './scene-flame-hdr.mjs';

// These are the already-applied route coefficients supplied by the actual page
// mapper. A saved control write clears preset UI identity, as on the page.
function routeValues(c){
 return {activeVolumeRayBudgetPreset:'',routedVolumeRayBudgetPreset:'',activeCanonicalVolumeMacroPreset:'',
  routedCanonicalSourceMode:c.canonicalSourceMode,routedCanonicalRenderMode:c.canonicalRenderMode,routedCanonicalMotionMode:c.canonicalMotionMode,routedCanonicalContentMode:c.canonicalContentMode,
  routedCanonicalSourceY:c.canonicalSourceY,routedCanonicalInjection:c.canonicalSourceInjection,routedCanonicalBuoyancy:c.canonicalBuoyancy,
  routedVolumeReactionFuelScale:c.reactionFuelScale,routedVolumePressureIterations:c.pressureIterations,routedVolumePressureStrategy:c.pressureStrategy,routedVolumePressureMode:c.pressureMode,
  routedVolumeSimProfile:c.simProfile,routedVolumeLifecycleEffect:c.lifecycleEffect,routedVolumeLifecycleT:c.lifecycleT,routedVolumeQuenchVapor:c.quenchVapor,
  routedVolumeRuntimeQuality:c.runtimeQualityRequested,routedVolumeGpuPressure:c.gpuPressure,routedVolumeQualityReason:c.runtimeQualityReason,
  routedBonfireAblationControls:Object.fromEntries(Object.entries(c).filter(([key])=>key.startsWith('bonfire')))};
}

// The actual fire contribution to the ordinary scene owner. Return this shell
// synchronously so every later allocation remains reachable on failed setup.
export function createSceneWorkerFireResources(input,{definitions,fetch:request=globalThis.fetch,settingsLoader=null,mountRadiance=mountSceneRadianceResources}={}){
 const {THREE,scene,camera,sharedGpu,renderResources,payload,ordinary,readFlameControls,applyFlameControls}=input;
 const readGpu=()=>typeof input.readSharedGpu==='function'?input.readSharedGpu():sharedGpu;
 const url=new URL(payload.location?.href??payload.location??'http://localhost/');
 let volume=null,plan=null,prepared=null,radiance=null,hdr=null,retiring=false,transport=false,lightingStatus=null,configured=null,sourceSignature=null;
 let rendering=checkedFireRendering(),documentData=null,waterPreview=false;
 const preparedDocuments=new WeakMap(),receiverOwners=new Set(),pendingHandles=new Set();
 const present=()=>Boolean(plan?.composition||plan?.hasVolumePrimitiveScene||url.searchParams.get('kaminos_volume_smoke')==='1');
 const route=(target=plan)=>{const result=new URLSearchParams(url.search);for(const [key,value]of new URLSearchParams(url.hash.slice(1)))if(!result.has(key))result.set(key,value);for(const [key,value]of Object.entries(target?.composition?.route??{}))if(!result.has(key))result.set(key,value);return result;};
 const loader=settingsLoader??createSceneWorkerFireSettingsLoader({definitions,fetch:request,mappingOptions:next=>({route:routeValues(readFlameControls()),params:url.searchParams,lightFieldParams:route(next)})});
 const check=ctx=>{ctx.assertCurrent();if(retiring)throw Error('Fire resources are retiring');};
 const records=()=>ordinary.workingScene.objects.filter(row=>row.type===FLAME_EMITTER_TYPE).map(row=>ordinary.authored.records.serialize(row));
 const waterFeature=createAuthoredWaterFeature({services:()=>({renderer:renderResources.renderer,scene,camera,pipeline:ordinary.lighting.renderPipeline,device:readGpu().device,
   readColliders:()=>ordinary.workingScene.objects,decorateOutput:node=>ordinary.decorateOutput(node)}),emitters:waterRecords,visible:()=>ordinary.visible('water-field'),preview:value=>{waterPreview=value;syncWaterPreview();}});
 function waterRecords(){return ordinary.workingScene.objects.filter(row=>row.type===LOCAL_LIQUID_EMITTER_TYPE).map(row=>ordinary.authored.records.serialize(row));}
 function syncWaterPreview(){for(const row of ordinary.workingScene.objects)if(row.type===LOCAL_LIQUID_EMITTER_TYPE)row.object.traverse(node=>{if(node.userData.kaminosWaterPreview)node.visible=waterPreview&&ordinary.visible('water-field')&&ordinary.visible(row.id);});}
 function readWater(){return {present:waterFeature.setup!==null,preview:waterFeature.setup!==null&&waterPreview,paused:waterFeature.paused,simulationMounted:waterFeature.host!==null,failure:waterFeature.failure,host:waterFeature.host?.state()??null};}
 function assertWaterRecord(record){
  if(!isLocalLiquidEmitterSceneRecord(record))throw Error('Water emitter requires its stable source identity');
  normalizeLocalLiquidEmitter(record.localLiquidEmitter,record.transform);
  if(record.localLiquidEmitter.mode!=='finite_drop')throw Error('Continuous water dynamics are not mounted in this worker yet');
 }
 function renderingFor(data,next){
  const params=route(next),shadow=params.get('volume_light_field_hybrid')==='1'?readFireShadowSceneSettings(params):{};
  return checkedFireRendering({...('directions'in shadow?{'rendering-angular-samples':shadow.directions}:{}),...('angularPattern'in shadow?{'rendering-angular-pattern':shadow.angularPattern}:{}),...data.postprocessing?.fireLighting});
 }
 function refreshOrdinaryLighting(){ordinary.appearance.applyStudio();ordinary.rebuildDisplay();}
 function sourceRecords(){const live=records();return live.length||documentData?live:plan?.flameSources??[];}
 function syncSources(){
  if(!volume||!plan?.composition)return;
  const sources=sourceRecords(),controls=readFlameControls();
  if(sources.length>1&&(controls.emitterSourceLaw!=='immersed-source'||sources.some(record=>(record.emission?.settings?.['volume-emitter-source-law']?.value??controls.emitterSourceLaw)!=='immersed-source')))throw Error('Multiple scene sources require the immersed source law');
  const immersed=sources.every(record=>(record.emission?.settings?.['volume-emitter-source-law']?.rawValue??record.emission?.settings?.['volume-emitter-source-law']?.value??controls.emitterSourceLaw)==='immersed-source');
  const values=immersed?flameSourceInputs(sources,{controls,translation:plan.flameDomainTranslation??[0,0,0],scale:plan.flameDomainScale??1,visible:ordinary.visible,
   worldSources:controls.worldSmoke==='on'&&controls.emitterSourceLaw==='immersed-source'}):[];
  const key=JSON.stringify(values);if(key!==sourceSignature){volume.setImmersedSources(values);sourceSignature=key;}
 }
 function configure(){
  if(!volume)return;
  const primitives=plan?.volumePrimitives?.primitives??[];
  const next={primitives,world:plan?.flameWorldFrame??null,translation:plan?.flameDomainTranslation??[0,0,0],scale:plan?.flameDomainScale??1};
  if(configured===null||JSON.stringify(configured.primitives)!==JSON.stringify(primitives))volume.setVolumePrimitives(primitives);
  if(configured===null||JSON.stringify(configured.world)!==JSON.stringify(next.world))volume.restoreWorldFrame(next.world);
  if(configured===null||JSON.stringify(configured.translation)!==JSON.stringify(next.translation)||configured.scale!==next.scale)volume.relocateOrdinaryDomain(next.translation,primitives,next.scale);
  if(prepared){const receipt=volume.setRaymarchSmokePresentationMode(prepared.presentation);if(receipt?.fallbackReason||receipt?.effectiveMode!==prepared.presentation)throw Error('Smoke presentation did not apply');}
  configured=structuredClone(next);syncSources();
 }
 function syncTransport(){
  if(!volume)return;
  const settings=ordinary.readSettings(),p=route();
  const wanted=Boolean(volume.isActive()&&ordinary.visible('flame-field')&&ordinary.bloom?.read().settings.composeFlame
   &&!waterFeature.host&&p.get('volume_light_field_scene_depth')==='1'&&camera.isPerspectiveCamera&&(settings.gi.mode==='gtao'||settings.gi.view==='scene'));
  if(wanted!==transport){volume.setSceneTransportConsumer(wanted?frame=>ordinary.frames.consumeTransport(frame):null);transport=wanted;}
 }
 async function releaseRadiance(){
  lightingStatus=null;
  if(volume&&transport){volume.setSceneTransportConsumer(null);transport=false;}
  if(radiance){await radiance.dispose();radiance=null;}
  if(hdr){await hdr.dispose();hdr=null;}
 }
 async function mount(ctx){
  check(ctx);await releaseRadiance();check(ctx);
  const params=route();if(!present()||params.get('volume_light_field')!=='1'){refreshOrdinaryLighting();return;}
  radiance=await mountRadiance({params,readResources:()=>({renderer:renderResources.renderer,scene,prototype:volume,device:readGpu().device,
   surfaceLighting:ordinary.surfaceLighting,shadowSettings:params.get('volume_light_field_hybrid')==='1'?readFireShadowSceneSettings(params):undefined,
   rebuild:{hold:value=>ordinary.lightingPreparation.setExternalHold(value),prepare:change=>ordinary.lightingPreparation.request(change)},
   readSourceRecords:sourceRecords,readControls:readFlameControls,
   getSourceGuide:()=>{const c=readFlameControls();return {position:sourceRecords()[0]?.transform.position??[0,0,0],radius:c.inputRadius,height:c.plumeHeight,depth:c.emitterSourceDepth};},
   onStatus:state=>{lightingStatus=structuredClone(state);}})});
  check(ctx);
  if(params.get('volume_light_field_distributed')==='1'){
   radiance.setGain(2**(plan?.composition?.lightGainStops??0));radiance.setSurfaceGain(2**rendering['rendering-surface-gain']);
   radiance.setSurfaceScattering(rendering['rendering-surface-scattering']);radiance.setSmokeMode(rendering['rendering-smoke-solver']);radiance.setSourceSoftness(rendering['rendering-source-softness']);
   radiance.setDirections(rendering['rendering-angular-samples']);radiance.setAngularPattern(rendering['rendering-angular-pattern']);
  }
  if(params.get('volume_light_field_hybrid')==='1'&&params.has('volume_light_field_hybrid_caster_level')){
   try{await radiance.setShadowCasterLevel(readFireShadowSceneSettings(params).shadowCasterLevel);}
   catch(error){if(!radiance.debugState?.().casters?.error)throw error;}check(ctx);
  }
  if(radiance.prepareShadowCasters){const t=plan?.flameDomainTranslation??[0,0,0],s=plan?.flameDomainScale??1,c=readFlameControls();
   await radiance.prepareShadowCasters({flameBox:{min:t.map(value=>value-s),max:[t[0]+s,t[1]+(2*(c.gridHeightRatio??2)-1)*s,t[2]+s]}});check(ctx);}
  refreshOrdinaryLighting();syncTransport();
 }
 function checkSources(next,values){
  const controls=values?.controls??readFlameControls(),sources=next.flameSources??[];
  if(sources.length>1&&(controls.emitterSourceLaw!=='immersed-source'||sources.some(record=>(record.emission?.settings?.['volume-emitter-source-law']?.rawValue??record.emission?.settings?.['volume-emitter-source-law']?.value??controls.emitterSourceLaw)!=='immersed-source')))throw Error('Multiple scene sources require the immersed source law');
  if(sources.length&&controls.emitterSourceLaw==='immersed-source')flameSourceInputs(sources,{controls,translation:next.flameDomainTranslation??[0,0,0],scale:next.flameDomainScale??1,worldSources:controls.worldSmoke==='on'});
 }
 async function prepareDocument(data,next,meta){check(meta.context);const values=await loader.prepare(next,meta.context);check(meta.context);checkSources(next,values);preparedDocuments.set(next,{values,rendering:renderingFor(data,next)});}
 function accept(data,next,values,ctx,nextRendering=renderingFor(data,next)){
  check(ctx);checkSources(next,values);plan=next;prepared=values;rendering=nextRendering;
  if(values)applyFlameControls(values.controls,ctx);
 }
 const shell={
  get initialVolumeActive(){return !payload.admission?.data&&present();},
  get volumeOptions(){return {transparentCanvas:Boolean(plan?.composition),externalProductTransform:{translate:plan?.flameDomainTranslation??[0,0,0],scale:plan?.flameDomainScale??1},
   getSceneDepth:()=>ordinary.frames.depth({enabled:route().get('volume_light_field_scene_depth')==='1',held:retiring})};},
  async initialize(ctx){check(ctx);if(payload.admission?.data){const data=payload.admission.data;const next=planSceneRestore(data,{allowEmpty:true});shell.document.assertSupported(data,next);const values=await loader.prepare(next,ctx);accept(data,next,values,ctx);}},
  async prepareVolume({volume:next,context}){check(context);if(volume!==next){configured=null;sourceSignature=null;}volume=next;configure();},
  async attachVolume({volume:next,context}){check(context);volume=next;if(!payload.admission?.data)await mount(context);},
  async releaseVolume({context}){check(context);await releaseRadiance();for(const owner of receiverOwners){await owner.dispose();receiverOwners.delete(owner);}},
  async reattachVolume({volume:next,context}){check(context);if(next!==volume)throw Error('Prepare the replacement volume before reattachment');configure();await mount(context);},
  prepareFrame(){syncSources();syncTransport();syncWaterPreview();},
  readFrameState(){syncTransport();const params=route();return {transportRequired:transport,radianceReady:!radiance||radiance.canRender(),fireLightFieldRoute:present()&&params.get('volume_light_field')==='1',distributed:present()&&params.get('volume_light_field_distributed')==='1',
   simInputs:{flame:{active:Boolean(volume?.isActive()&&ordinary.visible('flame-field'))},water:{active:waterFeature.active},ash:{active:false,due:false}}};},
  readDrawSettings(){return {waterVisible:ordinary.visible('water-field'),flameHDRActive:transport,customToneMapping:readFlameControls().toneMapping==='custom',matchFlameCamera:present()&&rendering['rendering-match-flame-camera']};},
  readRouteParams:route,
  readDrawResources:()=>({waterFeature}),
  readUi:()=>({water:readWater(),fireLighting:structuredClone(lightingStatus),surfaces:{volume:{visible:!transport}}}),
  createFireLightReceiver:(base,depth,normal)=>createSceneFireLightReceiver({THREE,sharedGpu:readGpu(),renderer:renderResources.renderer,scene,camera,sceneGiProxies:ordinary.giProxies,routeParams:route(),
   readLightField:()=>volume?.fireIrradianceLightField()??null,createFireLightFieldShadow,createFireShadowCasters,renderFireShadowBatch,retain:owner=>receiverOwners.add(owner)},base,depth,normal),
  drawOperations:{beforeDraw(){},syncProxies(){},readPhysicalCamera:()=>volume?.emissiveCameraState(),renderFlameHDR(frame){
   hdr??=createSceneFlameHDR({renderer:renderResources.renderer,camera,device:readGpu().device,bloom:ordinary.bloom,decorate:node=>ordinary.decorateOutput(node)});
   return hdr.render({...frame,physical:volume.emissiveCameraState()});
  }},
  applyFrameInputs(_input,ctx){check(ctx);},
  assertRecordSupported(record){if(record.type===LOCAL_LIQUID_EMITTER_TYPE){assertWaterRecord(record);return;}if(record.type!==FLAME_EMITTER_TYPE)throw Error('Unsupported worker domain not mounted: '+record.type);checkedFireSourceRecord(record);},
  loaders:{flame(record,options){options.context?.assertCurrent();const source=checkedFireSourceRecord(record),object=createFlameEmitterHandle(THREE);applySceneObjectTransformState(object,source.transform);
   pendingHandles.add(object);scene.add(object);ordinary.registerSceneObject(object,source,{activate:options.activate});pendingHandles.delete(object);return object;},
   water(record,options){options.context?.assertCurrent();assertWaterRecord(record);if(!waterFeature.setup)throw Error('Water setup must be applied before source construction');const {object}=createLocalLiquidEmitterObject(THREE,record,{sampling:waterFeature.setup.waterSampling});pendingHandles.add(object);scene.add(object);ordinary.registerSceneObject(object,record,{activate:options.activate});pendingHandles.delete(object);return object;}},
  restoreOperations:{flamePose(id,pose){const record=ordinary.workingScene.objects.find(row=>row.id===id);if(!record)throw Error('Flame source absent: '+id);applySceneObjectTransformState(record.object,pose);}},
  replacement:{selection:{fields:()=>[...(present()?['flame-field']:[]),...(waterFeature.setup?['water-field']:[])]}},
  document:{
   assertSupported(data,next){
    if(data.postprocessing?.dof?.enabled)throw Error('DOF presentation is not mounted in this worker constructor');
    if(data.backdrop===true)throw Error('Backdrop presentation is not mounted in this worker constructor');
    if(next.localLiquid){const sources=(next.objects??[]).filter(row=>row.type===LOCAL_LIQUID_EMITTER_TYPE);if(!sources.length)throw Error('Water dynamics without initial source previews are not mounted yet');for(const source of sources)assertWaterRecord(source);}
    if(next.sceneCamera?.activeId)throw Error('Output-camera presentation is not mounted yet');
    if(next.fireDomain?.simulation.collision||next.composition?.route?.volume_collision==='kiln')throw Error('Fire geometry collision preparation is not mounted yet');
   },prepareDocument,
   async beforeReplace(data,next,meta){check(meta.context);const cached=preparedDocuments.get(next);if(!cached)throw Error('Scene fire settings were not prepared');if(volume)await volume.setActive(false);await releaseRadiance();check(meta.context);if(volume)volume.setSceneCompositionPresentation(Boolean(next.composition));
    accept(data,next,cached.values,meta.context,cached.rendering);waterFeature.clear();waterFeature.setup=structuredClone(next.localLiquid??null);waterPreview=false;documentData=null;configured=null;sourceSignature=null;return {};},
   async afterReplace(data,next,meta){check(meta.context);documentData=data;plan=next;configure();if(volume){await volume.setActive(present()&&ordinary.visible('flame-field'));check(meta.context);await mount(meta.context);}if(waterFeature.setup){await waterFeature.restore();check(meta.context);}},
  },
  commands:{'water.read'(_input,ctx){check(ctx);return readWater();},'fire.read'(_input,ctx){check(ctx);return {active:Boolean(volume?.isActive()),present:present(),source:prepared?.source?{presetId:prepared.source.presetId}:null,lighting:radiance?.debugState?.()??null};}},
  async retire(ctx){ctx.assertCurrent();retiring=true;if(volume)await volume.setActive(false);await releaseRadiance();for(const owner of receiverOwners){await owner.dispose();receiverOwners.delete(owner);}for(const object of pendingHandles){object.removeFromParent();object.traverse(node=>{node.geometry?.dispose();for(const material of [].concat(node.material??[]))material.dispose();});pendingHandles.delete(object);}waterFeature.clear();volume=null;},
 };
 return shell;
}
