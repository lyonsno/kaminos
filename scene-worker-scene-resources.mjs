import {createSceneAppearanceResources,SCENE_HDR_PRESETS} from './scene-appearance-resources.mjs';
import {createSceneAOState} from './scene-ao-state.mjs';
import {createSceneEnvironmentState} from './scene-environment-state.mjs';
import {resolveSceneGIControlState} from './scene-gi-settings.mjs';
import {resolveReflectionSettings} from './scene-reflection-settings.mjs';
import {createSceneDisplayOwner} from './scene-display-owner.mjs';
import {createSceneBloom,checkedSceneBloom} from './scene-bloom.mjs';
import {bloom} from './scene-bloom-node.mjs';
import {createSelectionFeedback} from './scene-selection-feedback.mjs';
import {createSceneEmissiveCamera,applySceneEmissiveCamera} from './scene-emissive-camera.mjs';
import {createSceneFrameRuntime} from './scene-frame-runtime.mjs';
import {createSceneDrawRuntime} from './scene-draw-runtime.mjs';
import {createSimFrameCoordinator} from './mls-juice-contract.mjs';
import {createWorkingScene} from './working-scene.mjs';
import {createAuthoredSceneRuntime,restoreAuthoredSceneRecord} from './scene-authored-runtime.mjs';
import {createSceneDocumentApplication} from './scene-document-application.mjs';
import {createSceneGltfLoaderClass} from './scene-gltf-loader.mjs';
import {createSceneGlbLoader} from './scene-glb-loader.mjs';
import {sceneObjectTransformState,applySceneObjectTransformState,getMaterialStateForObject,applyMaterialStateToObject} from './scene-object-state.mjs';
import {createSceneMaterials} from './scene-material-recipes.mjs';
import {sceneMaterialPrograms} from './scene-material-programs.mjs';
import {createSceneBeautyLodController} from './scene-lod-budget.mjs';
import {createGiProxyRegistry} from './scene-gi-proxies.mjs';
import {disposeOwnedSceneTree} from './workbench-scene-host.mjs';
import {readAssetBytes} from './asset-input-preparation.mjs';
import {prepareArrivedMeshMaterials,planArrivalStudioLights,inspectArrivalMaterialProfile,DEFAULT_STUDIO_LOOK_ID,resolveStudioLook,resolveAssetArrivalMode,createLoadingTelemetryTracker} from './asset-arrival.mjs';
import {resolveSceneWorkerStartupInput} from './scene-worker-startup-input.mjs';
import {checkedCameraView} from './scene-camera-views.mjs';
import {checkedViewportDisplay} from './viewport-display-settings.mjs';
import {sceneItemVisible,withViewportVisibility} from './scene-visibility.mjs';
import {createLightingPreparation,compileSceneLighting} from './scene-lighting-compile.mjs';
import {borrowViewportVisibility,withViewportVisibilityAsync} from './scene-visibility.mjs';
import {createViewportShading} from './viewport-shading.mjs';

const paramsFor=payload=>new URL(payload.location?.href??payload.location??'http://localhost/').searchParams;
const required=(value,name)=>{if(typeof value!=='function')throw Error(`Ordinary worker scene requires ${name}`);return value;};
function mergeCommands(...maps){const result=Object.create(null);for(const map of maps)for(const [key,value]of Object.entries(map??{})){
 if(Object.hasOwn(result,key))throw Error(`Ordinary scene command collision: ${key}`);result[key]=required(value,key);
}return result;}

// One ordinary scene, using the renderer/device retained by the common runtime.
// Allocation is deferred until initialize so failed construction still has its
// cleanup owner. Fire, water and their document meaning come from createDomains.
export function createSceneWorkerSceneResources(context){
 const {THREE,scene,camera,renderResources,sharedGpu,payload,viewport,createDomains,services={}}=context;
 required(createDomains,'createDomains');required(viewport,'viewport');
 const workingScene=createWorkingScene(),ao=createSceneAOState(),environment=createSceneEnvironmentState({presets:SCENE_HDR_PRESETS});
 let appearance=null,authored=null,document=null,domains=null,frames=null,display=null,sceneBloom=null,selection=null,materials=null,beautyLods=null,giProxies=null;
 let started=false,retiring=false,attached=false,frameCount=0,draw=null,output=null,shading=null,domainRetired=false,rootsRetired=false;
 let lightingPreparation=null,volume=null,lightingHeld=false,documentHolds=0;
 let presentationHeld=false,presentationReleased=false,presentationRestored=false;
 let gi=resolveSceneGIControlState(),reflections=resolveReflectionSettings(),bloomSettings=checkedSceneBloom({enabled:paramsFor(payload).get('scene_bloom')==='1',composeFlame:paramsFor(payload).get('scene_bloom')==='1'}),ground={},editorDisplay=checkedViewportDisplay(),startup=null;
 let arrival={sceneKind:'static-asset',lookId:DEFAULT_STUDIO_LOOK_ID,studioLightsEnabled:true,materialTuningEnabled:false,bounds:null,materialProfile:inspectArrivalMaterialProfile([]),plan:null};
 const graphs=new Map(),wireMaterials=[],pendingRoots=new Set(),stops=[],lightingProxyRoots=new Map();
 const renderer=()=>renderResources.renderer,lighting=()=>renderResources.lighting;
 const readSharedGpu=typeof context.readSharedGpu==='function'?()=>context.readSharedGpu():()=>sharedGpu;
 const queue=()=>readSharedGpu()?.device?.queue;
 const params=new URL(payload.location?.href??payload.location??'http://localhost/').searchParams;
 const current=ctx=>{required(ctx?.assertCurrent,'current command context');ctx.assertCurrent();if(retiring)throw Error('Ordinary scene is retiring');};
 const report=(ctx,ui)=>ctx?.report?.({ui});
 const visible=id=>sceneItemVisible(id,editorDisplay.hiddenIds,workingScene);
 const roots=()=>[scene,...workingScene.retainedObjects().map(e=>e.object),...workingScene.suspendedObjects().map(e=>e.object)];
 function disposeRoot(root){
  materials?.releaseObject(root);beautyLods?.release(root);giProxies?.release(root);
  disposeOwnedSceneTree(root,roots(),[scene.environment,scene.background]);pendingRoots.delete(root);
 }
 const telemetry=createLoadingTelemetryTracker({onChange:value=>{activeContext?.report?.({ui:{loading:value}});}});
 let activeContext=null;
 function frameState(now){
  const value=domains.readFrameState(now);
  if(!value||typeof value.then==='function'||typeof value.radianceReady!=='boolean'||typeof value.transportRequired!=='boolean'
   ||['flame','water','ash'].some(name=>typeof value.simInputs?.[name]?.active!=='boolean'))throw Error('Ordinary scene requires live simulator state and render admission');
  return value;
 }
 function replanAppearance(){
  arrival.plan=planArrivalStudioLights({...arrival,groundY:ground.height??-.85});
  lighting()?.sceneGI.setOpticalFinish(resolveStudioLook(arrival.lookId).opticalFinish);
  if(appearance?.studio)appearance.applyStudio();appearance?.applyEnvironment();
 }
 function syncLighting(){
  const graph=lighting();if(!graph)return;
  const value=ao.read();for(const [field,key]of [['radius','radius'],['scale','scale'],['thickness','thickness'],['falloff','distanceFallOff']])graph.aoPass[key].value=value[field];
  graph.aoIntensity.value=value.enabled?value.intensity:0;
  graph.sceneGI.setSettings(gi);graph.sceneGI.setEstimatorSettings(gi.estimator);graph.sceneGI.reflections.setSettings(reflections);graph.syncReflections();
  display?.rebuild();
 }
 function settings(){return {ao:ao.document(),environment:environment.document(),gi:structuredClone(gi),reflections:structuredClone(reflections),ground:{...ground},editorDisplay:structuredClone(editorDisplay),arrival:structuredClone(arrival)};}
 function checkSettings(data){
  // Pure admission precedes asynchronous preparation and document mutation.
  const nextGI=resolveSceneGIControlState(data.postprocessing?.sceneGI??{}),nextReflections=resolveReflectionSettings(data.postprocessing?.reflections??{});
  const nextBloom=checkedSceneBloom(data.postprocessing?.bloom??{}),nextDisplay=checkedViewportDisplay(data.editorDisplay??{});
  const nextAO=createSceneAOState();if(data.postprocessing?.ao)nextAO.restoreDocument(data.postprocessing.ao);
  const nextEnvironment=createSceneEnvironmentState({presets:SCENE_HDR_PRESETS});if(data.environment)nextEnvironment.restoreDocument(data.environment);
  const savedGround=data.environment?.ground??{},nextGround={height:savedGround.height??-.85,visible:savedGround.visible??true,color:savedGround.color??'#808080',roughness:savedGround.roughness??.65,metalness:savedGround.metalness??0};
  if(!Number.isFinite(nextGround.height)||typeof nextGround.visible!=='boolean'||!Number.isFinite(nextGround.roughness)||!Number.isFinite(nextGround.metalness))throw Error('Invalid scene ground settings');
  const nextCamera=data.camera?checkedCameraView({...data.camera,up:data.camera.up??[0,1,0],fov:data.camera.fov??camera.fov,near:data.camera.near??camera.near,far:data.camera.far??camera.far}):null;
  return {nextGI,nextReflections,nextBloom,nextDisplay,nextAO,nextGround,nextCamera};
 }
 function applySettings(data,ctx){
  current(ctx);
  const {nextGI,nextReflections,nextBloom,nextDisplay,nextAO,nextGround,nextCamera}=checkSettings(data);
  gi=nextGI;reflections=nextReflections;bloomSettings=nextBloom;ground=nextGround;editorDisplay=nextDisplay;ao.patch(nextAO.read());
  if(data.environment)environment.restoreDocument(data.environment);
  if(nextCamera){camera.position.fromArray(nextCamera.position);camera.up.fromArray(nextCamera.up??[0,1,0]);camera.lookAt(...nextCamera.target);for(const key of ['fov','near','far','zoom'])if(nextCamera[key]!==undefined)camera[key]=nextCamera[key];camera.updateProjectionMatrix();camera.updateMatrixWorld(true);}
  if(appearance?.ground)appearance.applyGround(ground);
  syncLighting();sceneBloom?.set(nextBloom);replanAppearance();
  if(appearance&&data.environment)appearance.environment.select(environment.read().name??'studio');
 }
 function assertOrdinarySupport(data,plan){
  checkSettings(data);
  // These need their actual presentation owners; the root's support callback
  // must implement/accept them before a document can clear the current scene.
  const supported=domains.document.assertSupported(data,plan);
  if(supported&&typeof supported.then==='function'){Promise.resolve(supported).catch(()=>{});throw Error('Scene document support must be synchronous');}
  if(supported===false)throw Error('Scene document support refused');return supported;
 }
 function registerLightingProxy(root){
  if(lightingProxyRoots.has(root))throw Error('Lighting proxy is already registered');
  const entry={release:lighting()?.sceneGI.surfaceLighting.registerProxyRoot(root)??null};lightingProxyRoots.set(root,entry);
  return()=>{entry.release?.();lightingProxyRoots.delete(root);entry.release=null;};
 }
 function buildPresentation(ctx){
    renderResources.initializeLighting(ctx);current(ctx);
    for(const [root,entry]of lightingProxyRoots)entry.release=lighting().sceneGI.surfaceLighting.registerProxyRoot(root);
    syncLighting();lighting().sceneGI.setOpticalFinish(resolveStudioLook(arrival.lookId).opticalFinish);
    const preparePasses=()=>gi.mode==='combined'?[lighting().sceneGI.source,lighting().sceneGI.beauty]:[lighting().prePass,lighting().scenePass];
    const frameOptions=()=>({viewportHeight:viewport().height*viewport().pixelRatio,pinnedObjects:new Set(workingScene.selection.ids)});
    const preparation=createLightingPreparation({
     hold(value){lightingHeld=value;return syncVolumeHold();},
     compile:()=>withViewportVisibilityAsync(workingScene.objects,visible,async()=>{await beautyLods.whenIdle();return compileSceneLighting(renderer(),preparePasses(),{visibility:()=>beautyLods.borrowFrame(camera,frameOptions())});}),
     liveCompile:({isCurrent})=>compileSceneLighting(renderer(),preparePasses(),{live:true,isCurrent,visibility:()=>{const restoreVisibility=borrowViewportVisibility(workingScene.objects,visible),restoreBeauty=beautyLods.borrowFrame(camera,frameOptions());return()=>{restoreBeauty();restoreVisibility();};}}),
     onStatus:value=>report(activeContext,{lightingPreparation:value})});
    const owner=Object.freeze({...preparation,request(change){if(retiring||lightingPreparation!==owner||(presentationHeld&&!presentationRestored))throw Error('Ordinary scene presentation is held');return preparation.request(change);}});
    lightingPreparation=owner;
    selection=createSelectionFeedback(camera);selection.setStyle({width:editorDisplay.outlineWidth,opacity:editorDisplay.outlineOpacity});
    shading=createViewportShading({createWireMaterial:()=>{const material=new THREE.MeshBasicNodeMaterial({color:0x15181c,wireframe:true,transparent:true,opacity:.42,depthWrite:false,side:THREE.DoubleSide});wireMaterials.push(material);return material;}});
    sceneBloom=createSceneBloom({bloom,convertToTexture:THREE.TSL.convertToTexture,vec4:THREE.TSL.vec4,rebuild:()=>display?.rebuild(),redraw(){},initial:bloomSettings});
    display=createSceneDisplayOwner({THREE,graphs,readSettings:()=>({...frameState(),...gi,sharedDeviceAvailable:!!readSharedGpu()?.device}),
     readResources:()=>({...lighting(),sceneBloom,selectionFeedback:selection}),createFireLightFieldReceiverPass:(...args)=>required(domains.createFireLightFieldReceiverPass??domains.createFireLightReceiver,'fire light-field receiver')(...args),createSceneEmissiveCamera,onOutput:value=>{output=value;}});
    display.rebuild();
    current(ctx);
 }
 async function releasePresentation(ctx){
  // Each successful release drops its handle; a throwing release remains owned
  // for Retry. Authored roots, material recipes and LOD/proxy registries survive.
  ctx.assertCurrent();
  if(lightingPreparation){try{await lightingPreparation.whenIdle();}catch(error){if(!lightingPreparation.state().error)throw error;}ctx.assertCurrent();}
  appearance?.invalidateEnvironment();ctx.assertCurrent();
  for(const entry of lightingProxyRoots.values()){entry.release?.();entry.release=null;}ctx.assertCurrent();
  for(const [key,graph]of graphs){await graph.sceneEmissiveCamera?.dispose?.();graphs.delete(key);ctx.assertCurrent();}
  if(selection){await selection.dispose();selection=null;ctx.assertCurrent();}
  while(wireMaterials.length){await wireMaterials.at(-1).dispose();wireMaterials.pop();ctx.assertCurrent();}shading=null;
  if(sceneBloom){bloomSettings=sceneBloom.read().settings;await sceneBloom.dispose();sceneBloom=null;ctx.assertCurrent();}
  await renderResources.retireLighting(ctx);ctx.assertCurrent();
  lightingPreparation=null;lightingHeld=false;display=null;output=null;presentationReleased=true;presentationRestored=false;
 }
 const ordinary=Object.freeze({scene,camera,renderResources,workingScene,viewport,
  get sharedGpu(){return readSharedGpu();},
  get appearance(){return appearance;},get lighting(){return lighting();},get display(){return display;},get frames(){return frames;},get authored(){return authored;},get document(){return document;},get materials(){return materials;},get beautyLods(){return beautyLods;},get giProxies(){return giProxies;},
  get bloom(){return sceneBloom;},decorateOutput:node=>selection.output(node),
  get lightingPreparation(){return lightingPreparation;},get surfaceLighting(){return lighting()?.sceneGI.surfaceLighting;},
  get output(){return output;},get coordinator(){return coordinator;},readSettings:settings,applySettings,visible,
  get startup(){return startup;},
  readBounds(){const box=new THREE.Box3();for(const row of workingScene.objects)if(row.object&&row.type!=='light'&&row.type!=='camera')box.expandByObject(row.object);return box.isEmpty()?null:{min:box.min.toArray(),max:box.max.toArray()};},
  rebuildDisplay:()=>display.rebuild(),registerSceneObject:(...args)=>authored.registerSceneObject(...args),
  setArrival(patch){arrival={...arrival,...structuredClone(patch)};replanAppearance();},
 });
 const coordinator=createSimFrameCoordinator();
 const shell={ordinary,
  readUi(){const contributed=domains?.readUi?.()??{};return {...contributed,
   environmentLoading:appearance?.environment.read()??null,lightingPreparation:lightingPreparation?.state()??null,loading:telemetry.read(),
   surfaces:{...contributed.surfaces,scene:{...contributed.surfaces?.scene,active:attached&&!presentationHeld}},
  };},
  get lightingOptions(){return appearance?.lightingOptions;},get frames(){return frames;},
  get initialVolumeActive(){return domains?.initialVolumeActive;},get volumeOptions(){return domains?.volumeOptions;},get commands(){return commandMap;},get foregroundCommands(){return domains?.foregroundCommands;},
  async initialize(ctx){
   current(ctx);if(started)throw Error('Ordinary scene initialization already attempted');started=true;activeContext=ctx;
   try{
    startup=resolveSceneWorkerStartupInput(payload);
    if(startup.preferences?.studioLook)arrival.lookId=startup.preferences.studioLook;
    domains=createDomains({...context,ordinary});
    if(domains&&typeof domains.then==='function'){Promise.resolve(domains).catch(()=>{});throw Error('Scene domain constructor must return its retained shell synchronously');}
    for(const name of ['initialize','prepareVolume','attachVolume','retire','readFrameState','readDrawSettings','readDrawResources'])required(domains?.[name],`domains.${name}`);
    for(const name of ['assertSupported','prepareDocument','beforeReplace','afterReplace'])required(domains.document?.[name],`domains.document.${name}`);
    for(const name of ['beforeDraw','syncProxies'])required(domains.drawOperations?.[name],`domains.drawOperations.${name}`);
    required(domains.assertRecordSupported,'domains.assertRecordSupported');
    appearance=createSceneAppearanceResources({THREE,readScene:()=>scene,readRenderer:renderer,readPMREM:()=>renderResources.pmremGenerator,environmentState:environment,readEntries:()=>workingScene.objects,
     readArrival:()=>arrival,readGround:()=>({...ground,distributed:(domains.readRouteParams?.()??params).get('volume_light_field_distributed')==='1'}),
     readStudio:()=>({records:arrival.plan?.lights,enabled:arrival.studioLightsEnabled&&!frameState().fireLightFieldRoute}),
     readLighting:()=>({aoSettings:ao.read(),aoIntensityValue:ao.read().enabled?ao.read().intensity:0,giOptions:{reflections,filterImplementation:params.get('lighting_filter')==='separate'?'separate':'shared',surfaceReuse:params.get('lighting_surface_reuse')!=='0',sourceComparison:params.get('experiment')==='gi-source-study'}}),
     ...(services.loadHDR?{loadHDR:services.loadHDR}:{}),changed:value=>report(activeContext,{environmentLoading:value})});
    const GLTFLoader=createSceneGltfLoaderClass({THREE,readRenderer:renderer});
    const parseGlb=async bytes=>(await new GLTFLoader().parseAsync(bytes,'')).scene;
    giProxies=createGiProxyRegistry({THREE,parseGlb,...services.proxyOptions});
    beautyLods=createSceneBeautyLodController({THREE,scene,giProxies,parseGlb,
     surfaceLighting:{registerProxyRoot:registerLightingProxy},
     onRungLoaded:()=>materials.sync(),onRepresentationChanged:()=>materials.sync(),onRepresentationReleased:(_root,representation)=>materials.releaseObject(representation),canDisplayRung:(...args)=>materials.canDisplay(...args)});
    materials=createSceneMaterials({entries:()=>[...workingScene.objects,...workingScene.suspendedObjects()],retainedEntries:()=>workingScene.retainedObjects(),definitions:sceneMaterialPrograms,representations:entry=>beautyLods.materialRoots(entry.object)});
    authored=createAuthoredSceneRuntime({scene,workingScene,readers:{transform:sceneObjectTransformState,materials:getMaterialStateForObject,...domains.recordReaders},
     roots:{...domains.roots,prepare(entry){if(entry.giProxy){const task=entry.giProxy.enabled?giProxies.select(entry.object,entry.giProxy.selection):giProxies.disable(entry.object,{retainLevels:true});Promise.resolve(task).catch(()=>{});}domains.roots?.prepare?.(entry);},restore(entry,record){restoreAuthoredSceneRecord(entry,record,{transform:applySceneObjectTransformState,materials:applyMaterialStateToObject,...domains.restoreOperations});domains.roots?.restore?.(entry,record);},dispose(root){domains.roots?.dispose?.(root);disposeRoot(root);}},
     membership:domains.membership,replacement:{...domains.replacement,context:{...domains.replacement?.context,retire:async()=>{await queue()?.onSubmittedWorkDone();await domains.replacement?.context?.retire?.();}}},
     assertRecordSupported(record,loaders){if(record.type==='glb')return;return domains.assertRecordSupported(record,loaders);},
     createLoaders({registerSceneObject}){
      const show=createSceneGlbLoader({GLTFLoader,workingScene,readScene:()=>scene,readAssetBytes:services.readAssetBytes??readAssetBytes,
       shouldClearSceneForImport:options=>options.clear===true,clearScene:()=>authored.lifecycle.clear(),resolveAssetArrivalMode,loadingTelemetry:telemetry,
       disposeObjectTree:disposeRoot,readEnvironmentIntensity:()=>environment.read().intensity,readMaxAnisotropy:()=>renderer().capabilities?.getMaxAnisotropy?.()||16,
       prepareArrivedMeshMaterials,applyAssetArrival:(root,mode)=>{pendingRoots.add(root);if(mode)throw Error('Fresh asset placement needs its ordinary geometry arrival service');return null;},
       registerSceneObject:(root,...args)=>{pendingRoots.delete(root);return registerSceneObject(root,...args);},
       ...services.glbOptions});
      return {...domains.loaders,glb:(record,options)=>show(record.source,{...options,clear:false,normalize:false,metadata:record})};
     }});
    document=createSceneDocumentApplication({runtime:authored,assertSupported:assertOrdinarySupport,
     async prepareDocument(data,plan,meta){await materials.prepare(plan.materialLibrary??{recipes:[],bindings:[]});await domains.document.prepareDocument(data,plan,meta);},
     async beforeReplace(data,plan,meta){applySettings(data,meta.context);return domains.document.beforeReplace(data,plan,meta);},
     async afterReplace(data,plan,meta){materials.write(plan.materialLibrary??{recipes:[],bindings:[]});await giProxies.whenIdle();await domains.document.afterReplace(data,plan,meta);appearance.applyEnvironment();},
     documentServices:{readAddress:()=>{const url=new URL(payload.location?.href??payload.location);return {href:url.href,origin:url.origin,search:url.search,hash:url.hash};},...domains.documentServices}});
    await domains.initialize(ctx);current(ctx);
    if(startup.startupDefaults.defaults){assertOrdinarySupport(startup.startupDefaults.defaults,{});applySettings(startup.startupDefaults.defaults,ctx);await domains.applyPreferences?.(startup,ctx);}
    replanAppearance();await appearance.initialize(ctx);current(ctx);
    buildPresentation(ctx);
    frames=createSceneFrameRuntime({readInputs:()=>{const state=frameState();return {...state,lightingHeld:retiring||presentationHeld||!attached||lightingHeld||documentHolds>0||document.session.state().phase==='applying'||state.lightingHeld===true};},draw:()=>draw(),frameCount:()=>frameCount,
     prepare:()=>{if(presentationHeld||!attached)return;camera.updateMatrixWorld();const result=domains.prepareFrame?.();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw Error('Scene frame preparation must be synchronous');}output.fireLightFieldPass?.update();},readDepth:()=>renderer().backend.get(output.activeSceneDepth.value).texture,readSharedDevice:()=>readSharedGpu()?.device,readCamera:()=>camera,
     coordinator,readSimInputs:now=>frameState(now).simInputs});
    draw=createSceneDrawRuntime({THREE,readSettings:()=>({customToneMapping:false,giMode:gi.mode,giView:gi.view,matchFlameCamera:false,assetPreparationActive:false,capturing:false,
      beautyFrameOptions:{viewportHeight:viewport().height*viewport().pixelRatio,pinnedObjects:new Set(workingScene.selection.ids)},...domains.readDrawSettings(),held:retiring||presentationHeld||!attached}),
     readResources:()=>({...domains.readDrawResources(),...output,renderer:renderer(),renderPipeline:lighting().renderPipeline,sceneBeautyLods:beautyLods,transportFrame:frames.composition.transportFrame}),
     operations:{...domains.drawOperations,beforeDraw:t=>{selection.suspend(!editorDisplay.overlays||!editorDisplay.outlines);selection.update(workingScene.objects.filter(e=>workingScene.selection.ids.includes(e.id)&&visible(e.id)),[workingScene.selection.activeId]);domains.drawOperations.beforeDraw(t);},
      readPhysicalCamera:()=>domains.drawOperations.readPhysicalCamera?.(),applyCamera:applySceneEmissiveCamera,planFrame:now=>frames.planFrame(now),
      withBeautyFrame:(options,run)=>withViewportVisibility(workingScene.objects,visible,()=>beautyLods.withFrame(camera,options,()=>shading.renderWith(workingScene.objects.map(e=>e.object),editorDisplay.shading,run)))},
     onCameraStatus:value=>report(frameContext,{cameraStatus:value}),onWaterFrame:value=>domains.onWaterFrame?.(value),onWaterError:(error,fallback)=>required(domains.onWaterError,'water failure handling')(error,fallback),
     afterDraw:(receipt,now)=>{frameCount++;domains.afterDraw?.(receipt,now);}});
    commandMap=mergeCommands({...document.commands,async 'scene.applyDocument'(input,context){
     current(context);documentHolds++;const previousContext=activeContext;activeContext=context;
     try{await syncVolumeHold();current(context);const result=await document.commands['scene.applyDocument'](input,context);current(context);
      return {...result,ui:{...projection(),...(input.document?.camera?{camera:checkedCameraView({...input.document.camera,position:camera.position.toArray(),up:camera.up.toArray(),fov:camera.fov,near:camera.near,far:camera.far})}:{})}};}
     finally{activeContext=previousContext;documentHolds--;await syncVolumeHold();}
    }},domains.commands);
    current(ctx);return shell;
   }finally{activeContext=null;}
  },
  stopRendererResources(){
   // Synchronous loss fence only. The root retires volume/model/device owners.
   presentationHeld=true;presentationRestored=false;attached=false;volume=null;
   appearance?.environment.invalidateResources();frames?.setForegroundServiceActive(false);
  },
  async releaseRendererPresentation(ctx){
   current(ctx);if(!presentationHeld)shell.stopRendererResources();
   if(!presentationReleased)await releasePresentation(ctx);
   return {released:true};
  },
  async restoreRendererPresentation(ctx){
   current(ctx);if(!presentationHeld||!presentationReleased)throw Error('Release retained presentation before restoring it');
   if(!readSharedGpu()?.device||!renderer())throw Error('Ordinary presentation requires the current supplied renderer/device');
   // Mark before allocation: failed/superseded builds must pass through release.
   presentationReleased=false;activeContext=ctx;
   try{buildPresentation(ctx);appearance.applyEnvironment();appearance.environment.select(environment.read().name??'studio');current(ctx);presentationRestored=true;return {restored:true};}
   finally{activeContext=null;}
  },
  async releaseVolume(input){
   current(input.context);if(!presentationHeld)throw Error('Stop presentation before releasing its volume');
   const result=await required(domains.releaseVolume,'domains.releaseVolume')(input);current(input.context);return result;
  },
  async reattachVolume(input){
   current(input.context);if(!presentationHeld||!presentationRestored)throw Error('Restore presentation before reattaching its volume');
   await required(domains.reattachVolume,'domains.reattachVolume')(input);current(input.context);
   attached=true;presentationHeld=false;appearance.environment.releaseFull();return {attached:true};
  },
  async prepareVolume(input){current(input.context);volume=input.volume;await domains.prepareVolume(input);current(input.context);},
  async attachVolume(input){
   current(input.context);await domains.attachVolume(input);current(input.context);activeContext=input.context;
   try{const applied=payload.admission?.data?await commandMap['scene.applyDocument']({document:payload.admission.data,sceneFile:payload.admission.sceneFile??null,emptySettings:true},input.context):null;
    current(input.context);attached=true;appearance.environment.releaseFull();report(input.context,{...(applied?.ui??projection()),initialization:{sceneApplied:true,preferencesApplied:true}});
   }finally{activeContext=null;}
  },
  applyFrameInputs(input,ctx){current(ctx);if(!attached||presentationHeld)throw Error('Ordinary scene is not attached');frameContext=ctx;domains.applyFrameInputs?.(input,ctx);},
  async retire(ctx){
   required(ctx?.assertCurrent,'retirement context');ctx.assertCurrent();retiring=true;attached=false;
   if(domains&&!domainRetired){await domains.retire(ctx);domainRetired=true;}
   if(lightingPreparation){try{await lightingPreparation.whenIdle();}catch(error){if(!lightingPreparation.state().error)throw error;}await queue()?.onSubmittedWorkDone();}
   if(!rootsRetired){
    materials?.clear();beautyLods?.dispose();giProxies?.clear();
    if(authored)await authored.lifecycle.clear();for(const root of pendingRoots){root.removeFromParent();disposeRoot(root);}rootsRetired=true;
   }
   while(stops.length){await stops.at(-1)();stops.pop();}
   await releasePresentation(ctx);
   if(appearance){await appearance.retire(ctx);appearance=null;}
   authored?.membership.dispose();frames=null;draw=null;display=null;output=null;commandMap=null;
   return {retired:true};
  },
 };
 let frameContext=null,commandMap=null;
 function syncVolumeHold(){if(volume&&typeof volume.setSceneLightingRebuildPending==='function')return volume.setSceneLightingRebuildPending(lightingHeld||documentHolds>0);if(lightingHeld||documentHolds)return queue()?.onSubmittedWorkDone();}
 function projection(){return {bounds:ordinary.readBounds(),selection:structuredClone(workingScene.selection),objects:authored?.snapshot().objects??[]};}
 return shell;
}
