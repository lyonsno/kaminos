import * as THREE from './lib/three.webgpu.js';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createKaminosVolumePrototype} from './volume-core.js';
import {createSceneRecordOperations} from './scene-record-operations.mjs';
import {createProceduralMesh} from './scene-geometry.mjs';
import {createPromptLettering} from './prompt-lettering.mjs';
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
export async function createInferenceKilnPreview({viewport,document=globalThis.document,recipe,prompt,request=null,settings,sharedGpu,app,signal,rendering={},loadGlb,environment=null}){
 const saved=recipe.document,plan=recipe.plan,scene=new THREE.Scene(),entries=[],owned=[],frames=new Set();
 let disposed=false,active=false,fire=null,lighting=null,burning=null,gi=null,hdr=null,sceneBloom=null,pipeline=null,transport=null,lastError=null,frameCount=0;
 const aspect=plan.sceneCamera.aspect[0]/plan.sceneCamera.aspect[1],width=320,height=Math.round(width/aspect);
 const record=plan.objects.find(r=>r.id===plan.sceneCamera.activeId),view=record?cameraViewFromRecord(record,aspect):saved.camera;
 if(!view||view.projection==='orthographic')throw Error('Choose a perspective kiln camera');
 const camera=new THREE.PerspectiveCamera(view.fov,aspect,view.near,view.far);camera.position.fromArray(view.position);camera.up.fromArray(view.up??[0,1,0]);camera.lookAt(...view.target);camera.updateMatrixWorld();
 const renderer=new THREE.WebGPURenderer({antialias:true,device:sharedGpu.device});
 const canvas=renderer.domElement;canvas.id='generation-flame-canvas';canvas.setAttribute('aria-label','Physical kiln preview');viewport.append(canvas);
 renderer.setPixelRatio(1);renderer.setSize(width,height);renderer.shadowMap.enabled=true;renderer.toneMapping=THREE.AgXToneMapping;
 const hidden=new Set(plan.editorDisplay?.hiddenIds??[]),colliders=createSceneColliderCollection(THREE);
 const add=(object,record)=>{
  object.position.fromArray(record.transform.position);object.rotation.set(...record.transform.rotation);object.scale.fromArray(record.transform.scale);object.visible=!hidden.has(record.id);object.name=record.label;
  const state=record.materials;if(state)object.traverse(child=>{for(const mat of [].concat(child.material??[])){for(const key of ['side','transparent','opacity'])if(state[key]!==undefined)mat[key]=state[key];if(!state.transparent){mat.depthWrite=true;mat.blending=THREE.NormalBlending;}mat.needsUpdate=true;}});
  object.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});scene.add(object);entries.push({...record,object});return object;
 };
 const records=createSceneRecordOperations({loaders:{
  constructed:(object,record)=>add(object,record),
  procedural:record=>{const resource=createProceduralMesh(THREE,mergeGeometries,record.geometry,record.surface);owned.push(resource);return add(resource.group,record);},
  glb:async record=>{const object=await loadGlb(record.source);signal?.throwIfAborted();return add(object,record);},
  light:record=>{const light=new THREE.SpotLight(record.light.color,record.light.intensity);light.castShadow=true;light.shadow.mapSize.set(1024,1024);light.shadow.bias=-.0001;light.shadow.normalBias=.02;light.angle=THREE.MathUtils.degToRad(record.light.angle);light.penumbra=record.light.penumbra;light.position.fromArray(record.transform.position);light.target.position.copy(light.position).addScaledVector(new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(...record.transform.rotation)),record.light.aimDistance*record.transform.scale[2]);light.visible=record.light.enabled&&!hidden.has(record.id);scene.add(light,light.target);owned.push({dispose:()=>light.dispose()});},
  camera:()=>{},flame:()=>{},
 }});
 function failure(error){lastError=error.message;viewport.dataset.error=lastError;}
 async function dispose(){
  if(disposed)return;disposed=true;active=false;
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
  // Change only the preview's chosen prompt. Keep the authored pose, burn
  // settings and material; geometry comes from the same lettering constructor.
  if(prompt!==target.object.userData.kaminosPromptRelief.prompt){const replacement=createPromptLettering(document,prompt,'composed');target.object.geometry.dispose();target.object.geometry=replacement.geometry;target.object.userData.kaminosPromptRelief=replacement.userData.kaminosPromptRelief;replacement.material.dispose();}
  const ground=saved.environment?.ground;
  if(ground?.visible){const mesh=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:ground.color,roughness:ground.roughness,metalness:0}));mesh.rotation.x=-Math.PI/2;mesh.position.y=ground.height;mesh.receiveShadow=true;scene.add(mesh);}
  if(saved.backdrop)throw Error('Use an ordinary backdrop mesh for the kiln scene');
  const env=saved.environment;
  if(env?.name){if(!environment?.url)throw Error('This kiln environment needs an HDR source');
   const image=await new RGBELoader().loadAsync(environment.url);signal?.throwIfAborted();const pmrem=new THREE.PMREMGenerator(renderer);const map=pmrem.fromEquirectangular(image);pmrem.dispose();image.dispose();owned.push(map);scene.environment=map.texture;scene.environmentIntensity=env.intensity??1;scene.environmentRotation.y=env.rotation??0;renderer.toneMappingExposure=env.exposure??1;
   if(env.background){scene.background=map.texture;scene.backgroundBlurriness=env.backgroundBlur??0;scene.backgroundIntensity=env.backgroundBrightness??1;}
  }
  scene.background??=new THREE.Color('#030405');
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
   if(disposed||lighting&&!lighting.canRender())return false;
   runFrames();
   if(transport)hdr.render({frame:transport,input,emissionInput,depthInput,matched:settings.sceneMatchFlameCamera!==false,physical:fire.emissiveCameraState()});
   else pipeline.render();frameCount++;return true;
  }
  fire=createKaminosVolumePrototype({THREE,viewport,camera,controls:{target:new THREE.Vector3(...view.target)},getControls:()=>settings,sharedGpuContext:sharedGpu,
   externalProductTransform:{translate:plan.flameDomainTranslation,scale:plan.flameDomainScale},getPresentationSize:()=>({width,height}),
   getSceneDepth:()=>{if(!draw())return null;return {device:sharedGpu.device,camera,texture:renderer.backend.get(depthInput.value).texture};},
   getSceneCollision:()=>colliders.update(entries),onStatus:state=>{if(state.error)failure(Error(state.error));},
  });fire.canvasElement().style.display=post.bloom?.composeFlame?'none':'';
  fire.setForegroundOpportunityRequester(request=>app.foreground.request({...request,requestId:`kiln-${request.requestId}`}));
  fire.setRaymarchSmokePresentationMode(settings.raymarchSmokePresentation);
  fire.setImmersedSources(flameSourceInputs(plan.flameSources,{controls:settings,translation:plan.flameDomainTranslation,scale:plan.flameDomainScale,visible:id=>!hidden.has(id)}));
  if(post.bloom?.composeFlame)fire.setSceneTransportConsumer(frame=>{transport=frame;try{return frame.renderHost();}finally{transport=null;}});
  burning=createSceneBurning({objects:()=>entries,runtime:()=>fire,createGas:createLogGasSourceGpu,
   createBody:entry=>createSceneBurnBody({entry,renderer,scene,kelvinPerHeat:()=>settings.physicalKelvinPerHeat,ground:()=>({center:[0,ground?.height??-.85,0],height:ground?.height??-.85,radius:5,visible:ground?.visible??true}),onFrame:fn=>{frames.add(fn);return()=>frames.delete(fn);}}),onError:failure});
  signal?.throwIfAborted();
  // One cold frame, no idle simulation or private RAF loop.
  const cold=app.foreground.request({requestId:`kiln-cold-${crypto.randomUUID()}`,metadata:{renderer:'inference-kiln-cold'},run(){draw();return {status:'submitted'};}});await cold.completion;
  return {
   async setActive(value){if(disposed)return;if(active===!!value)return;active=!!value;
    if(active){await fire.setActive(true);signal?.throwIfAborted();await burning.sync();if(entries.some(entry=>burning.read(entry.id).status==='failed'))throw Error(lastError||'Kiln material failed');
     lighting=mountDistributedSceneRadiance({renderer,scene,prototype:fire,device:sharedGpu.device,surfaceLighting:gi.surfaceLighting,getSourceGuide:()=>({position:[...plan.flameSources[0].transform.position],radius:settings.inputRadius,height:settings.plumeHeight,depth:settings.emitterSourceDepth}),...readFireShadowSceneSettings(new URLSearchParams(plan.composition.route))});lighting.setGain(2**plan.composition.lightGainStops);
     const value=(id,fallback)=>rendering[id]??fallback;
     lighting.setSurfaceGain(2**Number(value('rendering-surface-gain',0)));lighting.setSurfaceScattering(!!value('rendering-surface-scattering',true));lighting.setSourceSoftness(Number(value('rendering-source-softness',0)));lighting.setSmokeMode(value('rendering-smoke-solver','distributed'));lighting.setDirections(Number(value('rendering-angular-samples',24)));lighting.setAngularPattern(value('rendering-angular-pattern','fixed'));await lighting.whenRebuilt();
    }else await fire.setActive(false);
   },
   debugState:()=>({identity:'kaminos.inference-kiln-preview.v1',sceneFile:recipe.selection?.sceneFile??null,sceneLabel:saved.label,promptObjectId:plan.promptObjectId,prompt,requestSource:request?'admitted-generation-prompt':'editor-draft',active,error:lastError,frameCount,
    effective:{device:'app-shared-device',width,height,settings,objects:entries.map(row=>({id:row.id,transform:row.transform,burnable:row.burnable})),camera:view,bloom:sceneBloom.read()},
    runtime:fire.debugState(),burning:burning.read(plan.promptObjectId),lighting:lighting?.debugState()??null,hdr:hdr.read(),gi:gi.debugState()}),
   dispose,
  };
 }catch(error){await dispose();throw error;}
}
