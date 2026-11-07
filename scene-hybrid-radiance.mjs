import {createShadowCaptureSchedule,createShadowSourceSnapshots,validateShadowCaptureBudget} from './fire-shadow-cadence.mjs';
import {createFireShadowBank,shadowBankPlan} from './fire-shadow-bank.mjs';
import {normalizeNearSmokeBox,nearSmokeBoxCoverage,admitNearSmokeBox} from './scene-near-smoke-box.mjs';
export {authoredSourceRegions} from './scene-source-regions.mjs';
import * as THREE from './lib/three.webgpu.js';
import {cloneSceneRadianceMaterial} from './scene-radiance.mjs';
import {createFireLightFieldShadow,renderFireShadowBatch} from './fire-light-field-shadow.mjs';
import {createLocalSceneVisibility} from './scene-local-visibility.mjs';
import {createVolumeGather,volumeGatherPlan,lightingDirections} from './scene-volume-gather.mjs';
import {createPointRegions} from './scene-point-regions.mjs';
import {validateSceneSourceTransform,sceneSourceDomain,sceneLightingDomain,sceneTransportDomain,DEFAULT_SCENE_SOURCE_GRID,validateSceneSourceGrid} from './scene-volume-source.mjs';
import {deriveSourceGuide} from './scene-source-guide.mjs';
import {validateSourceSoftness} from './scene-source-softening.mjs';
import {validateShadowSampling,validateShadowComparison,shadowGrainNode} from './fire-shadow-sampling.mjs';
import {validateSourceQuadrature,validateSourceEvaluationBudget,sourceEvaluationCount} from './fire-source-quadrature.mjs';
import {validateRuntimeShadowQuality as validateShadowQuality} from './fire-shadow-quality.mjs';
import {createFireShadowCasters} from './fire-shadow-casters.mjs';
import {createFireSmokeShadow,smokeShadowPlan,validateSmokeAngularFilter,smokeShadowWork} from './fire-smoke-shadow.mjs';
import {createSceneSmokeEnvironment,validateSmokeEnvironmentBlur} from './scene-smoke-environment.mjs';
import {validateShadowMediumResolution} from './scene-shadow-medium.mjs';
import {collectSceneSmokeLights} from './scene-smoke-lights.mjs';
import {createExteriorSmokeLight} from './scene-exterior-light.mjs';

// Opt-in prototype. Smoke retains distributed transport. Surfaces consume a
// live GPU reduction of that same source, with independent raster visibility.
export function mountDistributedSceneRadiance({renderer,scene,prototype,device,directions=24,volumeGrid=16,sourceGrid=DEFAULT_SCENE_SOURCE_GRID,smokeRefinement=4,pointCount=4,pointSampling='all',pointEvaluationBudget=0,surfaceEnabled=true,smokeShadowSteps=0,smokeShadowResolution=16,smokeShadowFilter=false,smokeShadowFilterAngle=null,smokeShadowFilterTaps=3,smokeShadowMediumResolution=0,shadowEdgeFilter=false,shadowComparison={},shadowResolution=256,shadowSoftness=0,shadowSampling='fixed',blockerSamples=9,filterSamples=16,getSourceGuide=null,getSourceRegions=null,smokeEnvironmentBlur=0,onStatus=()=>{},createShadow=createFireLightFieldShadow,rebuild=null,surfaceLighting=null,exteriorReceiverCoverage=null,nearBox={},shadowCaptureBudget=0}) {
  validateSceneSourceGrid(sourceGrid);
  if(prototype.setSceneSourceGrid)prototype.setSceneSourceGrid(sourceGrid);
  else if(sourceGrid!==DEFAULT_SCENE_SOURCE_GRID)throw Error('lighting host does not support emission resolution');
  nearBox=normalizeNearSmokeBox(nearBox);
  if(smokeShadowFilterAngle===null)smokeShadowFilterAngle=Math.atan(2/smokeShadowResolution)*180/Math.PI;
  validateSmokeAngularFilter({angleDegrees:smokeShadowFilterAngle,tapsPerAxis:smokeShadowFilterTaps});
  validateShadowMediumResolution(smokeShadowMediumResolution);
  if(typeof smokeShadowFilter!=='boolean')throw Error('smoke shadow filter must be boolean');
  if(typeof shadowEdgeFilter!=='boolean')throw Error('shadow edge filter must be boolean');
  if(typeof surfaceEnabled!=='boolean')throw Error('surface lighting enabled must be boolean');
  validateShadowQuality({resolution:shadowResolution,blockerSamples,filterSamples},device.limits);
  if(!Number.isFinite(shadowSoftness)||shadowSoftness<0)throw Error('shadow softness must be finite and nonnegative');
  validateShadowSampling(shadowSampling);
  validateSourceQuadrature(pointCount,pointSampling);
  validateSourceEvaluationBudget(pointEvaluationBudget);
  validateShadowCaptureBudget(shadowCaptureBudget);
  const validateSmoke=(steps,resolution,count=pointCount)=>{
    if(!Number.isSafeInteger(steps)||steps<0)throw Error('smoke shadow steps must be a nonnegative integer');
    smokeShadowPlan({steps:Math.max(1,steps),resolution,count},device.limits);
  };
  validateSmoke(smokeShadowSteps,smokeShadowResolution);
  const smokeEnvironment=createSceneSmokeEnvironment({renderer,scene,device,blur:smokeEnvironmentBlur});
  const exteriorRefinement=4;
  const exteriorLight=createExteriorSmokeLight(device,{asynchronous:!!rebuild?.prepareKernels,refinement:exteriorRefinement,receiverCoverage:exteriorReceiverCoverage,beforeReplace:()=>prototype.setSceneDistributedLightFrame(null)});
  const {uniform,vec2,vec3,textureLoad,ivec2,positionWorld,normalWorld,screenCoordinate,Fn,If}=THREE.TSL;
  // Deferred surfaces reconstruct their world position per pixel. The default
  // positionWorld is the fullscreen carrier geometry, not the visible surface.
  const receiverPosition=Fn(([],builder)=>builder.context.positionWorld??positionWorld)();
  const translation=uniform(new THREE.Vector3()),scale=uniform(1),surfaceGain=uniform(1);
  const surfaceOn=uniform(surfaceEnabled,'bool');
  const paired=uniform(pointSampling==='paired','bool');
  const budgeted=uniform(pointEvaluationBudget>0,'bool'),evaluatedSources=uniform(sourceEvaluationCount(pointCount,pointEvaluationBudget,pointSampling),'int');
  let comparison=validateShadowComparison(shadowComparison);
  const worldCellSize=uniform(comparison.worldCellSize);
  const casterScene=createFireShadowCasters({scene,enabled:surfaceEnabled});
  let points,external,lights,irradiance,prepareSurfaceSampling,smokeShadow,shadowSources,shadowExternal,captureSchedule,selectedEvaluationAvailable=false,shadowBank=null,shadowBankFallback=null;
  let sourceDomain=sceneSourceDomain(),builtDomain=null,sourceRadius=Math.sqrt(11);
  function buildPoints(count){
  let points,external,lights,irradiance,prepareSurfaceSampling,smokeShadow,shadowSources,shadowExternal,captureSchedule,selectedEvaluationAvailable,shadowBank,shadowBankFallback;
  let pointBank=null;
  const sharedPreparation=comparison.implementation==='shared';
  const filterPattern=sharedPreparation?{count:filterSamples,bytes:0,route:'runtime-arithmetic',reason:null,node:null}:{count:filterSamples,bytes:0,route:'arithmetic',reason:'legacy-comparison',node:null};
  const grain=comparison.grain==='ordered'?null:shadowGrainNode(comparison.grain==='world'?receiverPosition.div(worldCellSize):vec3(screenCoordinate.xy,0),THREE.TSL,comparison.grain==='screen-animated'?THREE.TSL.frameId:null);
  points=createPointRegions(device,{count,partition:'spatial',asynchronous:!!rebuild?.prepareKernels});
  shadowSources=createShadowSourceSnapshots(device,{points:points.texture,count});
  captureSchedule=createShadowCaptureSchedule({count,budget:shadowCaptureBudget});
  shadowExternal=new THREE.ExternalTexture(shadowSources.texture);
  shadowExternal.image={width:count,height:1};shadowExternal.format=THREE.RGBAFormat;shadowExternal.type=THREE.FloatType;
  shadowExternal.colorSpace=THREE.NoColorSpace;shadowExternal.minFilter=shadowExternal.magFilter=THREE.NearestFilter;shadowExternal.generateMipmaps=false;
  smokeShadow=(smokeShadowSteps||typeof renderer.initTexture==='function')?createFireSmokeShadow(device,{points:points.texture,count,steps:smokeShadowSteps,resolution:smokeShadowResolution,filter:smokeShadowFilter,angleDegrees:smokeShadowFilterAngle,tapsPerAxis:smokeShadowFilterTaps,mediumResolution:smokeShadowMediumResolution,renderer}):null;
  external=new THREE.ExternalTexture(points.texture);
  external.image={width:count,height:2};external.format=THREE.RGBAFormat;external.type=THREE.FloatType;
  external.colorSpace=THREE.NoColorSpace;external.minFilter=external.magFilter=THREE.NearestFilter;external.generateMipmaps=false;
  lights=Array.from({length:count},(_,i)=>{
    const region=textureLoad(external,ivec2(i,0)),energy=textureLoad(external,ivec2(i,1)).rgb;
    const position=region.xyz.mul(scale).add(translation);
    const captureTransform=uniform(new THREE.Vector4(0,0,0,1));
    const capturePosition=textureLoad(shadowExternal,ivec2(i,0)).xyz.mul(captureTransform.w).add(captureTransform.xyz);
    const filterCoordinates=grain?.coordinates??paired.select(vec2(screenCoordinate.x.div(2).floor(),screenCoordinate.y),screenCoordinate.xy);
    const depthLookup=(ray,fallback)=>pointBank?pointBank.sampleDepth(i,ray):fallback();
    const shadow=createShadow({renderer,scene,sourceNode:capturePosition,sourceIdentity:'retained-gpu-solid-shadow-anchor',receiverNode:receiverPosition,normalNode:normalWorld,requested:true,resolution:shadowResolution,sourceRadius:()=>translation.value.length()+scale.value*sourceRadius,sourceSizeNode:region.w.max(0).sqrt().mul(scale),shadowSoftness,shadowSampling,shadowEdgeFilter,filterCoordinates,screenAligned:comparison.grain!=='world',sharedPreparation,blockerSamples,filterSamples,filterPattern,runtimeQuality:true,depthLookup});
    // Source coefficients use volume-local lengths. Express distance there;
    // scaling the object should not silently scale its radiometric brightness.
    const delta=position.sub(receiverPosition).div(scale),distance2=delta.dot(delta);
    const direction=delta.div(distance2.sqrt().max(1e-6));
    const medium=smokeShadow?smokeShadow.visibility(region.xyz,receiverPosition.sub(translation).div(scale),i):THREE.TSL.float(1);
    return {shadow,captureTransform,depthLookup,irradiance:energy.div(distance2.add(region.w)).mul(normalWorld.dot(direction).max(0)).mul(shadow.visibility).mul(medium)};
  });
  const compatible=lights.every(l=>l.shadow.receiverSampling?.depthLookup===l.depthLookup&&typeof l.shadow.resource==='function');
  pointBank=compatible?createFireShadowBank({renderer,count,resolution:shadowResolution}):null;
  shadowBank=pointBank;shadowBankFallback=pointBank?null:compatible?(shadowBankPlan({count,resolution:shadowResolution},device.limits).reason??'renderer-without-array-texture-support'):'shadow-factory-without-bank-interface';
  const currentLights=lights;
  // Keep separate captures, but select their data before expensive filtering.
  // Only the texture lookup switches between maps; PCSS arithmetic is shared.
  const sharedSelected=currentLights.every(l=>l.shadow.receiverSampling&&l.shadow.receiverVisibility)?index=>Fn(()=>{
    const {float,vec4}=THREE.TSL;
    const region=textureLoad(external,ivec2(index,0)),energy=textureLoad(external,ivec2(index,1)).rgb;
    const transform=vec4(0).toVar(),differential=vec3(0).toVar(),strength=float(0).toVar();
    for(let i=0;i<count;i++)If(index.equal(i),()=>{
      transform.assign(currentLights[i].captureTransform);
      differential.assign(currentLights[i].shadow.receiverSampling.filterDifferential??vec3(0));
      strength.assign(currentLights[i].shadow.receiverSampling.strength);
    });
    const source=textureLoad(shadowExternal,ivec2(index,0)).xyz.mul(transform.w).add(transform.xyz);
    const depth=pointBank?ray=>pointBank.sampleDepth(index,ray):ray=>Fn(()=>{
      const value=float(0).toVar();
      for(let i=0;i<count;i++)If(index.equal(i),()=>value.assign(currentLights[i].shadow.receiverSampling.sampleDepth(ray)));
      return value;
    })();
    const visibility=currentLights[0].shadow.receiverVisibility({source,size:region.w.max(0).sqrt().mul(scale),depth,differential,strength});
    const delta=region.xyz.mul(scale).add(translation).sub(receiverPosition).div(scale),distance2=delta.dot(delta);
    const direction=delta.div(distance2.sqrt().max(1e-6));
    const medium=smokeShadow?smokeShadow.visibility(region.xyz,receiverPosition.sub(translation).div(scale),index):float(1);
    return energy.div(distance2.add(region.w)).mul(normalWorld.dot(direction).max(0)).mul(visibility).mul(medium);
  })():null;
  selectedEvaluationAvailable=Boolean(sharedSelected);
  prepareSurfaceSampling=()=>{
    grain?.bits.toStack();
    // Derivatives must be evaluated in uniform flow, before source selection.
    for(const light of currentLights)light.shadow.prepareSampling?.();
  };
  irradiance=Fn(()=>{
    prepareSurfaceSampling();
    const sum=vec3(0).toVar();
    If(surfaceOn,()=>{
      const phase=(grain?grain.bits.shiftRight(THREE.TSL.uint(4)).mod(THREE.TSL.uint(count)).toInt():screenCoordinate.x.floor().add(screenCoordinate.y.floor()).mod(count).toInt()).toVar();
      const firstPair=grain?.firstPair??screenCoordinate.x.floor().add(screenCoordinate.y.floor()).mod(2).lessThan(1);
      const legacyWeight=count===4?paired.select(2,1):THREE.TSL.float(1);
      const weight=budgeted.select(THREE.TSL.float(count).div(evaluatedSources),legacyWeight).toVar();
      const separate=()=>{
        for(let i=0;i<count;i++){
          const withinBudget=THREE.TSL.int(i).sub(phase).add(count).mod(count).lessThan(evaluatedSources);
          const legacySelected=count===4?paired.not().or(i%2===0?firstPair:firstPair.not()):THREE.TSL.bool(true);
          If(budgeted.select(withinBudget,legacySelected),()=>sum.addAssign(currentLights[i].irradiance.mul(weight)));
        }
      };
      if(sharedSelected)If(budgeted,()=>{
        // Visit the cyclic subset in the same ascending order as the original
        // unrolled sum, including a subset that wraps past the last source.
        const wrapped=phase.add(evaluatedSources).sub(count).max(0).toVar();
        THREE.TSL.Loop({start:THREE.TSL.int(0),end:evaluatedSources,type:'int',condition:'<'},({i})=>{
          const index=i.lessThan(wrapped).select(i,phase.add(i).sub(wrapped)).toVar();
          sum.addAssign(sharedSelected(index).mul(weight));
        });
      }).Else(separate);else separate();
    });
    return sum.mul(surfaceGain);
  })();
  return {points,external,lights,irradiance,prepareSurfaceSampling,smokeShadow,shadowSources,shadowExternal,captureSchedule,selectedEvaluationAvailable,shadowBank,shadowBankFallback};
  }
  const pointGeneration=()=>({points,external,lights,irradiance,prepareSurfaceSampling,smokeShadow,shadowSources,shadowExternal,captureSchedule,selectedEvaluationAvailable,shadowBank,shadowBankFallback});
  const usePoints=g=>({points,external,lights,irradiance,prepareSurfaceSampling,smokeShadow,shadowSources,shadowExternal,captureSchedule,selectedEvaluationAvailable,shadowBank,shadowBankFallback}=g);
  function releasePoints(g=pointGeneration()){g.shadowBank?.dispose();for(const light of g.lights)light.shadow.dispose();g.smokeShadow?.dispose(renderer);delete renderer.backend.get(g.external).texture;g.external.dispose();delete renderer.backend.get(g.shadowExternal).texture;g.shadowExternal.dispose();g.shadowSources.destroy();g.points.destroy();}
  usePoints(buildPoints(pointCount));
  let originals=new Map();const localVisibility=createLocalSceneVisibility();let gather=null,geometryRevision=null,frame=null,disposed=false,valid=false;
  let gain=1,sourceSoftness=0,surfaceScattering=false,smokeMode='distributed',angularPattern='fixed',angularRotation=0,retainComparisons=false;
  let sourceTransform=validateSceneSourceTransform();
  const status={identity:'hybrid-distributed-smoke-point-surfaces-v0',status:'awaiting-source',surfaceTransport:'gpu-point-regions',surfaceReceivers:0,pointCount,shadowResolution,shadowSoftness,shadowSampling,blockerSamples,filterSamples,maxShadowResolution:device.limits.maxTextureDimension2D,volumeGrid,sourceGrid,directions,
    geometryBuilds:0,visibilityBuilds:0,previewStale:false,receiverSpacingRequested:0,surfaceReconstructionRequested:0,
    limitations:['point-region-surface-approximation','center-cube-area-shadow-approximation','GPU-smoke-visibility-refresh-on-transform','CPU-local-BVH-rebuild-on-vertex-or-topology-edit','no-surface-bounce']};
  let rebuildRevision=0,rebuildTask=null,rebuilding=false,kernelTask=null,kernelRetry=null,pendingGather=null,settingsPending=null;
  const retiredGathers=[];
  function replaceLighting(){stageLighting(()=>true).commit();}
  // Candidate graphs own their textures and cloned materials. Compilation
  // borrows them; every yield restores the accepted generation for drawing.
  function stageLighting(isCurrent){
    const accepted=pointGeneration(),acceptedMaterials=originals;
    const candidate=buildPoints(pointCount),candidateMaterials=new Map();
    const select=(generation,materials)=>{
      usePoints(generation);originals=materials;
      for(const [mesh,row] of materials)mesh.material=row.installed;
    };
    const disposeMaterials=materials=>{for(const row of materials.values())for(const material of row.owned){surfaceLighting?.unbind(material);material.dispose();}};
    try {
      usePoints(candidate);originals=candidateMaterials;
      for(const [mesh,row] of acceptedMaterials)if(mesh.material===row.installed)mesh.material=row.source;
      installAllMaterials();
    }catch(error){disposeMaterials(candidateMaterials);releasePoints(candidate);select(accepted,acceptedMaterials);throw error;}
    select(accepted,acceptedMaterials);
    let settled=false;
    const discard=()=>{if(settled)return;settled=true;disposeMaterials(candidateMaterials);releasePoints(candidate);};
    return {
      prepare:()=>candidate.points.ready(prototype.sceneVolumeSourceField()),
      borrow(){select(candidate,candidateMaterials);return ()=>select(accepted,acceptedMaterials);},
      commit(){
        if(settled)return;
        if(!isCurrent()){discard();return;}
        settled=true;select(candidate,candidateMaterials);valid=false;
        disposeMaterials(acceptedMaterials);releasePoints(accepted);
      },discard,
    };
  }
  function requestRebuild(){
    rebuildRevision++;
    if(!rebuild){valid=false;replaceLighting();status.status='awaiting-source';return;}
    status.status='compiling-lighting';delete status.error;onStatus({...status});
    if(rebuildTask)return;
    const quiescent=rebuild.hold(true);
    rebuildTask=Promise.resolve().then(async()=>{
      await quiescent;
      rebuilding=true;if(!rebuild.prepareRetained)valid=false;
      let compiled;
      do {
        if(disposed)return;
        compiled=rebuildRevision;
        if(rebuild.prepareRetained)await rebuild.prepareRetained(()=>stageLighting(()=>!disposed&&compiled===rebuildRevision));
        else if(rebuild.prepare)await rebuild.prepare(()=>{if(!disposed)replaceLighting();});
        else {replaceLighting();await rebuild.compile();}
      } while(!disposed&&compiled!==rebuildRevision);
      if(!disposed){rebuilding=false;status.status='awaiting-source';rebuild.hold(false);onStatus({...status});}
    }).catch(error=>{
      if(!disposed){status.status='lighting-compile-failed';status.error=String(error.message);onStatus({...status});}
      throw error;
    }).finally(()=>{rebuildTask=null;if(disposed)rebuild.hold(false);});
    // Keep a failed compile visible and held until retry/disposal, without an
    // unhandled rejection from synchronous UI setters. whenRebuilt rejects.
    rebuildTask.catch(()=>{});
  }
  function installMaterials(root=scene){
    root.traverseVisible(mesh=>{
      if(!mesh.isMesh)return;
      const prior=originals.get(mesh);if(prior&&mesh.material===prior.installed)return;
      if(prior){for(const m of prior.owned){surfaceLighting?.unbind(m);m.dispose();}originals.delete(mesh);}
      const source=mesh.material,list=Array.isArray(source)?source:[source];
      if(!list.every(m=>m.isMeshStandardMaterial||m.isMeshStandardNodeMaterial||m.isMeshPhysicalMaterial||m.isMeshPhysicalNodeMaterial))return;
      const owned=list.map(original=>{
        const material=cloneSceneRadianceMaterial(renderer.library,original),setup=material.setupMaterialLightings;
        const radiance=irradiance,sampling=prepareSurfaceSampling;
        // The callback below injects a live graph outside Three's standard
        // material properties. Expose it to the material observer as well:
        // otherwise unchanged GI-source surfaces can skip uniform/binding
        // refresh and submit a destroyed texture after a live shadow resize.
        material.sceneRadianceNode=irradiance;
        const cacheKey=material.customProgramCacheKey;
        // This injected graph is not one of NodeMaterial's enumerated node
        // properties. A version bump alone can reuse its old texture bindings.
        material.customProgramCacheKey=function(){return `${cacheKey.call(this)}:hybrid:${radiance.uuid}`;};
        surfaceLighting?.bind(material,radiance,sampling);
        material.setupMaterialLightings=function(builder){return [...setup.call(this,builder),new THREE.IrradianceNode(surfaceLighting?.forMaterial(builder,this,radiance)??radiance)];};return material;
      });
      const installed=Array.isArray(source)?owned:owned[0];originals.set(mesh,{source,installed,owned});mesh.material=installed;
    });
  }
  function releaseProxyMaterials(root){
    root.traverse(mesh=>{
      const row=originals.get(mesh);if(!row)return;
      if(mesh.material===row.installed)mesh.material=row.source;
      for(const material of row.owned){surfaceLighting?.unbind(material);material.dispose();}
      originals.delete(mesh);
    });
  }
  function installAllMaterials(){
    installMaterials();
    for(const root of surfaceLighting?.proxyRoots??[])installMaterials(root);
  }
  const releaseProxyAdapter=surfaceLighting?.setProxyMaterialAdapter({install:installMaterials,release:releaseProxyMaterials});
  function armSettings(){
    if(settingsPending)return;
    let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});
    settingsPending={promise,resolve,reject};prototype.setSceneLightingSettingsPending?.(true);
  }
  function finishSettings(error=null){
    const pending=settingsPending;settingsPending=null;
    if(pending)error?pending.reject(error):pending.resolve();
    prototype.setSceneLightingSettingsPending?.(false);
  }
  function queueKernelPreparation(operation){
    if(kernelTask)return;
    kernelRetry=()=>queueKernelPreparation(operation);
    status.status='preparing-lighting-kernels';onStatus({...status});
    kernelTask=rebuild.prepareKernels(operation).then(()=>{kernelRetry=null;status.status='awaiting-source';delete status.error;},error=>{
      status.status='lighting-kernel-failed';status.error=String(error.message);settingsPending?.reject(error);throw error;
    }).finally(()=>{kernelTask=null;onStatus({...status});});
    kernelTask.catch(()=>{});
  }
  function prepare(field){
    if(disposed)throw new Error('hybrid lighting disposed');const acceptedValid=valid;valid=false;
    if(rebuilding||status.status==='lighting-compile-failed')throw Error(status.error??'lighting compilation pending');
    try {
      sourceTransform=validateSceneSourceTransform(field.source.worldTransform);
      sourceDomain=sceneLightingDomain(field.source);
      const domainKey=JSON.stringify(sourceDomain.hi);
      const transportDomain=sceneTransportDomain(field.source);
      sourceRadius=Math.hypot(...transportDomain.hi.map((x,a)=>Math.max(Math.abs(x),Math.abs(transportDomain.lo[a]))));
      translation.value.set(...sourceTransform.translate);scale.value=sourceTransform.scale;
      installAllMaterials();
      const flameBox={min:sourceDomain.lo.map((v,a)=>v*sourceTransform.scale+sourceTransform.translate[a]),max:sourceDomain.hi.map((v,a)=>v*sourceTransform.scale+sourceTransform.translate[a])};
      const started=performance.now(),snapshot=casterScene.withCapture(()=>localVisibility.snapshot(scene),{smokeVisibility:true,flameBox}),{revision,geometry:packed}=snapshot;
      status.localBvhBuilds=snapshot.localBuilds;status.visibilityMeshes=snapshot.meshCount;
      if(!gather||revision!==geometryRevision||domainKey!==builtDomain){
        status.status='building-smoke-world-visibility';onStatus({...status});
        const key=JSON.stringify([revision,domainKey,volumeGrid,smokeRefinement]);
        if(!pendingGather||pendingGather.key!==key){
          pendingGather?.gather.destroy();
          pendingGather={key,volumeGrid,smokeRefinement,gather:createVolumeGather(device,{geometry:packed,receivers:[],volumeGrid,sourceDimensions:sourceDomain.dimensions,smokeRefinement,directions,angularPattern,angularRotation,worldGeometry:true,samplingNoise:prototype.sceneLightSamplingTexture?.(),exteriorMedium:true,asynchronous:!!rebuild?.prepareKernels})};
        }
        const candidate=pendingGather;
        if(rebuild?.prepareKernels){
          valid=acceptedValid;
          queueKernelPreparation(async()=>{
            await candidate.gather.prepare(field.source,{sourceSoftness});
            if(disposed||pendingGather!==candidate||candidate.volumeGrid!==volumeGrid||candidate.smokeRefinement!==smokeRefinement)return;
            if(gather)retiredGathers.push(gather);gather=candidate.gather;pendingGather=null;geometryRevision=revision;builtDomain=domainKey;valid=false;
            status.geometryBuilds++;status.visibilityBuilds++;status.staticTriangles=packed.triangleCount;
          });
          return;
        }
        prototype.setSceneDistributedLightFrame(null);gather?.destroy();gather=candidate.gather;pendingGather=null;geometryRevision=revision;builtDomain=domainKey;
        status.geometryBuilds++;status.visibilityBuilds++;status.lastGeometryBuildMs=performance.now()-started;status.staticTriangles=packed.triangleCount;
      }
      gather.setGeometryTransforms(packed.matrices);
      gather.setDirections(directions);gather.setAngularPattern(angularPattern,angularRotation);gather.setRetainComparisons(retainComparisons);
      if(angularPattern==='guided'){
        if(!getSourceGuide)throw new Error('hybrid guided smoke requires authored source guide');
        gather.setSourceGuide(deriveSourceGuide(getSourceGuide(),sourceTransform,sourceDomain));
      }
      if(rebuild?.prepareKernels&&!gather.isPrepared(field.source,{sourceSoftness})){
        valid=acceptedValid;
        queueKernelPreparation(()=>gather.prepare(field.source,{sourceSoftness}));
        return;
      }
      // Even legacy smoke display may request scattered contribution to the
      // surface points; the gather owns that once-scattered source and gain.
      if(angularPattern==='regions'){if(!getSourceRegions)throw Error('multi-emitter sampling requires stable source regions');gather.setSourceRegions(getSourceRegions(sourceTransform,sourceDomain));}
      const environment=smokeMode==='distributed'||surfaceScattering?smokeEnvironment.frame():null;
      const sceneLights=collectSceneSmokeLights(scene,sourceTransform);
      const fineFrame=gather.encode(field.source,{gain,sourceSoftness,surfaceScattering,smokeEnabled:smokeMode==='distributed',environment,sceneLights,samplingFrame:prototype.sceneLightSamplingFrame?.()??field.source.frame});
      exteriorLight.setReceiverCoverage(exteriorReceiverCoverage??nearSmokeBoxCoverage(nearBox,sourceDomain));
      const exteriorOptions={geometry:packed,revision,directions,gain,sourceSoftness,environment,sceneLights,fineReceiverGrid:volumeGrid};
      if(rebuild?.prepareKernels&&smokeMode==='distributed'&&!exteriorLight.isPrepared(field.source,exteriorOptions)){
        valid=acceptedValid;
        queueKernelPreparation(()=>exteriorLight.prepare(field.source,exteriorOptions));
        return;
      }
      const exterior=smokeMode==='distributed'?exteriorLight.encode(field.source,exteriorOptions):null;
      if(rebuild?.prepareKernels&&surfaceEnabled&&!points.isPrepared(gather.transportSource())){
        valid=acceptedValid;queueKernelPreparation(()=>points.ready(gather.transportSource()));return;
      }
      const reduction=surfaceEnabled?points.encode(gather.transportSource()):null;
      const medium=surfaceEnabled&&smokeShadowSteps&&smokeShadow?smokeShadow.encode(field.source,reduction):null;
      let solidShadowCapture=null;
      if(surfaceEnabled){
        // Pose motion and evolving resident occupancy deliberately age with the
        // cubes. Structural/material-layout edits and changed resources reset
        // the bank. The view camera is absent from this world-space identity.
        const captureKey=JSON.stringify([snapshot.solidRevision??revision,sourceDomain.dimensions,transportDomain.lo,transportDomain.hi,sourceTransform,shadowResolution,casterScene.debugState().level]);
        const plan=captureSchedule.begin(captureKey);
        shadowSources.capture(plan.indices);
        const selected=plan.indices.map(i=>{lights[i].captureTransform.value.set(...sourceTransform.translate,sourceTransform.scale);return lights[i].shadow;});
        if(comparison.implementation==='shared')renderFireShadowBatch({scene,shadows:selected,casterScene,flameBox});
        else casterScene.withCapture(()=>{for(const shadow of selected)shadow.render();},{flameBox});
        shadowBank?.copyCompleted(plan.indices,lights.map(l=>l.shadow));
        solidShadowCapture=captureSchedule.commit(plan,{generation:field.source.generation,frame:field.source.frame});
      }
      frame={...fineFrame,exterior,pointRegions:reduction,smokeShadow:medium,solidShadowCapture,surfaceTransport:status.surfaceTransport,previewStale:false};
      prototype.setSceneDistributedLightFrame(smokeMode==='distributed'?{texture:gather.smoke,...frame}:null);
      valid=true;for(const old of retiredGathers.splice(0))old.destroy();exteriorLight.retireReplaced?.();finishSettings();status.status='submitted-awaiting-presentation';delete status.error;onStatus({...status});
    } catch(error){finishSettings(error);status.status='preparation-failed';status.error=String(error.message);prototype.setSceneDistributedLightFrame(null);onStatus({...status});throw error;}
  }
  prototype.setSceneMediumSource(null);prototype.setSceneSourceFrameConsumer(prepare);
  const nonnegative=(v)=>{if(!Number.isFinite(v)||v<0)throw new Error('nonnegative finite gain required');return v;};
  function setQuadrature(value,sampling='all'){
    validateSourceQuadrature(value,sampling);
    validateSmoke(smokeShadowSteps,smokeShadowResolution,value);
    if(disposed)throw Error('hybrid lighting disposed');
    // Status observers serialize the entire configuration synchronously.
    // Publish a valid pair before requestRebuild notifies them.
    pointSampling=sampling;paired.value=sampling==='paired';
    evaluatedSources.value=sourceEvaluationCount(value,pointEvaluationBudget,sampling);
    if(value!==pointCount){
      pointCount=value;status.pointCount=value;requestRebuild();
    }
  }
  return {
    setNearBox(value){const next=admitNearSmokeBox({...nearBox,...value},sourceDomain,device.limits,exteriorRefinement);if(disposed)throw Error('hybrid lighting disposed');armSettings();nearBox=next;valid=false;},
    setExteriorReceiverCoverage(value){exteriorLight.setReceiverCoverage(value);armSettings();exteriorReceiverCoverage=value;valid=false;},
    setSourceGrid(value){
      validateSceneSourceGrid(value);if(disposed)throw Error('hybrid lighting disposed');
      if(value===sourceGrid)return;
      if(!prototype.setSceneSourceGrid)throw Error('lighting host does not support emission resolution');
      armSettings();try{prototype.setSceneSourceGrid(value);}catch(error){finishSettings(error);throw error;}sourceGrid=value;status.sourceGrid=value;valid=false;
    },
    setLightGrid(value){
      if(!Number.isSafeInteger(value)||value<1)throw Error('positive integer light grid required');
      volumeGatherPlan({volumeGrid:value,sourceDimensions:sourceDomain.dimensions,directions,smokeRefinement,
        sceneLightCount:collectSceneSmokeLights(scene,sourceTransform).lights.length},device.limits);
      if(value!==volumeGrid){armSettings();volumeGrid=value;status.volumeGrid=value;builtDomain=null;valid=false;}
    },
    setShadowEdgeFilter(value){if(typeof value!=='boolean')throw Error('shadow edge filter must be boolean');shadowEdgeFilter=value;for(const light of lights)light.shadow.setEdgeFilter(value);},
    setSmokeShadowQuality(value){
      const steps=value.steps??smokeShadowSteps,resolution=value.resolution??smokeShadowResolution,mediumResolution=value.mediumResolution??smokeShadowMediumResolution;
      const filter=value.filter??smokeShadowFilter,angleDegrees=value.angleDegrees??smokeShadowFilterAngle,tapsPerAxis=value.tapsPerAxis??smokeShadowFilterTaps;
      if(typeof filter!=='boolean')throw Error('smoke shadow filter must be boolean');
      validateShadowMediumResolution(mediumResolution);validateSmoke(steps,resolution);validateSmokeAngularFilter({angleDegrees,tapsPerAxis});if(disposed)throw Error('hybrid lighting disposed');
      if(steps===smokeShadowSteps&&resolution===smokeShadowResolution&&filter===smokeShadowFilter&&angleDegrees===smokeShadowFilterAngle&&tapsPerAxis===smokeShadowFilterTaps&&mediumResolution===smokeShadowMediumResolution)return;
      if(smokeShadow?.supportsLiveQuality){smokeShadow.setQuality({steps,resolution,filter,angleDegrees,tapsPerAxis,mediumResolution});valid=false;}
      smokeShadowSteps=steps;smokeShadowResolution=resolution;smokeShadowFilter=filter;smokeShadowFilterAngle=angleDegrees;smokeShadowFilterTaps=tapsPerAxis;smokeShadowMediumResolution=mediumResolution;
      if(!smokeShadow?.supportsLiveQuality)requestRebuild();
    },
    setSurfaceEnabled(value){if(typeof value!=='boolean')throw Error('surface lighting enabled must be boolean');if(disposed)throw Error('hybrid lighting disposed');if(surfaceEnabled===value)return;surfaceEnabled=value;surfaceOn.value=value;casterScene.setEnabled(value);if(value)captureSchedule.invalidate();valid=false;onStatus({...status});},
    async setShadowCasterLevel(value){await casterScene.setLevel(value);onStatus({...status});},
    setShadowBudget(patch){return casterScene.setShadowBudget(patch);},
    prepareShadowCasters({flameBox=null}={}){return casterScene.prepareCapture({flameBox});},
    setShadowComparison(value){
      const next=validateShadowComparison({...comparison,...value});
      if(disposed)throw Error('hybrid lighting disposed');
      const rebuild=next.implementation!==comparison.implementation||next.grain!==comparison.grain;
      comparison=next;worldCellSize.value=next.worldCellSize;
      if(rebuild)requestRebuild();
    },
    setSmokeEnvironmentBlur(value){smokeEnvironmentBlur=validateSmokeEnvironmentBlur(value);smokeEnvironment.setBlur(smokeEnvironmentBlur);},
    setGain(value){gain=nonnegative(value);},setSurfaceGain(value){surfaceGain.value=nonnegative(value);},
    setSurfaceScattering(value){if(surfaceScattering!==!!value){armSettings();surfaceScattering=!!value;}},setSourceSoftness(value){const next=validateSourceSoftness(value);if(next!==sourceSoftness){armSettings();sourceSoftness=next;}},
    setSmokeMode(value){if(!['distributed','legacy'].includes(value))throw new Error('unknown smoke mode');smokeMode=value;},
    setDirections(value){volumeGatherPlan({volumeGrid,sourceDimensions:sourceDomain.dimensions,directions:value,smokeRefinement,angularPattern,sceneLightCount:collectSceneSmokeLights(scene,sourceTransform).lights.length},device.limits);if(value===directions)return;armSettings();directions=value;status.directions=value;},
    setAngularPattern(pattern,rotation=0){if(!['fixed','spatial','blue','source','guided','regions','importance'].includes(pattern)||!Number.isFinite(rotation))throw new Error('valid angular pattern required');volumeGatherPlan({volumeGrid,sourceDimensions:sourceDomain.dimensions,directions,smokeRefinement,angularPattern:pattern},device.limits);if(pattern===angularPattern&&rotation===angularRotation)return;armSettings();gather?.setAngularPattern(pattern,rotation);angularPattern=pattern;angularRotation=rotation;},
    setRetainComparisons(value){retainComparisons=!!value;},
    setShadowSoftness(value){if(!Number.isFinite(value)||value<0)throw Error('shadow softness must be finite and nonnegative');for(const light of lights)light.shadow.setSoftness(value);shadowSoftness=value;status.shadowSoftness=value;},
    setShadowSampling(value){validateShadowSampling(value);for(const light of lights)light.shadow.setSampling(value);shadowSampling=value;status.shadowSampling=value;},
    setShadowQuality(value){
      const next=validateShadowQuality({resolution:shadowResolution,blockerSamples,filterSamples,...value},device.limits);
      if(disposed)throw Error('hybrid lighting disposed');
      if(next.resolution===shadowResolution&&next.blockerSamples===blockerSamples&&next.filterSamples===filterSamples)return;
      shadowResolution=next.resolution;blockerSamples=next.blockerSamples;filterSamples=next.filterSamples;
      Object.assign(status,{shadowResolution,blockerSamples,filterSamples});
      if(lights.every(light=>typeof light.shadow.setQuality==='function')){for(const light of lights)light.shadow.setQuality(next);shadowBank?.setResolution(next.resolution);valid=false;}
      else requestRebuild();
    },
    whenRebuilt(){const tasks=[settingsPending?.promise,kernelTask,rebuildTask].filter(Boolean);return tasks.length?Promise.all(tasks):(status.error?Promise.reject(Error(status.error)):Promise.resolve());},
    retryRebuild(){if(disposed)throw Error('hybrid lighting disposed');if(kernelRetry){kernelRetry();return kernelTask;}requestRebuild();return rebuildTask;},
    setShadowCaptureBudget(value){
      validateShadowCaptureBudget(value);if(disposed)throw Error('hybrid lighting disposed');
      shadowCaptureBudget=value;captureSchedule.setBudget(value);
    },
    setQuadrature,setPointCount(value){setQuadrature(value);},setPointSampling(value){setQuadrature(pointCount,value);},
    setPointEvaluationBudget(value){
      validateSourceEvaluationBudget(value);if(disposed)throw Error('hybrid lighting disposed');
      pointEvaluationBudget=value;budgeted.value=value>0;evaluatedSources.value=sourceEvaluationCount(pointCount,value,pointSampling);
    },
    // Host restores these controls for both routes. Record but never pretend
    // they affect point surfaces; the prototype UI marks them inapplicable.
    setReceiverSpacing(value){status.receiverSpacingRequested=value;},setSurfaceReconstruction(value){status.surfaceReconstructionRequested=value;},setEditing(){},
    debugState(){const captures=valid&&surfaceEnabled?frame?.solidShadowCapture:null;return {...status,sourceInput:prototype.sceneVolumeSourceField()?.dimensions??null,shadowBank:shadowBank?.debugState()??{strategy:'individual-cubes',reason:shadowBankFallback},shadowCaptureBudget,nearBox:normalizeNearSmokeBox(nearBox),smokeEnvironmentBlur,angularPattern,angularRotation,shadowEdgeFilter,surfaceEnabled,smokeShadowSteps,smokeShadowResolution,smokeShadowFilter,smokeShadowFilterAngle,smokeShadowFilterTaps,smokeShadowMediumResolution,smokeShadowWork:smokeShadowWork({steps:smokeShadowSteps,resolution:smokeShadowResolution,filter:smokeShadowFilter,angleDegrees:smokeShadowFilterAngle,tapsPerAxis:smokeShadowFilterTaps,count:pointCount}),mediumExtinction:smokeShadowSteps?'radial-prefix-atlas':'omitted',shadowCasterLevel:casterScene.debugState().level,casters:casterScene.debugState(),shadowImplementation:comparison.implementation,shadowGrain:comparison.grain,shadowWorldCellSize:comparison.worldCellSize,pointSampling,pointEvaluationBudget,sourceEvaluationImplementation:pointEvaluationBudget&&selectedEvaluationAvailable?'shared-selected-filter':'per-source-filter',pointSelection:pointEvaluationBudget?'cyclic-complementary':pointSampling,evaluatedPointCount:surfaceEnabled?sourceEvaluationCount(pointCount,pointEvaluationBudget,pointSampling):0,capturedPointCount:captures?.refreshedCount??0,residentShadowCount:captures?.residentCount??0,solidShadowCapture:captures,gain,sourceTransform,sourceSoftness,smokeMode,surfaceScattering,surfaceGain:surfaceGain.value,frame,shadows:lights.map(l=>l.shadow.debugState())};},
    canRender(){const source=prototype.sceneVolumeSourceField();return !disposed&&valid&&source.status==='encoded'&&source.generation===frame?.generation&&source.frame===frame?.frame;},
    canPresent(){const source=prototype.sceneVolumeSourceField();return !disposed&&(!!settingsPending||!!kernelTask||!!kernelRetry||(valid&&source.status==='encoded'&&source.generation===frame?.generation&&source.frame===frame?.frame));},
    readback(options){if(!gather)throw new Error('hybrid not encoded');return gather.readback(options);},
    async readShadowCaptureOrigins(){
      if(!surfaceEnabled||!valid)throw Error('solid shadow sources not current');
      const capture=captureSchedule.read(),transforms=lights.map(light=>light.captureTransform.value.toArray());
      const local=await shadowSources.readback();
      return {capture,sources:local.map((p,i)=>{const t=transforms[i];return {local:p,world:p.slice(0,3).map((v,a)=>v*t[3]+t[a]),transform:t};})};
    },
    readPointRegions(){if(!surfaceEnabled)throw Error('surface lighting disabled');if(!valid)throw Error('hybrid source not current');return points.readback();},
    dispose(){
      valid=false;disposed=true;finishSettings(Error('hybrid lighting disposed'));prototype.setSceneSourceFrameConsumer(null);prototype.setSceneDistributedLightFrame(null);
      const cleanup=()=>{
      releaseProxyAdapter?.();
      for(const [mesh,row] of originals){
        if(mesh.material===row.installed){
          // Preserve edits to the installed material without contaminating an
          // authored material shared by a separately edited mesh.
          const restored=(Array.isArray(row.source)?row.source:[row.source]).map((m,i)=>{
            const copy=m.clone(),type=m.isMeshPhysicalMaterial||m.isMeshPhysicalNodeMaterial?THREE.MeshPhysicalMaterial:THREE.MeshStandardMaterial;
            type.prototype.copy.call(copy,row.owned[i]);return copy;
          });mesh.material=Array.isArray(row.source)?restored:restored[0];
        }
        for(const material of row.owned){surfaceLighting?.unbind(material);material.dispose();}
      }
      originals.clear();releasePoints();gather?.destroy();for(const old of retiredGathers.splice(0))old.destroy();pendingGather?.gather.destroy();exteriorLight.destroy();casterScene.dispose();smokeEnvironment.dispose();
      };
      if(rebuildTask||kernelTask)Promise.allSettled([rebuildTask,kernelTask]).then(cleanup);else {cleanup();rebuild?.hold(false);}
    },
  };
}
