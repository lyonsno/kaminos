import {createKilnBurnWindow} from './kiln-burn-window.mjs';
import * as THREE from './lib/three.webgpu.js';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createKaminosVolumePrototype} from './volume-core.js';
import {sceneItemVisible,withViewportVisibility} from './scene-visibility.mjs';
import {applySceneEnvironmentBackground} from './scene-environment-background.mjs';
import {createSceneRecordOperations} from './scene-record-operations.mjs';
import {createProceduralMesh} from './scene-geometry.mjs';
import {createPromptLettering} from './prompt-lettering.mjs';
import {createKilnPromptPreparation} from './kiln-prompt-preparation.mjs';
import {installKilnPromptEditor,KILN_PROMPT_WINDOW_HEIGHT} from './kiln-prompt-editor.mjs';
import {createPromptRelief} from './inference-kiln-relief.mjs';
import {promptReliefMetadata} from './inference-kiln-record.mjs';
import {cameraViewFromRecord} from './scene-camera.mjs';
import {createSceneColliderCollection} from './scene-collider.mjs';
import {flameSourceInputs} from './scene-fire-domain.mjs';
import {createSceneBurning} from './scene-burning.mjs';
import {createSceneBurnBody} from './scene-burn-body.mjs';
import {createLogGasSourceGpu} from './live-log-gas-source.mjs';
import {mountDistributedSceneRadiance} from './scene-hybrid-radiance.mjs';
import {readFireShadowSceneSettings} from './fire-shadow-scene-settings.mjs';
import {createSceneGI} from './scene-gi.mjs';
import {resolveSceneGIControlState} from './scene-gi-settings.mjs';
import {createSceneBloom} from './scene-bloom.mjs';
import {bloom} from './scene-bloom-node.mjs';
import {createSceneFlameHDR} from './scene-flame-hdr.mjs';
const {pass,mrt,output,emissive,uniform,convertToTexture,vec4}=THREE.TSL;
// Same records, material fields, gas solver, transported light and HDR camera as
// Workbench. This surface owns only its scene and borrowed-device resources.
export async function createInferenceKilnPreview({viewport,document=globalThis.document,recipe,prompt,request=null,input:promptInput=null,settings,sharedGpu,app,signal,rendering={},loadGlb,environment=null}){
 const saved=recipe.document,plan=recipe.plan,scene=new THREE.Scene(),entries=[],lightEntries=[],owned=[],frames=new Set();
 let disposed=false,active=false,fire=null,lighting=null,burning=null,gi=null,hdr=null,sceneBloom=null,pipeline=null,transport=null,lastError=null,frameCount=0,editor=null,promptPreparation=null,draftTimer=null,preparation=Promise.resolve(),preparedText=null,preparedHeight=224,preparedMask=null,prepareRevision=0,feedPixels=0,feedSteps=0,warmup=null,warmState='cold',finishing=false,finishResolve=null,promptBody=null,burnWindow=null,burnTimer=null,emitting=false;
 const aspect=plan.sceneCamera.aspect[0]/plan.sceneCamera.aspect[1],width=320,height=Math.round(width/aspect);
 viewport.style.aspectRatio=String(aspect);
 const record=plan.objects.find(r=>r.id===plan.sceneCamera.activeId),view=record?cameraViewFromRecord(record,aspect):saved.camera;
 if(!view||view.projection==='orthographic')throw Error('Choose a perspective kiln camera');
 const camera=new THREE.PerspectiveCamera(view.fov,aspect,view.near,view.far);camera.position.fromArray(view.position);camera.up.fromArray(view.up??[0,1,0]);camera.lookAt(...view.target);camera.updateMatrixWorld();
 const renderer=new THREE.WebGPURenderer({antialias:true,device:sharedGpu.device});
 const canvas=renderer.domElement;canvas.id='generation-flame-canvas';canvas.setAttribute('aria-label','Inference kiln');viewport.append(canvas);
 renderer.setPixelRatio(1);renderer.setSize(width,height);renderer.shadowMap.enabled=true;renderer.toneMapping=THREE.AgXToneMapping;
 const hidden=plan.editorDisplay?.hiddenIds??[],visible=id=>sceneItemVisible(id,hidden,plan),colliders=createSceneColliderCollection(THREE);
 const add=(object,record)=>{
  object.position.fromArray(record.transform.position);object.rotation.set(...record.transform.rotation);object.scale.fromArray(record.transform.scale);object.visible=true;object.name=record.label;
  const state=record.materials;if(state)object.traverse(child=>{for(const mat of [].concat(child.material??[])){for(const key of ['side','transparent','opacity'])if(state[key]!==undefined)mat[key]=state[key];if(!state.transparent){mat.depthWrite=true;mat.blending=THREE.NormalBlending;}mat.needsUpdate=true;}});
  object.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});scene.add(object);entries.push({...record,object});return object;
 };
 const records=createSceneRecordOperations({loaders:{
  constructed:(object,record)=>add(object,record),
  procedural:record=>{const resource=createProceduralMesh(THREE,mergeGeometries,record.geometry,record.surface);owned.push(resource);return add(resource.group,record);},
  glb:async record=>{const object=await loadGlb(record.source);signal?.throwIfAborted();return add(object,record);},
  light:record=>{const light=new THREE.SpotLight(record.light.color,record.light.intensity);light.castShadow=true;light.shadow.mapSize.set(1024,1024);light.shadow.bias=-.0001;light.shadow.normalBias=.02;light.angle=THREE.MathUtils.degToRad(record.light.angle);light.penumbra=record.light.penumbra;light.position.fromArray(record.transform.position);light.target.position.copy(light.position).addScaledVector(new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(...record.transform.rotation)),record.light.aimDistance*record.transform.scale[2]);light.visible=record.light.enabled;scene.add(light,light.target);lightEntries.push({id:record.id,object:light});owned.push({dispose:()=>light.dispose()});},
  camera:()=>{},flame:()=>{},
 }});
 function failure(error){lastError=error.message;viewport.dataset.error=lastError;}
 async function dispose(){
  if(disposed)return;disposed=true;active=false;finishResolve?.();finishResolve=null;clearTimeout(burnTimer);clearTimeout(draftTimer);promptPreparation?.dispose();await warmup?.catch(()=>{});await preparation.catch(()=>{});editor?.dispose();
  if(fire){await fire.setActive(false);await sharedGpu.device.queue.onSubmittedWorkDone();}
  lighting?.dispose();await lighting?.whenRebuilt?.().catch(()=>{});await burning?.dispose();fire?.setSceneTransportConsumer(null);fire?.dispose();
  hdr?.dispose();pipeline?.dispose();sceneBloom?.dispose();gi?.dispose();colliders.clear();frames.clear();
  for(const resource of owned)resource.dispose();
  const textures=new Set(),geometries=new Set(),materials=new Set();scene.traverse(node=>{if(node.geometry)geometries.add(node.geometry);for(const m of [].concat(node.material??[])){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});
  for(const value of [...textures,...geometries,...materials])value.dispose();renderer.dispose();canvas.remove();
 }
 try{
  await renderer.init();signal?.throwIfAborted();
  for(const record of plan.objects){await records.load(record);signal?.throwIfAborted();}
  const target=entries.find(row=>row.id===plan.promptObjectId);if(!target)throw Error('Saved kiln prompt was not reconstructed');
  const letteringPose=new THREE.Object3D();letteringPose.position.copy(target.object.position);letteringPose.quaternion.copy(target.object.quaternion);letteringPose.scale.copy(target.object.scale);letteringPose.updateMatrixWorld(true);
  const basePosition=target.object.position.clone(),feedAxis=new THREE.Vector3(0,target.object.scale.y,0).applyQuaternion(target.object.quaternion);
  // A stationary aperture around the authored lettering; the physical strip
  // moves through it, while its resident material coordinates remain attached.
  const aperture=new THREE.ClippingGroup();aperture.clippingPlanes=[new THREE.Plane(new THREE.Vector3(0,1,0),KILN_PROMPT_WINDOW_HEIGHT/1024),new THREE.Plane(new THREE.Vector3(0,-1,0),KILN_PROMPT_WINDOW_HEIGHT/1024)].map(p=>p.applyMatrix4(letteringPose.matrixWorld));scene.add(aperture);aperture.add(target.object);
  function positionFeed(){target.object.position.copy(basePosition).addScaledVector(feedAxis,(KILN_PROMPT_WINDOW_HEIGHT-preparedHeight+2*feedPixels)/1024);target.object.updateMatrixWorld(true);}
  function scheduleDraft(){
   clearTimeout(draftTimer);if(active||request||disposed||!promptInput?.value.trim())return;
   draftTimer=setTimeout(()=>{if(!active&&!request&&!disposed)prepare({prompt:promptInput.value}).catch(failure);},250);
  }
  if(promptInput){editor=installKilnPromptEditor({document,viewport,input:promptInput,camera,object:letteringPose,onChange:scheduleDraft,onPresentation:()=>{target.object.visible=letteringPose.visible;promptBody?.setMounted(visible(plan.promptObjectId));if(!pipeline||disposed||active)return;app.foreground.request({requestId:`kiln-edit-${crypto.randomUUID()}`,metadata:{renderer:'inference-kiln-edit'},run(){draw();return {status:'submitted'};}});},onError:failure});promptPreparation=createKilnPromptPreparation({rasterize:value=>editor.rasterize(value)});}
  async function prepare({prompt:next,request:admitted=null}){
   if(active)throw Error('Pause combustion before replacing its admitted text');
   clearTimeout(draftTimer);const revision=++prepareRevision;
   const geometryTask=next.trim()&&promptPreparation?promptPreparation.prepare(next):null;
   geometryTask?.catch(()=>{});
   const work=preparation.catch(()=>{}).then(async()=>{
    await warmup;
    const built=geometryTask?await geometryTask:null;if(disposed||revision!==prepareRevision)return;
    if(next.trim()&&preparedText!==next){
     const replacement=built?null:createPromptLettering(document,next,'composed');
     await sharedGpu.device.queue.onSubmittedWorkDone();if(disposed||revision!==prepareRevision){replacement?.dispose?.();return;}
     burning?.forget(target.object);target.object.geometry.dispose();target.object.geometry=built?built.geometry.clone():replacement.geometry;
     preparedMask=built?.surfaceMask??null;preparedHeight=built?.height??KILN_PROMPT_WINDOW_HEIGHT;preparedText=next;feedPixels=0;feedSteps=0;positionFeed();
     target.object.userData.kaminosPromptRelief={...promptReliefMetadata(next,'composed'),burnerSeconds:target.object.userData.kaminosPromptRelief.burnerSeconds??5};replacement?.material.dispose();
     await burning?.prepare();
    }
    if(admitted&&request?.id!==admitted.id&&burning?.read(plan.promptObjectId).status==='resident'){burning.reset(plan.promptObjectId);feedPixels=0;feedSteps=0;positionFeed();}
    if(admitted?.id!==request?.id||(admitted&&!burnWindow)){burnWindow=admitted?createKilnBurnWindow({seconds:target.object.userData.kaminosPromptRelief.burnerSeconds??5}):null;}
    prompt=next;request=admitted;editor?.sync();
   });preparation=work;return work;
  }

  const ground=saved.environment?.ground;
  if(ground?.visible){const mesh=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:ground.color,roughness:ground.roughness,metalness:0}));mesh.rotation.x=-Math.PI/2;mesh.position.y=ground.height;mesh.receiveShadow=true;scene.add(mesh);}
  if(saved.backdrop)throw Error('Use an ordinary backdrop mesh for the kiln scene');
  const env=saved.environment;
  if(env?.name){if(!environment?.url)throw Error('This kiln environment needs an HDR source');
   const image=await new RGBELoader().loadAsync(environment.url);signal?.throwIfAborted();const pmrem=new THREE.PMREMGenerator(renderer);const map=pmrem.fromEquirectangular(image);pmrem.dispose();image.dispose();owned.push(map);scene.environment=map.texture;scene.environmentIntensity=env.intensity??1;scene.environmentRotation.y=env.rotation??0;renderer.toneMappingExposure=env.exposure??1;
   applySceneEnvironmentBackground(scene,env,map.texture);scene.traverse(node=>{for(const material of [].concat(node.material??[]))material.envMapIntensity=env.intensity??1;});
  }
  if(!scene.background)applySceneEnvironmentBackground(scene,env,null);
  const post=saved.postprocessing??{},giSettings=resolveSceneGIControlState(post.sceneGI),ao=post.ao??{};
  // The native combined route owns opaque source sampling and receiving.
  if(giSettings.mode!=='combined')throw Error('Choose combined scene lighting for the kiln preview');
  if(post.dof?.enabled)throw Error('Disable depth of field for the kiln preview');
  gi=createSceneGI(scene,camera,uniform(ao.enabled===false?0:ao.intensity??1));gi.setSettings(giSettings);gi.setEstimatorSettings(giSettings.estimator);
  const beauty=gi.beauty;beauty.setMRT(mrt({output,...beauty.getMRT()?.outputNodes,emissive}));
  const input=gi.output(),emissionInput=beauty.getTextureNode('emissive'),depthInput=gi.depth;
  sceneBloom=createSceneBloom({bloom,convertToTexture,vec4,initial:post.bloom??{},rebuild(){},redraw(){}});
  pipeline=new THREE.RenderPipeline(renderer);pipeline.outputNode=sceneBloom.output(input,emissionInput);
  hdr=createSceneFlameHDR({renderer,camera,device:sharedGpu.device,bloom:sceneBloom});
  const runFrames=()=>{for(const fn of frames)fn(performance.now());};
  function draw(){
   if(disposed||active&&lighting&&!lighting.canRender())return false;
   runFrames();
   return withViewportVisibility([...entries,...lightEntries],visible,()=>{
   if(transport)hdr.render({frame:transport,input,emissionInput,depthInput,matched:settings.sceneMatchFlameCamera!==false,physical:fire.emissiveCameraState()});
   else pipeline.render();frameCount++;return true;});
  }
  fire=createKaminosVolumePrototype({THREE,viewport,camera,controls:{target:new THREE.Vector3(...view.target)},getControls:()=>settings,sharedGpuContext:sharedGpu,transparentCanvas:true,
   externalProductTransform:{translate:plan.flameDomainTranslation,scale:plan.flameDomainScale},getPresentationSize:()=>({width,height}),
   getSceneDepth:()=>{if(!draw())return null;return {device:sharedGpu.device,camera,texture:renderer.backend.get(depthInput.value).texture};},
   getSceneCollision:()=>colliders.update(entries),onStatus:state=>{if(state.error)failure(Error(state.error));},
  });fire.canvasElement().id='generation-kiln-volume-canvas';fire.canvasElement().style.display=post.bloom?.composeFlame||!visible('flame-field')?'none':'';fire.canvasElement().hidden=true;
  fire.setForegroundOpportunityRequester(request=>app.foreground.request({...request,requestId:`kiln-${request.requestId}`}));
  fire.setRaymarchSmokePresentationMode(settings.raymarchSmokePresentation);
  fire.setImmersedSources(flameSourceInputs(plan.flameSources,{controls:settings,translation:plan.flameDomainTranslation,scale:plan.flameDomainScale,visible}));
  function setEmission(value){
   if(emitting===value)return;emitting=value;
   const sources=flameSourceInputs(plan.flameSources,{controls:settings,translation:plan.flameDomainTranslation,scale:plan.flameDomainScale,visible});
   fire.setImmersedSources(sources.map(source=>({...source,controls:{...source.controls,immersedSourceEnabled:value&&source.controls.immersedSourceEnabled}})));
  }
  // Installing the authored sources above retains their shape. The valve is
  // closed until an admitted request starts its visible emission interval.
  emitting=true;setEmission(false);
  function advanceBurnWindow(){
   if(!active||!burnWindow)return;const state=burnWindow.read();setEmission(state.emitting);
   feedPixels=Math.max(feedPixels,Math.max(0,preparedHeight-KILN_PROMPT_WINDOW_HEIGHT)*state.progress);positionFeed();
   clearTimeout(burnTimer);
   if(state.emitting)burnTimer=setTimeout(advanceBurnWindow,Math.max(0,(state.seconds-state.elapsedSeconds)*1000));
   else if(finishing)queueMicrotask(()=>completeBurn().catch(failure));
  }
  async function completeBurn(){finishing=false;request=null;await setActive(false);finishResolve?.();finishResolve=null;}
  if(post.bloom?.composeFlame&&visible('flame-field'))fire.setSceneTransportConsumer(frame=>{transport=frame;try{return frame.renderHost();}finally{transport=null;}});
  burning=createSceneBurning({objects:()=>entries,runtime:()=>fire,createGas:createLogGasSourceGpu,
   createBody:async entry=>{
    const body=await createSceneBurnBody({entry,renderer,scene,surfaceMask:entry===target?preparedMask:null,kelvinPerHeat:()=>settings.physicalKelvinPerHeat,ground:()=>({center:[0,ground?.height??-.85,0],height:ground?.height??-.85,radius:5,visible:ground?.visible??true}),onFrame:fn=>{frames.add(fn);return()=>frames.delete(fn);}});
    if(entry===target){promptBody=body;const mount=body.setMounted;body.setMounted=value=>mount(value&&letteringPose.visible);const encode=body.encodeGasSource;body.encodeGasSource=(encoder,frame,gas)=>{advanceBurnWindow();feedSteps++;encode(encoder,frame,gas);};}
    return body;
   },onError:failure});
  // Show the assembled cold scene before asynchronous simulation preparation.
  const cold=app.foreground.request({requestId:`kiln-cold-${crypto.randomUUID()}`,metadata:{renderer:'inference-kiln-cold'},run(){draw();return {status:'submitted'};}});await cold.completion;
  warmState='preparing';
  warmup=(async()=>{
  await fire.borrowThermalGpuContext();signal?.throwIfAborted();
  if(!lighting){lighting=mountDistributedSceneRadiance({renderer,scene,prototype:fire,device:sharedGpu.device,surfaceLighting:gi.surfaceLighting,getSourceGuide:()=>({position:[...plan.flameSources[0].transform.position],radius:settings.inputRadius,height:settings.plumeHeight,depth:settings.emitterSourceDepth}),...readFireShadowSceneSettings(new URLSearchParams(plan.composition.route))});lighting.setGain(2**plan.composition.lightGainStops);
     const value=(id,fallback)=>rendering[id]??fallback;
     lighting.setSurfaceGain(2**Number(value('rendering-surface-gain',0)));lighting.setSurfaceScattering(!!value('rendering-surface-scattering',true));lighting.setSourceSoftness(Number(value('rendering-source-softness',0)));lighting.setSmokeMode(value('rendering-smoke-solver','distributed'));lighting.setDirections(Number(value('rendering-angular-samples',24)));lighting.setAngularPattern(value('rendering-angular-pattern','fixed'));await lighting.whenRebuilt();lighting.setSurfaceEnabled(active);}
   warmState='prepared';
  })().catch(error=>{warmState='failed';failure(error);throw error;});
  warmup.catch(()=>{});
  if(request||!promptInput)await prepare({prompt,request});else scheduleDraft();
  async function setActive(value){if(disposed)return;const wanted=!!value&&visible('flame-field');if(active===wanted)return;active=wanted;editor?.setBurning(active);fire.canvasElement().hidden=!active;
    if(active){clearTimeout(draftTimer);await warmup;await preparation;await burning.prepare();if(!active||disposed)return;lighting?.setSurfaceEnabled(true);gi.resetHistory('kiln-resume');if(burnWindow){if(!burnWindow.read().started)burnWindow.start();else burnWindow.resume();advanceBurnWindow();}await fire.setActive(true);if(entries.some(entry=>burning.read(entry.id).status==='failed'))throw Error(lastError||'Kiln material failed');

    }else{lighting?.setSurfaceEnabled(false);gi.resetHistory('kiln-editing');burnWindow?.pause();clearTimeout(burnTimer);setEmission(false);await fire.setActive(false);scheduleDraft();await new Promise(resolve=>document.defaultView.requestAnimationFrame(resolve));if(disposed||active)return;const still=app.foreground.request({requestId:`kiln-stopped-${crypto.randomUUID()}`,metadata:{renderer:'inference-kiln-stopped'},run(){draw();return {status:'submitted'};}});await still.completion;}
   }
  return {
   prepare,setActive,async cancel(){finishing=false;request=null;await setActive(false);finishResolve?.();finishResolve=null;},finish(){if(!request)return Promise.resolve();finishing=true;const completion=new Promise(resolve=>{finishResolve=resolve;});advanceBurnWindow();return completion;},syncEditor:()=>editor?.sync(),
   debugState:()=>({identity:'kaminos.inference-kiln-preview.v1',sceneFile:recipe.selection?.sceneFile??null,sceneLabel:saved.label,promptObjectId:plan.promptObjectId,prompt,requestSource:request?'admitted-generation-prompt':'editor-draft',active,error:lastError,frameCount,presentation:{promptVisible:target.object.visible,nativeEditing:editor?.read().editing},
    effective:{device:'app-shared-device',width,height,settings,objects:entries.map(row=>({id:row.id,visible:visible(row.id),transform:row.transform,burnable:row.burnable})),camera:view,bloom:sceneBloom.read()},
    preparation:{worker:promptPreparation?.read()??null,runtime:warmState,text:preparedText,height:preparedHeight,route:promptPreparation?'worker-solid-and-thermal-mask':'authored-solid'},burner:burnWindow?{...burnWindow.read(),emitting}:null,feed:{finishing,pixels:feedPixels,steps:feedSteps,distance:Math.max(0,preparedHeight-KILN_PROMPT_WINDOW_HEIGHT),clock:'visible-burner-window'},editor:editor?.read()??null,runtime:fire.debugState(),burning:burning.read(plan.promptObjectId),lighting:lighting?.debugState()??null,hdr:hdr.read(),gi:gi.debugState()}),
   dispose,
  };
 }catch(error){await dispose();throw error;}
}
