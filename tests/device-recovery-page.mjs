// kaminos-test: node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createSceneRecoveryResourceCallbacks} from '../scene-recovery-resources.mjs';
import {createSceneRenderResources} from '../scene-render-resources.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('  let recoverySimulation=null;'),html.indexOf('  window.kaminosDeviceRecovery='));
async function fixture({loading=false,fail=false,present=true,offscreen=false}={}){
 const devices=[],routes=[],events=[];let hooks;const no=()=>{};
 function renderer(device){return {backend:{device},domElement:offscreen?{}:{style:{}},shadowMap:{},getSize:()=>({x:100,y:100}),getPixelRatio:()=>1,setPixelRatio:no,
  setSize:(width,height,updateStyle=true)=>{if(offscreen)assert.equal(updateStyle,false,'recovery on an offscreen canvas must not write CSS style');},
  dispose:()=>events.push('renderer-dispose'),init:async()=>{}};}
 const volume=()=>({isActive:()=>true,debugState:()=>({simulationPaused:false}),retireLostDevice:no,setActive:async()=>{},dispose:async()=>{},setSceneCompositionPresentation:no,relocateOrdinaryDomain:no,setVolumePrimitives:no,setSimulationPaused:no});
 const ctx={console,URLSearchParams,Error,createSceneRecoveryResourceCallbacks,deviceRecovery:null,createDeviceRecovery:o=>(hooks=o,{}),renderer:renderer({destroy:no}),
 volumePrototype:volume(),flameFeature:{present,setActive:async()=>{if(fail)throw Error('late activation failure');}},activeSceneComposition:null,
 waterFeature:{host:null,paused:false,setup:{},recoveryRequested:loading,isLoading:()=>loading,restart(){events.push('water-retire');this.host=null;},async recover(){this.host={device:ctx.renderer.backend.device};return true;}},
 environmentLoader:{invalidateResources:no},transportPrototype:null,authoredWaterFlameTransportActive:false,authoredFlameHDRActive:false,frameComposition:{setForegroundServiceActive:no},
 authoredAsh:new Map(),workingScene:{objects:[]},compositionModule:null,fingerFluidPyroCompositionRequested:()=>false,
 samHostContext:{inferenceSession:{close:async()=>events.push('sam-close')}},samHostConfig:{mounted:true},samHostDeviceRequirements:()=>{},samImageToolsPromise:null,
 sceneLightingPreparation:null,sceneRadianceRouteTask:Promise.resolve(),releaseSceneRadianceRoute:async()=>{},volumeBridge:null,
 giOutputGraphs:new Map(),fireLightFieldPass:null,sceneFlameHDR:null,sceneBloom:{dispose:no},neutralEnvironmentMap:null,scene:{remove:()=>events.push('voxel-remove')},
 collisionVoxelMesh:{userData:{disposeGpuSolid:()=>events.push('voxel-dispose')},geometry:{dispose:no},material:{dispose:no}},collisionVoxelRevision:'old',
 pmremGenerator:{dispose:no},THREE:{Vector2:class{},WebGPURenderer:class{constructor({device}){return renderer(device);}},PMREMGenerator:class{dispose(){}}},
 combinedRequirements:{},sharedDeviceHostRequirements:o=>o,requestKaminosSharedWebGpuDevice:async options=>{events.push(['requirements',options]);const device={destroy(){this.destroyed=true;events.push('device-destroy');}};devices.push(device);return {device};},
 isFireLightFieldTimingRoute:()=>false,location:{search:''},sharedGpu:null,sharedGpuFailureReason:null,compositionHost:{},renderPipeline:{},sceneGI:{resetHistory:no,reflections:{setRenderer:no}},
 createPageVolumePrototype:()=>{ctx.volumePrototype=volume();},flameDomainTranslation:[],flameDomainScale:1,volumePrimitivesInFlameDomain:()=>[],applyFlameEmitterPose:no,flameEmitterPose:{},syncAuthoredFlameSources:no,createVolumeMainRendererBridge:()=>({dispose:no}),
 window:{__kaminosSceneRadiance:{debugState:()=>({live:7})}},fireLightFieldRouteParams:()=>new URLSearchParams('volume_light_field=1'),fireShadowSceneRoute:s=>({live:s.live}),syncSceneRadianceRoute:async route=>routes.push([...route]),
 rebuildSceneGIOutput:no,applyEnvMap:no,createProceduralEnv:()=>({dispose:no}),readEnvironmentRecipe:()=>({intensity:1}),recoveryNotice:{},recoveryRetry:{},recoveryText:{},markDirty:no};
 ctx.sceneRenderResources=createSceneRenderResources({THREE:ctx.THREE,scene:ctx.scene,camera:{},
  readViewport:()=>({width:100,height:100,pixelRatio:1}),readSharedGpu:()=>({device:ctx.renderer.backend.device}),
  readRendererOptions:()=>({updateStyle:!offscreen}),readLightingOptions:()=>({}),onConstructed:value=>{ctx.renderer=value;}});
 await ctx.sceneRenderResources.initializeRenderer({assertCurrent:no});
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return {ctx,hooks,events,routes,devices,setFail:value=>{fail=value;},run:()=>hooks.rebuild({assertCurrent:no,watch:()=>()=>events.push('detach')})};
}
{
 const f=await fixture({loading:true});await f.hooks.stop();await f.run();
 assert(f.ctx.waterFeature.host,'water mounting during loss must restart');
 assert.equal(f.ctx.collisionVoxelMesh,null);assert.equal(f.ctx.collisionVoxelRevision,undefined);
 assert(f.events.includes('voxel-dispose'));assert(f.events.some(e=>e[0]==='requirements'&&e[1].hostRequirements.sam));
 assert.deepEqual(f.routes,[[['volume_light_field','1'],['live','7']]]);
}
{
 const f=await fixture({loading:true,fail:true});await f.hooks.stop();await assert.rejects(f.run(),/late activation failure/);
 assert(f.events.includes('device-destroy'),'post-init failure must release candidate device');
 assert.equal(f.ctx.waterFeature.host,null,'failed candidate must release water');
 f.setFail(false);await f.run();assert.equal(f.ctx.waterFeature.host.device,f.devices[1],'retry water must use its replacement device');
}
{
 const f=await fixture({present:false});await f.hooks.stop();await f.run();assert.deepEqual(f.routes,[[]],'cleared flame must not restore URL lighting');
}
{
 const f=await fixture();
 // The ordinary frame error path has already retired the failed runtime.
 f.ctx.waterFeature.recoveryRequested=true;
 assert.equal(f.ctx.waterFeature.host,null);assert.equal(f.ctx.waterFeature.isLoading(),false);
 await f.hooks.stop();await f.run();
 assert(f.ctx.waterFeature.host,'requested water must restart even if its failed runtime was retired before loss notification');
}
console.log('page recovery preserves passive SAM, pending water and live lighting; cleans failed candidates and collision textures');
{
 const f=await fixture({offscreen:true});await f.hooks.stop();await f.run();
 assert(f.ctx.renderer.backend.device===f.devices[0],'offscreen replacement must use the one supplied candidate device');
}

{
 const f=await fixture({fail:true});await f.hooks.stop();
 const release=f.ctx.sceneRenderResources.retireRenderer;let first=true;
 f.ctx.sceneRenderResources.retireRenderer=async()=>{if(first){first=false;throw Error('renderer cleanup temporarily denied');}return release();};
 await assert.rejects(f.run(),/renderer cleanup temporarily denied/);
 assert.equal(f.devices[0].destroyed,undefined,'retain the failed candidate until renderer cleanup succeeds');
 f.setFail(false);await f.run();
 assert.equal(f.devices[0].destroyed,true,'Retry must release the retained failed candidate before acquiring another');
 assert.equal(f.devices.length,2);assert.equal(f.ctx.renderer.backend.device,f.devices[1]);
}
{
 const f=await fixture({fail:true});await f.hooks.stop();
 const request=f.ctx.requestKaminosSharedWebGpuDevice;
 f.ctx.requestKaminosSharedWebGpuDevice=async options=>{
  const next=await request(options),destroy=next.device.destroy;let first=true;
  next.device.destroy=function(){if(first){first=false;throw Error('device cleanup temporarily denied');}return destroy.call(this);};return next;
 };
 await assert.rejects(f.run(),/device cleanup temporarily denied/);
 f.setFail(false);await f.run();
 assert.equal(f.devices[0].destroyed,true,'Retry must retain and retry a failed device release');
 assert.equal(f.events.filter(event=>event==='renderer-dispose').length,2,'released renderer handles cannot be disposed again');
}
