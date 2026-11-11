import {createEnvironmentLoader} from './scene-environment-loader.mjs';
import {applySceneEnvironmentBackground} from './scene-environment-background.mjs';
import {prepareArrivedMeshMaterials} from './asset-arrival.mjs';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {aoCompute} from './lib/addons/tsl/display/GTAOComputeNode.js';
import {denoise} from './lib/addons/tsl/display/DenoiseNode.js';
import {configureMaterialSideAODepth} from './scene-ao-depth.mjs';
import {createSceneGI} from './scene-gi.mjs';

import {SCENE_HDR_PRESETS} from './scene-environment-presets.mjs';
export {SCENE_HDR_PRESETS};

export function applySceneSpotRecord(THREE,light,record,enabled){
 if(!light||!record)return false;
 const wasVisible=light.visible;
 light.visible=Boolean(enabled&&record.light.enabled);light.color.set(record.light.color);
 light.intensity=record.light.intensity;light.angle=THREE.MathUtils.degToRad(record.light.angle);light.penumbra=record.light.penumbra;
 light.position.fromArray(record.transform.position);
 const effectiveAim=Math.max(.5,(record.light.aimDistance||4)*(record.transform.scale?.[2]??1));
 const direction=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(...record.transform.rotation));
 light.target.position.copy(light.position).addScaledVector(direction,effectiveAim);light.target.updateMatrixWorld();
 if(light.shadow?.camera){
  light.shadow.camera.near=Math.max(.1,Math.min(.5,effectiveAim*.12));light.shadow.camera.far=Math.max(8,effectiveAim*3);light.shadow.camera.updateProjectionMatrix?.();
 }
 return wasVisible!==light.visible;
}

// Retain before initialization. All GPU construction uses the caller's current
// renderer/PMREM; authored state, look planning and command admission stay outside.
export function createSceneAppearanceResources({THREE,readScene,readRenderer,readPMREM,environmentState,readEntries,
 readArrival=()=>({}),readGround=()=>({}),readStudio,readLighting,
 loadHDR=url=>new RGBELoader().loadAsync(url),prepareMaterials=prepareArrivedMeshMaterials,changed=()=>{},redraw=()=>{},mapApplied=()=>{}}){
 for(const [name,value]of Object.entries({readScene,readRenderer,readPMREM,readEntries,readArrival,readGround,readStudio,readLighting,loadHDR,prepareMaterials})){
  if(typeof value!=='function')throw Error(`Scene appearance requires ${name}`);
 }
 if(typeof environmentState?.read!=='function')throw Error('Scene appearance requires accepted environment state');
 let ground=null,studio=null,neutral=null,currentMap=null,retiring=false;
 const groundOwned=[],studioOwned=[],targets=new Map();
 const current=ctx=>{if(typeof ctx?.assertCurrent!=='function')throw Error('Scene appearance requires assertCurrent');ctx.assertCurrent();};
 const canInitialize=ctx=>{current(ctx);if(retiring)throw Error('Scene appearance is retiring');};
 function ownTarget(target){
  if(!target?.texture||typeof target.dispose!=='function')throw Error('PMREM must return its owned render target');
  targets.set(target.texture,target);return target.texture;
 }
 function releaseMap(map){
  const target=targets.get(map);
  if(target){target.dispose();targets.delete(map);}
  else map?.dispose?.();
  if(neutral===map)neutral=null;
 }
 function pendingEnvironment(){
  const pixels=new Float32Array(64*32*4);for(let i=0;i<pixels.length;i+=4)pixels.set([.18,.18,.18,1],i);
  const texture=new THREE.DataTexture(pixels,64,32,THREE.RGBAFormat,THREE.FloatType);
  texture.mapping=THREE.EquirectangularReflectionMapping;texture.needsUpdate=true;
  try{return ownTarget(readPMREM().fromEquirectangular(texture));}finally{texture.dispose();}
 }
 function neutralEnvironment(){
  if(neutral)return neutral;
  const envScene=new THREE.Scene();envScene.add(new THREE.HemisphereLight(0xffeedd,0x222233,2));
  for(const [color,intensity,position]of [[0xffffff,8,[2,3,2]],[0xddeeff,5,[-3,2,-1]],[0xffeedd,3,[0,-1,3]]]){
   const light=new THREE.PointLight(color,intensity,10);light.position.set(...position);envScene.add(light);
  }
  neutral=ownTarget(readPMREM().fromScene(envScene,.04));return neutral;
 }
 function updateBackground(){return applySceneEnvironmentBackground(readScene(),environmentState.read(),currentMap);}
 function applyEnvironment(value=environmentState.read()){
  const renderer=readRenderer(),scene=readScene();if(!renderer||!scene)return false;
  const arrival=readArrival()??{},delta=arrival.materialTuningEnabled&&arrival.plan?.environmentDelta
   ?arrival.plan.environmentDelta:{exposureScale:1,envIntensityScale:1,envRotationOffset:0};
  const ev=arrival.matchedFlameEv??0,matched=Number.isFinite(ev)&&ev!==0?2**ev:1;
  renderer.toneMappingExposure=value.exposure*delta.exposureScale*matched;
  scene.environmentIntensity=value.intensity*delta.envIntensityScale;scene.environmentRotation=new THREE.Euler(0,value.rotation+delta.envRotationOffset,0);
  for(const {object,type}of readEntries()){
   if(arrival.materialTuningEnabled&&object&&type!=='light'&&type!=='camera'){
    prepareMaterials(object,{maxAnisotropy:renderer.capabilities?.getMaxAnisotropy?.()||16,materialTuning:true,materialProfile:arrival.materialProfile,baseEnvMapIntensity:value.intensity});
   }else object?.traverse?.(child=>{for(const material of [].concat(child.material||[]))material.envMapIntensity=scene.environmentIntensity;});
  }
  updateBackground();redraw();return true;
 }
 function applyEnvironmentMap(map,intensity=environmentState.read().intensity){
  const scene=readScene(),renderer=readRenderer(),arrival=readArrival()??{};
  const effective=intensity*(arrival.materialTuningEnabled?(arrival.plan?.environmentDelta?.envIntensityScale??1):1);
  scene.environment=map;scene.environmentIntensity=effective;currentMap=map;mapApplied(map);updateBackground();
  for(const {object,type}of readEntries()){
   if(arrival.materialTuningEnabled&&object&&type!=='light'&&type!=='camera')prepareMaterials(object,{
    maxAnisotropy:renderer?.capabilities?.getMaxAnisotropy?.()||16,materialTuning:true,materialProfile:arrival.materialProfile,baseEnvMapIntensity:intensity});
   object?.traverse?.(child=>{for(const material of [].concat(child.material||[])){
    if(!arrival.materialTuningEnabled)material.envMapIntensity=effective;material.needsUpdate=true;
   }});
  }
  redraw();return map;
 }
 const loader=createEnvironmentLoader({presets:SCENE_HDR_PRESETS,
  async load(url,{isCurrent}){
   const generator=readPMREM(),texture=await loadHDR(url);
   try{if(retiring||!isCurrent()||generator!==readPMREM())throw Error('Environment device retired');return ownTarget(generator.fromEquirectangular(texture));}
   finally{texture.dispose();}
  },apply:map=>applyEnvironmentMap(map),fallback:neutralEnvironment,placeholder:pendingEnvironment,changed,disposeResource:releaseMap});
 const environment={...loader,invalidateResources(){loader.invalidateResources({dispose:false});}};
 function invalidateEnvironment(){
  loader.invalidateResources();
  for(const map of targets.keys())releaseMap(map);
  const scene=readScene();if(scene?.environment===currentMap)scene.environment=null;
  if(scene?.background===currentMap){scene.background=null;scene.backgroundNode=null;}
  currentMap=null;mapApplied(null);
 }
 function applyGround(value=readGround()){
  if(!ground)throw Error('Scene ground is not initialized');
  if(value.height!==undefined)ground.position.y=value.height;
  if(value.visible!==undefined)ground.visible=value.visible;
  for(const key of ['color','roughness','metalness'])if(value[key]!==undefined){if(key==='color')ground.material.color.set(value[key]);else ground.material[key]=value[key];}
  return {height:ground.position.y,visible:ground.visible,color:'#'+ground.material.color.getHexString(),roughness:ground.material.roughness,metalness:ground.material.metalness};
 }
 function initializeGround(ctx){
  canInitialize(ctx);if(ground||groundOwned.length)throw Error('Scene ground resources already retained');
  const value=readGround();
  const geometry=value.distributed?new THREE.RingGeometry(0,5,128,40):new THREE.CircleGeometry(5,64);groundOwned.push(geometry);
  const material=new THREE.MeshStandardNodeMaterial({color:0x808080,roughness:.65,metalness:0});groundOwned.push(material);
  material.transparent=false;material.blending=THREE.CustomBlending;material.blendSrc=THREE.SrcAlphaFactor;material.blendDst=THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha=THREE.OneFactor;material.blendDstAlpha=THREE.OneMinusSrcAlphaFactor;
  material.opacityNode=THREE.TSL.smoothstep(THREE.TSL.float(5),THREE.TSL.float(1.65),THREE.TSL.positionLocal.xy.length());
  ground=new THREE.Mesh(geometry,material);ground.rotation.x=-Math.PI/2;ground.position.y=-.85;ground.receiveShadow=true;
  material.userData={...material.userData,kaminosCycloramaFloor:true};readScene().add(ground);applyGround(value);current(ctx);return ground;
 }
 function initializeStudio(ctx){
  canInitialize(ctx);if(studio||studioOwned.length)throw Error('Scene studio resources already retained');
  const make=name=>{const light=new THREE.SpotLight();studioOwned.push(light);light.name=name;light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.bias=-.00005;light.shadow.normalBias=.004;return light;};
  const key=make('Startup studio key light'),rim=make('Startup studio rim light');studio={key,rim};
  readScene().add(key,key.target,rim,rim.target);current(ctx);return studio;
 }
 function applyStudio(value=readStudio()){
  if(!studio)throw Error('Scene studio is not initialized');
  if(!Array.isArray(value?.records)||value.records.length!==2)throw Error('Scene studio requires the actual key and rim records');
  let didChange=false;
  if(!value.skipKey)didChange=applySceneSpotRecord(THREE,studio.key,value.records[0],value.enabled)||didChange;
  if(!value.skipRim)didChange=applySceneSpotRecord(THREE,studio.rim,value.records[1],value.enabled)||didChange;
  return didChange;
 }
 const shell={
  get ground(){return ground;},get studio(){return studio;},get environment(){return environment;},
  get neutralMap(){return neutral;},get currentMap(){return currentMap;},
  get lightingOptions(){return {...readLighting(),aoCompute,denoise,configureMaterialSideAODepth,createSceneGI};},
  initializeGround,initializeStudio,applyGround,applyStudio,applyEnvironment,applyEnvironmentMap,updateBackground,
  createPendingEnvironment:pendingEnvironment,createNeutralEnvironment:neutralEnvironment,invalidateEnvironment,
  async initialize(ctx){canInitialize(ctx);initializeGround(ctx);initializeStudio(ctx);applyStudio();applyEnvironment();environment.select(environmentState.read().name??'studio');current(ctx);return shell.read();},
  read(){return {retiring,retainedEnvironmentTargets:targets.size,ground:ground?{height:ground.position.y,visible:ground.visible,color:'#'+ground.material.color.getHexString(),roughness:ground.material.roughness,metalness:ground.material.metalness}:null,
   studio:studio?{keyVisible:studio.key.visible,rimVisible:studio.rim.visible}:null,environment:structuredClone(environmentState.read()),loading:environment.read()};},
  async retire(ctx){
   current(ctx);retiring=true;invalidateEnvironment();
   if(ground)readScene().remove(ground);
   while(groundOwned.length){await groundOwned.at(-1).dispose();groundOwned.pop();}ground=null;
   for(const light of studioOwned)readScene().remove(light,light.target);
   while(studioOwned.length){await studioOwned.at(-1).dispose();studioOwned.pop();}studio=null;current(ctx);
  },
 };
 return shell;
}
