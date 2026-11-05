// kaminos-test: node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('  let recoverySimulation=null;'),html.indexOf('  window.kaminosDeviceRecovery='));
function fixture({loading=false,fail=false,present=true}={}){
 const devices=[],routes=[],events=[];let hooks;const no=()=>{};
 function renderer(device){return {backend:{device},domElement:{},shadowMap:{},getSize:()=>({x:100,y:100}),getPixelRatio:()=>1,setPixelRatio:no,setSize:no,dispose:()=>events.push('renderer-dispose'),init:async()=>{}};}
 const volume=()=>({isActive:()=>true,debugState:()=>({simulationPaused:false}),retireLostDevice:no,setActive:async()=>{},dispose:async()=>{},setSceneCompositionPresentation:no,relocateOrdinaryDomain:no,setVolumePrimitives:no,setSimulationPaused:no});
 const ctx={console,URLSearchParams,Error,deviceRecovery:null,createDeviceRecovery:o=>(hooks=o,{}),renderer:renderer({destroy:no}),
 volumePrototype:volume(),flameFeature:{present,setActive:async()=>{if(fail)throw Error('late activation failure');}},activeSceneComposition:null,
 waterFeature:{host:null,paused:false,setup:{},isLoading:()=>loading,restart(){events.push('water-retire');this.host=null;},async recover(){this.host={device:ctx.renderer.backend.device};return true;}},
 environmentLoader:{invalidateResources:no},transportPrototype:null,authoredWaterFlameTransportActive:false,authoredFlameHDRActive:false,frameComposition:{setForegroundServiceActive:no},
 authoredAsh:new Map(),workingScene:{objects:[]},compositionModule:null,fingerFluidPyroCompositionRequested:()=>false,
 samHostContext:{inferenceSession:{close:async()=>events.push('sam-close')}},samHostConfig:{mounted:true},samHostDeviceRequirements:()=>{},samImageToolsPromise:null,
 sceneLightingPreparation:null,sceneRadianceRouteTask:Promise.resolve(),releaseSceneRadianceRoute:async()=>{},volumeBridge:null,
 giOutputGraphs:new Map(),fireLightFieldPass:null,sceneFlameHDR:null,sceneBloom:{dispose:no},neutralEnvironmentMap:null,scene:{remove:()=>events.push('voxel-remove')},
 collisionVoxelMesh:{userData:{disposeGpuSolid:()=>events.push('voxel-dispose')},geometry:{dispose:no},material:{dispose:no}},collisionVoxelRevision:'old',
 pmremGenerator:{dispose:no},THREE:{Vector2:class{},WebGPURenderer:class{constructor({device}){return renderer(device);}},PMREMGenerator:class{dispose(){}}},
 combinedRequirements:{},sharedDeviceHostRequirements:o=>o,requestKaminosSharedWebGpuDevice:async options=>{events.push(['requirements',options]);const device={destroy:()=>events.push('device-destroy')};devices.push(device);return {device};},
 isFireLightFieldTimingRoute:()=>false,location:{search:''},sharedGpu:null,sharedGpuFailureReason:null,compositionHost:{},renderPipeline:{},sceneGI:{resetHistory:no},
 createPageVolumePrototype:()=>{ctx.volumePrototype=volume();},flameDomainTranslation:[],flameDomainScale:1,volumePrimitivesInFlameDomain:()=>[],applyFlameEmitterPose:no,flameEmitterPose:{},syncAuthoredFlameSources:no,createVolumeMainRendererBridge:()=>({dispose:no}),
 window:{__kaminosSceneRadiance:{debugState:()=>({live:7})}},fireLightFieldRouteParams:()=>new URLSearchParams('volume_light_field=1'),fireShadowSceneRoute:s=>({live:s.live}),syncSceneRadianceRoute:async route=>routes.push([...route]),
 rebuildSceneGIOutput:no,applyEnvMap:no,createProceduralEnv:()=>({dispose:no}),readEnvironmentRecipe:()=>({intensity:1}),recoveryNotice:{},recoveryRetry:{},recoveryText:{},markDirty:no};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return {ctx,hooks,events,routes,devices,setFail:value=>{fail=value;},run:()=>hooks.rebuild({assertCurrent:no,watch:()=>()=>events.push('detach')})};
}
{
 const f=fixture({loading:true});await f.hooks.stop();await f.run();
 assert(f.ctx.waterFeature.host,'water mounting during loss must restart');
 assert.equal(f.ctx.collisionVoxelMesh,null);assert.equal(f.ctx.collisionVoxelRevision,undefined);
 assert(f.events.includes('voxel-dispose'));assert(f.events.some(e=>e[0]==='requirements'&&e[1].hostRequirements.sam));
 assert.deepEqual(f.routes,[[['volume_light_field','1'],['live','7']]]);
}
{
 const f=fixture({loading:true,fail:true});await f.hooks.stop();await assert.rejects(f.run(),/late activation failure/);
 assert(f.events.includes('device-destroy'),'post-init failure must release candidate device');
 assert.equal(f.ctx.waterFeature.host,null,'failed candidate must release water');
 f.setFail(false);await f.run();assert.equal(f.ctx.waterFeature.host.device,f.devices[1],'retry water must use its replacement device');
}
{
 const f=fixture({present:false});await f.hooks.stop();await f.run();assert.deepEqual(f.routes,[[]],'cleared flame must not restore URL lighting');
}
console.log('page recovery preserves passive SAM, pending water and live lighting; cleans failed candidates and collision textures');
