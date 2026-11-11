// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createSceneEnvironmentState} from '../scene-environment-state.mjs';
import {loadSceneAppearance} from './helpers/load-scene-appearance.mjs';
const {THREE,createSceneAppearanceResources,applySceneSpotRecord,SCENE_HDR_PRESETS}=await loadSceneAppearance();
const ctx={assertCurrent(){}};
const record=(id,x)=>({id,light:{enabled:true,color:'#ffeecc',intensity:3,angle:40,penumbra:.2,aimDistance:4},transform:{position:[x,2,3],rotation:[0,0,0],scale:[1,1,1]}});
function fixture(){
 const scene=new THREE.Scene(),renderer={toneMappingExposure:1,capabilities:{getMaxAnisotropy:()=>8}},targets=[],raw=[],prepared=[];
 const state=createSceneEnvironmentState({presets:SCENE_HDR_PRESETS});
 let failTarget=false,arrival={materialTuningEnabled:false},lighting={aoSettings:{radius:3,scale:1,thickness:.2,falloff:1},aoIntensityValue:1,giOptions:{surfaceReuse:true}},ground={};
 const target=()=>{const t={texture:new THREE.Texture(),releases:0,dispose(){if(failTarget)throw Error('PMREM target release denied');this.releases++;}};targets.push(t);return t;};
 let generator={fromEquirectangular(texture){raw.push(texture);return target();},fromScene(){return target();}};
 const entries=[{type:'mesh',object:new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardNodeMaterial())}];scene.add(entries[0].object);
 let load=async()=>new THREE.Texture();
 const shell=createSceneAppearanceResources({THREE,readScene:()=>scene,readRenderer:()=>renderer,readPMREM:()=>generator,environmentState:state,readEntries:()=>entries,
  readArrival:()=>arrival,readGround:()=>ground,readStudio:()=>({records:[record('key',2),record('rim',-2)],enabled:true}),readLighting:()=>lighting,
  loadHDR:url=>load(url),prepareMaterials:(root,settings)=>prepared.push({root,settings})});
 return {shell,scene,renderer,state,entries,targets,raw,prepared,get generator(){return generator;},setArrival:v=>arrival=v,setLighting:v=>lighting=v,setGround:v=>ground=v,
  failTarget:v=>failTarget=v,setGenerator:v=>generator=v,setLoad:v=>load=v};
}
test('actual environment parameters apply without page DOM and use live accepted values',()=>{
 const f=fixture();assert.equal(typeof document,'undefined');f.state.patch({exposure:2,intensity:.4,rotation:.8});f.shell.applyEnvironment();
 assert.equal(f.renderer.toneMappingExposure,2);assert.equal(f.scene.environmentIntensity,.4);assert.equal(f.scene.environmentRotation.y,.8);
 assert.equal(f.entries[0].object.material.envMapIntensity,.4);
 f.setArrival({materialTuningEnabled:true,plan:{environmentDelta:{exposureScale:2,envIntensityScale:3,envRotationOffset:.2}},materialProfile:{}});
 f.shell.applyEnvironment();assert.equal(f.renderer.toneMappingExposure,4);assert.equal(f.scene.environmentIntensity,.4*3);assert.equal(f.prepared.at(-1).settings.maxAnisotropy,8);
});
test('retained initialization builds real ground/studio resources and actual lighting options',async()=>{
 const f=fixture();assert.equal(f.shell.ground,null);f.shell.environment.releaseFull();await f.shell.initialize(ctx);await f.shell.environment.whenSettled();
 const g=f.shell.ground;assert(g.isMesh);assert.equal(g.geometry.type,'CircleGeometry');assert.equal(g.position.y,-.85);assert.equal(g.receiveShadow,true);assert.equal(g.material.roughness,.65);assert(g.material.opacityNode);assert.equal(g.material.userData.kaminosCycloramaFloor,true);
 assert.equal(f.shell.studio.key.isSpotLight,true);assert.equal(f.shell.studio.key.shadow.mapSize.x,2048);assert.deepEqual(f.shell.studio.key.position.toArray(),[2,2,3]);
 assert.equal(f.shell.lightingOptions.aoSettings.radius,3);assert.equal(typeof f.shell.lightingOptions.aoCompute,'function');assert.equal(typeof f.shell.lightingOptions.createSceneGI,'function');
 f.setLighting({aoSettings:{radius:7},aoIntensityValue:.3,giOptions:{surfaceReuse:false}});assert.equal(f.shell.lightingOptions.aoSettings.radius,7);
 assert.equal(f.shell.read().ground.height,-.85);await f.shell.retire(ctx);assert.equal(f.shell.ground,null);assert.equal(f.shell.studio,null);
 assert(f.targets.every(t=>t.releases===1));await f.shell.retire(ctx);assert(f.targets.every(t=>t.releases===1));
});
test('ground overrides and distributed geometry preserve the actual constructor choices',async()=>{
 const f=fixture();f.setGround({distributed:true,height:-2,color:'#123456',roughness:.3,metalness:.2,visible:false});f.shell.initializeGround(ctx);
 assert.equal(f.shell.ground.geometry.type,'RingGeometry');assert.equal(f.shell.ground.position.y,-2);assert.equal(f.shell.ground.material.color.getHexString(),'123456');assert.equal(f.shell.ground.visible,false);
 await f.shell.retire(ctx);
});
test('pending PMREM uses minimum support and stale decoded HDR cannot touch replaced generator',async()=>{
 const f=fixture(),resolvers=[];f.setLoad(()=>new Promise(r=>resolvers.push(r)));f.shell.environment.releaseFull();f.shell.environment.select('studio');await new Promise(r=>setImmediate(r));
 assert.deepEqual([f.raw[0].image.width,f.raw[0].image.height],[64,32]);
 f.shell.environment.invalidateResources();let released=0;
 for(const resolve of resolvers){const late=new THREE.Texture();late.addEventListener('dispose',()=>released++);resolve(late);}await new Promise(r=>setImmediate(r));
 assert.equal(f.targets.length,1,'stale decoded HDR must not allocate another PMREM');assert.equal(released,resolvers.length);await f.shell.retire(ctx);
});
test('failed target cleanup keeps ownership and blocks reinitialization until retirement retries',async()=>{
 const f=fixture();f.shell.environment.select('neutral');assert.equal(f.targets.length,1);f.failTarget(true);
 await assert.rejects(f.shell.retire(ctx),/PMREM target release denied/);assert.equal(f.targets[0].releases,0);
 await assert.rejects(f.shell.initialize(ctx),/retir/);f.failTarget(false);await f.shell.retire(ctx);assert.equal(f.targets[0].releases,1);
});
test('device invalidation fences I/O before fallible retained environment cleanup',async()=>{
 const f=fixture();f.shell.environment.releaseFull();await f.shell.initialize(ctx);await f.shell.environment.whenSettled();
 f.failTarget(true);assert.doesNotThrow(()=>f.shell.environment.invalidateResources(),'invalidation must not run fallible GPU retirement');
 await assert.rejects(f.shell.retire(ctx),/PMREM target release denied/);f.failTarget(false);await f.shell.retire(ctx);
 assert(f.targets.every(target=>target.releases===1));
});

test('actual page consumes the shared catalog, owner, settings and environment map publication',async()=>{
 const f=fixture(),source=readFileSync(new URL('../index.html',import.meta.url),'utf8');let studioSyncs=0;
 const loading={style:{}};
 const c={THREE,createSceneAppearanceResources,applySceneSpotRecord,SCENE_HDR_PRESETS,scene:f.scene,renderer:f.renderer,pmremGenerator:f.generator,
  sceneEnvironment:f.state,workingScene:{objects:f.entries},sceneAO:{read:()=>({radius:7})},effectiveAOIntensity:()=>.5,
  arrivalLightingState:{studioLightsEnabled:true,plan:{lights:[record('key',2),record('rim',-2)]}},
  fireLightFieldRouteParams:()=>new URLSearchParams('volume_light_field_distributed=1'),location:{search:'?lighting_filter=separate&lighting_surface_reuse=0'},URLSearchParams,
  window:{},document:{getElementById:id=>id==='env-loading'?loading:null,querySelectorAll:()=>[]},RGBELoader:class{},
  currentEnvMap:null,neutralEnvironmentMap:null,studioKeyLight:null,studioRimLight:null,groundPlane:null,syncArrivalStudioLighting:()=>studioSyncs++};
 const begin=source.indexOf('const sceneAppearanceResources=createSceneAppearanceResources('),end=source.indexOf('window.kaminosEnvironmentLoading',begin);
 assert(begin>=0&&end>begin,'actual page must construct its appearance owner');
 const catalog=source.slice(source.indexOf('const HDR_ENVS ='),source.indexOf('\n',source.indexOf('const HDR_ENVS =')));
 vm.createContext(c);vm.runInContext(catalog+'\n'+source.slice(begin,end)+'\nglobalThis.appearance=sceneAppearanceResources;',c);
 assert.equal(c.appearance.lightingOptions.aoSettings.radius,7);assert.equal(c.appearance.lightingOptions.aoIntensityValue,.5);
 assert.equal(c.appearance.lightingOptions.giOptions.filterImplementation,'separate');assert.equal(c.appearance.lightingOptions.giOptions.surfaceReuse,false);
 const floorStart=source.indexOf('  groundPlane=sceneAppearanceResources.initializeGround('),floorEnd=source.indexOf('\n',floorStart);
 assert(floorStart>=0);vm.runInContext(source.slice(floorStart,floorEnd),c);assert.equal(c.groundPlane,c.appearance.ground);assert.equal(c.groundPlane.geometry.type,'RingGeometry');
 const studioStart=source.indexOf('function installStartupStudioLights('),studioEnd=source.indexOf('\nlet materialSampleCanvas',studioStart);
 assert(studioStart>=0&&studioEnd>studioStart);vm.runInContext(source.slice(studioStart,studioEnd),c);c.installStartupStudioLights(f.scene);
 assert.equal(studioSyncs,1);assert.equal(c.studioKeyLight,c.appearance.studio.key);
 const loadStart=source.indexOf('async function loadEnvironment('),loadEnd=source.indexOf('\nfunction applyEnvMap(',loadStart);
 vm.runInContext(source.slice(loadStart,loadEnd),c);await c.loadEnvironment('neutral');
 assert.equal(f.state.read().name,'neutral');assert.equal(c.currentEnvMap,f.scene.environment);assert.equal(c.neutralEnvironmentMap,c.appearance.neutralMap);
 await c.appearance.retire(ctx);assert.equal(c.currentEnvMap,null);assert.equal(c.neutralEnvironmentMap,null);
});
test('allocation failure retains the real ground geometry for retryable retirement',async()=>{
 let geometry,releases=0;
 const three={...THREE,CircleGeometry:class extends THREE.CircleGeometry{constructor(...args){super(...args);geometry=this;this.addEventListener('dispose',()=>releases++);}},MeshStandardNodeMaterial:class{constructor(){throw Error('material allocation denied');}}};
 const scene=new THREE.Scene();const shell=createSceneAppearanceResources({THREE:three,readScene:()=>scene,readRenderer:()=>null,readPMREM:()=>null,
  environmentState:{read:()=>({})},readEntries:()=>[],readStudio:()=>null,readLighting:()=>({})});
 await assert.rejects(shell.initialize(ctx),/material allocation denied/);assert(geometry);assert.equal(releases,0);
 await shell.retire(ctx);assert.equal(releases,1);await shell.retire(ctx);assert.equal(releases,1);
});
