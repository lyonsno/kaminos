import * as THREE from './lib/three.webgpu.js';
import {cloneSceneRadianceMaterial} from './scene-radiance.mjs';
import {createFireLightFieldShadow,renderFireShadowBatch} from './fire-light-field-shadow.mjs';
import {createLocalSceneVisibility} from './scene-local-visibility.mjs';
import {createVolumeGather,lightingDirections} from './scene-volume-gather.mjs';
import {createPointRegions} from './scene-point-regions.mjs';
import {validateSceneSourceTransform,sceneSourceDomain,sceneLightingDomain} from './scene-volume-source.mjs';
import {deriveSourceGuide} from './scene-source-guide.mjs';
import {validateSourceSoftness} from './scene-source-softening.mjs';
import {validateShadowSampling,validateShadowComparison,shadowGrainNode} from './fire-shadow-sampling.mjs';
import {validateSourceQuadrature} from './fire-source-quadrature.mjs';
import {validateShadowQuality} from './fire-shadow-quality.mjs';
import {createShadowFilterPattern} from './fire-shadow-filter.mjs';
import {createFireShadowCasters} from './fire-shadow-casters.mjs';
import {createFireSmokeShadow,smokeShadowPlan} from './fire-smoke-shadow.mjs';
import {createSceneSmokeEnvironment} from './scene-smoke-environment.mjs';
import {collectSceneSmokeLights} from './scene-smoke-lights.mjs';

// Opt-in prototype. Smoke retains distributed transport. Surfaces consume a
// live GPU reduction of that same source, with independent raster visibility.
export function mountDistributedSceneRadiance({renderer,scene,prototype,device,directions=24,volumeGrid=16,smokeRefinement=4,pointCount=4,pointSampling='all',surfaceEnabled=true,smokeShadowSteps=0,smokeShadowResolution=16,smokeShadowFilter=false,shadowEdgeFilter=false,shadowComparison={},shadowResolution=256,shadowSoftness=0,shadowSampling='fixed',blockerSamples=9,filterSamples=16,getSourceGuide=null,onStatus=()=>{},createShadow=createFireLightFieldShadow,rebuild=null,surfaceLighting=null}) {
  if(typeof smokeShadowFilter!=='boolean')throw Error('smoke shadow filter must be boolean');
  if(typeof shadowEdgeFilter!=='boolean')throw Error('shadow edge filter must be boolean');
  if(typeof surfaceEnabled!=='boolean')throw Error('surface lighting enabled must be boolean');
  validateShadowQuality({resolution:shadowResolution,blockerSamples,filterSamples},device.limits);
  if(!Number.isFinite(shadowSoftness)||shadowSoftness<0)throw Error('shadow softness must be finite and nonnegative');
  validateShadowSampling(shadowSampling);
  validateSourceQuadrature(pointCount,pointSampling);
  const validateSmoke=(steps,resolution,count=pointCount)=>{
    if(!Number.isSafeInteger(steps)||steps<0)throw Error('smoke shadow steps must be a nonnegative integer');
    smokeShadowPlan({steps:Math.max(1,steps),resolution,count},device.limits);
  };
  validateSmoke(smokeShadowSteps,smokeShadowResolution);
  const smokeEnvironment=createSceneSmokeEnvironment({renderer,scene,device});
  const {uniform,vec2,vec3,textureLoad,ivec2,positionWorld,normalWorld,screenCoordinate,Fn,If}=THREE.TSL;
  // Deferred surfaces reconstruct their world position per pixel. The default
  // positionWorld is the fullscreen carrier geometry, not the visible surface.
  const receiverPosition=Fn(([],builder)=>builder.context.positionWorld??positionWorld)();
  const translation=uniform(new THREE.Vector3()),scale=uniform(1),surfaceGain=uniform(1);
  const surfaceOn=uniform(surfaceEnabled,'bool');
  const paired=uniform(pointSampling==='paired','bool');
  let comparison=validateShadowComparison(shadowComparison);
  const worldCellSize=uniform(comparison.worldCellSize);
  const casterScene=createFireShadowCasters({scene});
  let points,external,lights,irradiance,prepareSurfaceSampling,smokeShadow;
  let sourceDomain=sceneSourceDomain(),builtDomain=null,sourceRadius=Math.sqrt(11);
  function buildPoints(count){
  const sharedPreparation=comparison.implementation==='shared';
  const filterPattern=sharedPreparation?createShadowFilterPattern(filterSamples,device.limits):{count:filterSamples,bytes:0,route:'arithmetic',reason:'legacy-comparison',node:null};
  const grain=comparison.grain==='ordered'?null:shadowGrainNode(comparison.grain==='world'?receiverPosition.div(worldCellSize):vec3(screenCoordinate.xy,0),THREE.TSL,comparison.grain==='screen-animated'?THREE.TSL.frameId:null);
  points=createPointRegions(device,{count,partition:'spatial'});
  smokeShadow=smokeShadowSteps?createFireSmokeShadow(device,{points:points.texture,count,steps:smokeShadowSteps,resolution:smokeShadowResolution,filter:smokeShadowFilter}):null;
  external=new THREE.ExternalTexture(points.texture);
  external.image={width:count,height:2};external.format=THREE.RGBAFormat;external.type=THREE.FloatType;
  external.colorSpace=THREE.NoColorSpace;external.minFilter=external.magFilter=THREE.NearestFilter;external.generateMipmaps=false;
  lights=Array.from({length:count},(_,i)=>{
    const region=textureLoad(external,ivec2(i,0)),energy=textureLoad(external,ivec2(i,1)).rgb;
    const position=region.xyz.mul(scale).add(translation);
    const filterCoordinates=grain?.coordinates??paired.select(vec2(screenCoordinate.x.div(2).floor(),screenCoordinate.y),screenCoordinate.xy);
    const shadow=createShadow({renderer,scene,sourceNode:position,receiverNode:receiverPosition,normalNode:normalWorld,requested:true,resolution:shadowResolution,sourceRadius:()=>translation.value.length()+scale.value*sourceRadius,sourceSizeNode:region.w.max(0).sqrt().mul(scale),shadowSoftness,shadowSampling,shadowEdgeFilter,filterCoordinates,screenAligned:comparison.grain!=='world',sharedPreparation,blockerSamples,filterSamples,filterPattern});
    // Source coefficients use volume-local lengths. Express distance there;
    // scaling the object should not silently scale its radiometric brightness.
    const delta=position.sub(receiverPosition).div(scale),distance2=delta.dot(delta);
    const direction=delta.div(distance2.sqrt().max(1e-6));
    const medium=smokeShadow?smokeShadow.visibility(region.xyz,receiverPosition.sub(translation).div(scale),i):THREE.TSL.float(1);
    return {shadow,irradiance:energy.div(distance2.add(region.w)).mul(normalWorld.dot(direction).max(0)).mul(shadow.visibility).mul(medium)};
  });
  const currentLights=lights;
  prepareSurfaceSampling=()=>{
    grain?.bits.toStack();
    // Derivatives must be evaluated in uniform flow, before source selection.
    for(const light of currentLights)light.shadow.prepareSampling?.();
  };
  irradiance=Fn(()=>{
    prepareSurfaceSampling();
    const sum=vec3(0).toVar();
    const add=indices=>{for(const i of indices)sum.addAssign(currentLights[i].irradiance.mul(2));};
    If(surfaceOn,()=>{if(count===4)If(paired,()=>{
      If(grain?.firstPair??screenCoordinate.x.floor().add(screenCoordinate.y.floor()).mod(2).lessThan(1),()=>add([0,2])).Else(()=>add([1,3]));
    }).Else(()=>{for(const light of currentLights)sum.addAssign(light.irradiance);});
    else for(const light of currentLights)sum.addAssign(light.irradiance);});
    return sum.mul(surfaceGain);
  })();
  }
  function releasePoints(){for(const light of lights)light.shadow.dispose();smokeShadow?.dispose(renderer);delete renderer.backend.get(external).texture;external.dispose();points.destroy();}
  buildPoints(pointCount);
  const originals=new Map(),localVisibility=createLocalSceneVisibility();let gather=null,geometryRevision=null,frame=null,disposed=false,valid=false;
  let gain=1,sourceSoftness=0,surfaceScattering=false,smokeMode='distributed',angularPattern='fixed',angularRotation=0,retainComparisons=false;
  let sourceTransform=validateSceneSourceTransform();
  const status={identity:'hybrid-distributed-smoke-point-surfaces-v0',status:'awaiting-source',surfaceTransport:'gpu-point-regions',surfaceReceivers:0,pointCount,shadowResolution,shadowSoftness,shadowSampling,blockerSamples,filterSamples,maxShadowResolution:device.limits.maxTextureDimension2D,volumeGrid,directions,
    geometryBuilds:0,visibilityBuilds:0,previewStale:false,receiverSpacingRequested:0,surfaceReconstructionRequested:0,
    limitations:['point-region-surface-approximation','center-cube-area-shadow-approximation','GPU-smoke-visibility-refresh-on-transform','CPU-local-BVH-rebuild-on-vertex-or-topology-edit','no-surface-bounce']};
  let rebuildRevision=0,rebuildTask=null,rebuilding=false;
  function replaceLighting(){
    releasePoints();buildPoints(pointCount);installAllMaterials();
    for(const row of originals.values())for(const material of row.owned){surfaceLighting?.bind(material,irradiance,prepareSurfaceSampling);material.needsUpdate=true;}
  }
  function requestRebuild(){
    rebuildRevision++;
    if(!rebuild){valid=false;replaceLighting();status.status='awaiting-source';return;}
    status.status='compiling-lighting';delete status.error;onStatus({...status});
    if(rebuildTask)return;
    const quiescent=rebuild.hold(true);
    rebuildTask=Promise.resolve().then(async()=>{
      await quiescent;
      rebuilding=true;valid=false;
      let compiled;
      do {
        if(disposed)return;
        compiled=rebuildRevision;replaceLighting();
        await rebuild.compile();
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
        const cacheKey=material.customProgramCacheKey;
        // This injected graph is not one of NodeMaterial's enumerated node
        // properties. A version bump alone can reuse its old texture bindings.
        material.customProgramCacheKey=function(){return `${cacheKey.call(this)}:hybrid:${irradiance.uuid}`;};
        surfaceLighting?.bind(material,irradiance,prepareSurfaceSampling);
        material.setupMaterialLightings=function(builder){return [...setup.call(this,builder),new THREE.IrradianceNode(surfaceLighting?.forMaterial(builder,this,irradiance)??irradiance)];};return material;
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
  function prepare(field){
    if(disposed)throw new Error('hybrid lighting disposed');valid=false;
    if(rebuilding||status.status==='lighting-compile-failed')throw Error(status.error??'lighting compilation pending');
    try {
      sourceTransform=validateSceneSourceTransform(field.source.worldTransform);
      sourceDomain=sceneLightingDomain(field.source);
      const domainKey=JSON.stringify(sourceDomain.hi);
      sourceRadius=Math.hypot(...sourceDomain.hi.map((x,a)=>Math.max(Math.abs(x),Math.abs(sourceDomain.lo[a]))));
      translation.value.set(...sourceTransform.translate);scale.value=sourceTransform.scale;
      installAllMaterials();
      const started=performance.now(),snapshot=localVisibility.snapshot(scene),{revision,geometry:packed}=snapshot;
      status.localBvhBuilds=snapshot.localBuilds;status.visibilityMeshes=snapshot.meshCount;
      if(!gather||revision!==geometryRevision||domainKey!==builtDomain){
        status.status='building-smoke-world-visibility';onStatus({...status});
        const next=createVolumeGather(device,{geometry:packed,receivers:[],volumeGrid,sourceDimensions:sourceDomain.dimensions,smokeRefinement,directions,angularPattern,angularRotation,worldGeometry:true});
        prototype.setSceneDistributedLightFrame(null);gather?.destroy();gather=next;geometryRevision=revision;builtDomain=domainKey;
        status.geometryBuilds++;status.visibilityBuilds++;status.lastGeometryBuildMs=performance.now()-started;status.staticTriangles=packed.triangleCount;
      }
      gather.setGeometryTransforms(packed.matrices);
      gather.setDirections(directions);gather.setAngularPattern(angularPattern,angularRotation);gather.setRetainComparisons(retainComparisons);
      if(angularPattern==='guided'){
        if(!getSourceGuide)throw new Error('hybrid guided smoke requires authored source guide');
        gather.setSourceGuide(deriveSourceGuide(getSourceGuide(),sourceTransform,sourceDomain));
      }
      // Even legacy smoke display may request scattered contribution to the
      // surface points; the gather owns that once-scattered source and gain.
      const environment=smokeMode==='distributed'||surfaceScattering?smokeEnvironment.frame():null;
      const sceneLights=collectSceneSmokeLights(scene,sourceTransform);
      frame=gather.encode(field.source,{gain,sourceSoftness,surfaceScattering,smokeEnabled:smokeMode==='distributed',environment,sceneLights});
      const reduction=surfaceEnabled?points.encode(gather.transportSource()):null;
      const medium=surfaceEnabled&&smokeShadow?smokeShadow.encode(field.source,reduction):null;
      if(surfaceEnabled){
        if(comparison.implementation==='shared')renderFireShadowBatch({scene,shadows:lights.map(light=>light.shadow),casterScene});
        else casterScene.withCapture(()=>{for(const light of lights)light.shadow.render();});
      }
      frame={...frame,pointRegions:reduction,smokeShadow:medium,surfaceTransport:status.surfaceTransport,previewStale:false};
      prototype.setSceneDistributedLightFrame(smokeMode==='distributed'?{texture:gather.smoke,...frame}:null);
      valid=true;status.status='submitted-awaiting-presentation';delete status.error;onStatus({...status});
    } catch(error){status.status='preparation-failed';status.error=String(error.message);prototype.setSceneDistributedLightFrame(null);onStatus({...status});throw error;}
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
    if(value!==pointCount){
      pointCount=value;status.pointCount=value;requestRebuild();
    }
  }
  return {
    setShadowEdgeFilter(value){if(typeof value!=='boolean')throw Error('shadow edge filter must be boolean');shadowEdgeFilter=value;for(const light of lights)light.shadow.setEdgeFilter(value);},
    setSmokeShadowQuality(value){
      const steps=value.steps??smokeShadowSteps,resolution=value.resolution??smokeShadowResolution;
      const filter=value.filter??smokeShadowFilter;
      if(typeof filter!=='boolean')throw Error('smoke shadow filter must be boolean');
      validateSmoke(steps,resolution);if(disposed)throw Error('hybrid lighting disposed');
      if(steps===smokeShadowSteps&&resolution===smokeShadowResolution&&filter===smokeShadowFilter)return;
      smokeShadowSteps=steps;smokeShadowResolution=resolution;smokeShadowFilter=filter;requestRebuild();
    },
    setSurfaceEnabled(value){if(typeof value!=='boolean')throw Error('surface lighting enabled must be boolean');if(disposed)throw Error('hybrid lighting disposed');if(surfaceEnabled===value)return;surfaceEnabled=value;surfaceOn.value=value;valid=false;onStatus({...status});},
    async setShadowCasterLevel(value){await casterScene.setLevel(value);onStatus({...status});},
    setShadowComparison(value){
      const next=validateShadowComparison({...comparison,...value});
      if(disposed)throw Error('hybrid lighting disposed');
      const rebuild=next.implementation!==comparison.implementation||next.grain!==comparison.grain;
      comparison=next;worldCellSize.value=next.worldCellSize;
      if(rebuild)requestRebuild();
    },
    setGain(value){gain=nonnegative(value);},setSurfaceGain(value){surfaceGain.value=nonnegative(value);},
    setSurfaceScattering(value){surfaceScattering=!!value;},setSourceSoftness(value){sourceSoftness=validateSourceSoftness(value);},
    setSmokeMode(value){if(!['distributed','legacy'].includes(value))throw new Error('unknown smoke mode');smokeMode=value;},
    setDirections(value){lightingDirections(value);directions=value;status.directions=value;},
    setAngularPattern(pattern,rotation=0){if(!['fixed','spatial','source','guided'].includes(pattern)||!Number.isFinite(rotation))throw new Error('valid angular pattern required');angularPattern=pattern;angularRotation=rotation;},
    setRetainComparisons(value){retainComparisons=!!value;},
    setShadowSoftness(value){if(!Number.isFinite(value)||value<0)throw Error('shadow softness must be finite and nonnegative');for(const light of lights)light.shadow.setSoftness(value);shadowSoftness=value;status.shadowSoftness=value;},
    setShadowSampling(value){validateShadowSampling(value);for(const light of lights)light.shadow.setSampling(value);shadowSampling=value;status.shadowSampling=value;},
    setShadowQuality(value){
      const next=validateShadowQuality({resolution:shadowResolution,blockerSamples,filterSamples,...value},device.limits);
      if(disposed)throw Error('hybrid lighting disposed');
      if(next.resolution===shadowResolution&&next.blockerSamples===blockerSamples&&next.filterSamples===filterSamples)return;
      shadowResolution=next.resolution;blockerSamples=next.blockerSamples;filterSamples=next.filterSamples;
      Object.assign(status,{shadowResolution,blockerSamples,filterSamples});requestRebuild();
    },
    whenRebuilt(){return rebuildTask??(status.error?Promise.reject(Error(status.error)):Promise.resolve());},
    retryRebuild(){if(disposed)throw Error('hybrid lighting disposed');requestRebuild();return rebuildTask;},
    setQuadrature,setPointCount(value){setQuadrature(value);},setPointSampling(value){setQuadrature(pointCount,value);},
    // Host restores these controls for both routes. Record but never pretend
    // they affect point surfaces; the prototype UI marks them inapplicable.
    setReceiverSpacing(value){status.receiverSpacingRequested=value;},setSurfaceReconstruction(value){status.surfaceReconstructionRequested=value;},setEditing(){},
    debugState(){return {...status,shadowEdgeFilter,surfaceEnabled,smokeShadowSteps,smokeShadowResolution,smokeShadowFilter,mediumExtinction:smokeShadowSteps?'radial-prefix-atlas':'omitted',shadowCasterLevel:casterScene.debugState().level,casters:casterScene.debugState(),shadowImplementation:comparison.implementation,shadowGrain:comparison.grain,shadowWorldCellSize:comparison.worldCellSize,pointSampling,evaluatedPointCount:surfaceEnabled?(pointSampling==='paired'?2:pointCount):0,capturedPointCount:surfaceEnabled?pointCount:0,gain,sourceTransform,sourceSoftness,smokeMode,surfaceScattering,surfaceGain:surfaceGain.value,frame,shadows:lights.map(l=>l.shadow.debugState())};},
    canRender(){const source=prototype.sceneVolumeSourceField();return !disposed&&valid&&source.status==='encoded'&&source.generation===frame?.generation&&source.frame===frame?.frame;},
    readback(){if(!gather)throw new Error('hybrid not encoded');return gather.readback();},
    readPointRegions(){if(!surfaceEnabled)throw Error('surface lighting disabled');if(!valid)throw Error('hybrid source not current');return points.readback();},
    dispose(){
      valid=false;disposed=true;prototype.setSceneSourceFrameConsumer(null);prototype.setSceneDistributedLightFrame(null);
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
      originals.clear();releasePoints();gather?.destroy();casterScene.dispose();smokeEnvironment.dispose();
      };
      if(rebuildTask)rebuildTask.then(cleanup,cleanup);else {cleanup();rebuild?.hold(false);}
    },
  };
}
