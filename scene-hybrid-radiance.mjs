import * as THREE from './lib/three.webgpu.js';
import {cloneSceneRadianceMaterial} from './scene-radiance.mjs';
import {createFireLightFieldShadow,renderFireShadowBatch} from './fire-light-field-shadow.mjs';
import {createLocalSceneVisibility} from './scene-local-visibility.mjs';
import {createVolumeGather,lightingDirections} from './scene-volume-gather.mjs';
import {createPointRegions} from './scene-point-regions.mjs';
import {validateSceneSourceTransform} from './scene-volume-source.mjs';
import {deriveSourceGuide} from './scene-source-guide.mjs';
import {validateSourceSoftness} from './scene-source-softening.mjs';
import {validateShadowSampling,validateShadowComparison,shadowGrainNode} from './fire-shadow-sampling.mjs';
import {validateSourceQuadrature} from './fire-source-quadrature.mjs';
import {validateShadowQuality} from './fire-shadow-quality.mjs';
import {createShadowFilterPattern} from './fire-shadow-filter.mjs';

// Opt-in prototype. Smoke retains distributed transport. Surfaces consume a
// live GPU reduction of that same source, with independent raster visibility.
export function mountDistributedSceneRadiance({renderer,scene,prototype,device,directions=24,volumeGrid=16,smokeRefinement=4,pointCount=4,pointSampling='all',shadowComparison={},shadowResolution=256,shadowSoftness=0,shadowSampling='fixed',blockerSamples=9,filterSamples=16,getSourceGuide=null,onStatus=()=>{},createShadow=createFireLightFieldShadow,rebuild=null}) {
  validateShadowQuality({resolution:shadowResolution,blockerSamples,filterSamples},device.limits);
  if(!Number.isFinite(shadowSoftness)||shadowSoftness<0)throw Error('shadow softness must be finite and nonnegative');
  validateShadowSampling(shadowSampling);
  validateSourceQuadrature(pointCount,pointSampling);
  const {uniform,vec2,vec3,textureLoad,ivec2,positionWorld,normalWorld,screenCoordinate,Fn,If}=THREE.TSL;
  const translation=uniform(new THREE.Vector3()),scale=uniform(1),surfaceGain=uniform(1);
  const paired=uniform(pointSampling==='paired','bool');
  let comparison=validateShadowComparison(shadowComparison);
  const worldCellSize=uniform(comparison.worldCellSize);
  let points,external,lights,irradiance,fineSourceRadius=Math.sqrt(11);
  function buildPoints(count){
  const sharedPreparation=comparison.implementation==='shared';
  const filterPattern=sharedPreparation?createShadowFilterPattern(filterSamples,device.limits):{count:filterSamples,bytes:0,route:'arithmetic',reason:'legacy-comparison',node:null};
  const grain=comparison.grain==='ordered'?null:shadowGrainNode(comparison.grain==='world'?positionWorld.div(worldCellSize):vec3(screenCoordinate.xy,0),THREE.TSL);
  points=createPointRegions(device,{count,partition:count>1?'energy':'vertical'});
  external=new THREE.ExternalTexture(points.texture);
  external.image={width:count,height:2};external.format=THREE.RGBAFormat;external.type=THREE.FloatType;
  external.colorSpace=THREE.NoColorSpace;external.minFilter=external.magFilter=THREE.NearestFilter;external.generateMipmaps=false;
  lights=Array.from({length:count},(_,i)=>{
    const region=textureLoad(external,ivec2(i,0)),energy=textureLoad(external,ivec2(i,1)).rgb;
    const position=region.xyz.mul(scale).add(translation);
    const filterCoordinates=grain?.coordinates??paired.select(vec2(screenCoordinate.x.div(2).floor(),screenCoordinate.y),screenCoordinate.xy);
    const shadow=createShadow({renderer,scene,sourceNode:position,receiverNode:positionWorld,normalNode:normalWorld,requested:true,resolution:shadowResolution,sourceRadius:()=>translation.value.length()+scale.value*fineSourceRadius,sourceSizeNode:region.w.max(0).sqrt().mul(scale),shadowSoftness,shadowSampling,filterCoordinates,screenAligned:comparison.grain!=='world',sharedPreparation,blockerSamples,filterSamples,filterPattern});
    // Source coefficients use volume-local lengths. Express distance there;
    // scaling the object should not silently scale its radiometric brightness.
    const delta=position.sub(positionWorld).div(scale),distance2=delta.dot(delta);
    const direction=delta.div(distance2.sqrt().max(1e-6));
    return {shadow,irradiance:energy.div(distance2.add(region.w)).mul(normalWorld.dot(direction).max(0)).mul(shadow.visibility)};
  });
  const currentLights=lights;
  irradiance=Fn(()=>{
    grain?.bits.toStack();
    // Derivatives must be evaluated in uniform flow, before source selection.
    for(const light of currentLights)light.shadow.prepareSampling?.();
    const sum=vec3(0).toVar();
    const add=indices=>{for(const i of indices)sum.addAssign(currentLights[i].irradiance.mul(2));};
    if(count===4)If(paired,()=>{
      If(grain?.firstPair??screenCoordinate.x.floor().add(screenCoordinate.y.floor()).mod(2).lessThan(1),()=>add([0,2])).Else(()=>add([1,3]));
    }).Else(()=>{for(const light of currentLights)sum.addAssign(light.irradiance);});
    else for(const light of currentLights)sum.addAssign(light.irradiance);
    return sum.mul(surfaceGain);
  })();
  }
  function releasePoints(){for(const light of lights)light.shadow.dispose();delete renderer.backend.get(external).texture;external.dispose();points.destroy();}
  buildPoints(pointCount);
  const originals=new Map(),localVisibility=createLocalSceneVisibility();let gather=null,exteriorGather=null,domainKey=null,geometryRevision=null,frame=null,disposed=false,valid=false;
  let gain=1,sourceSoftness=0,surfaceScattering=false,smokeMode='distributed',angularPattern='fixed',angularRotation=0,retainComparisons=false;
  let sourceTransform=validateSceneSourceTransform();
  const status={identity:'hybrid-distributed-smoke-point-surfaces-v0',status:'awaiting-source',surfaceTransport:'gpu-point-regions',surfaceReceivers:0,pointCount,shadowResolution,shadowSoftness,shadowSampling,blockerSamples,filterSamples,maxShadowResolution:device.limits.maxTextureDimension2D,volumeGrid,directions,
    geometryBuilds:0,visibilityBuilds:0,previewStale:false,receiverSpacingRequested:0,surfaceReconstructionRequested:0,
    limitations:['point-region-surface-approximation','point-surfaces-omit-medium-extinction','center-cube-area-shadow-approximation','GPU-smoke-visibility-refresh-on-transform','CPU-local-BVH-rebuild-on-vertex-or-topology-edit','no-surface-bounce']};
  let rebuildRevision=0,rebuildTask=null,rebuilding=false;
  function replaceLighting(){
    releasePoints();buildPoints(pointCount);installMaterials();
    for(const row of originals.values())for(const material of row.owned)material.needsUpdate=true;
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
  function installMaterials(){
    scene.traverseVisible(mesh=>{
      if(!mesh.isMesh)return;
      const prior=originals.get(mesh);if(prior&&mesh.material===prior.installed)return;
      if(prior){for(const m of prior.owned)m.dispose();originals.delete(mesh);}
      const source=mesh.material,list=Array.isArray(source)?source:[source];
      if(!list.every(m=>m.isMeshStandardMaterial||m.isMeshStandardNodeMaterial||m.isMeshPhysicalMaterial||m.isMeshPhysicalNodeMaterial))return;
      const owned=list.map(original=>{
        const material=cloneSceneRadianceMaterial(renderer.library,original),setup=material.setupMaterialLightings;
        const cacheKey=material.customProgramCacheKey;
        // This injected graph is not one of NodeMaterial's enumerated node
        // properties. A version bump alone can reuse its old texture bindings.
        material.customProgramCacheKey=function(){return `${cacheKey.call(this)}:hybrid:${irradiance.uuid}`;};
        material.setupMaterialLightings=function(builder){return [...setup.call(this,builder),new THREE.IrradianceNode(irradiance)];};return material;
      });
      const installed=Array.isArray(source)?owned:owned[0];originals.set(mesh,{source,installed,owned});mesh.material=installed;
    });
  }
  function prepare(field){
    if(disposed)throw new Error('hybrid lighting disposed');valid=false;
    if(rebuilding||status.status==='lighting-compile-failed')throw Error(status.error??'lighting compilation pending');
    try {
      sourceTransform=validateSceneSourceTransform(field.source.worldTransform);
      translation.value.set(...sourceTransform.translate);scale.value=sourceTransform.scale;
      installMaterials();
      const started=performance.now(),snapshot=localVisibility.snapshot(scene),{revision,geometry:packed}=snapshot;
      const fineDomain={lo:field.source.localMin??[-1,-1,-1],hi:field.source.localMax};
      const ext=field.source.exterior,exteriorDomain=ext?{lo:ext.localMin,hi:ext.localMax}:null;
      const nextDomainKey=JSON.stringify([fineDomain,exteriorDomain]);
      status.localBvhBuilds=snapshot.localBuilds;status.visibilityMeshes=snapshot.meshCount;
      if(!gather||revision!==geometryRevision||nextDomainKey!==domainKey){
        status.status='building-smoke-world-visibility';onStatus({...status});
        const options={geometry:packed,receivers:[],volumeGrid,smokeRefinement,directions,angularPattern,angularRotation,worldGeometry:true,fineDomain,exteriorDomain};
        const fineDims=[volumeGrid,Math.round(volumeGrid*(fineDomain.hi[1]-fineDomain.lo[1])/(fineDomain.hi[0]-fineDomain.lo[0])),volumeGrid];
        const next=createVolumeGather(device,{...options,volumeDimensions:fineDims});
        let nextExterior=null;
        try{if(ext)nextExterior=createVolumeGather(device,{...options,receiverDomain:exteriorDomain,volumeDimensions:fineDims});}
        catch(error){next.destroy();throw error;}
        prototype.setSceneDistributedLightFrame(null);gather?.destroy();exteriorGather?.destroy();gather=next;exteriorGather=nextExterior;geometryRevision=revision;domainKey=nextDomainKey;
        status.geometryBuilds++;status.visibilityBuilds++;status.lastGeometryBuildMs=performance.now()-started;status.staticTriangles=packed.triangleCount;
      }
      gather.setGeometryTransforms(packed.matrices);
      gather.setDirections(directions);gather.setAngularPattern(angularPattern,angularRotation);gather.setRetainComparisons(retainComparisons);
      exteriorGather?.setGeometryTransforms(packed.matrices);
      exteriorGather?.setDirections(directions);exteriorGather?.setAngularPattern(angularPattern,angularRotation);exteriorGather?.setRetainComparisons(retainComparisons);
      if(angularPattern==='guided'){
        if(!getSourceGuide)throw new Error('hybrid guided smoke requires authored source guide');
        const guide=deriveSourceGuide(getSourceGuide(),sourceTransform);
        // The fine emitter envelope remains the focused proposal; the uniform
        // component spans the whole joined source and accounts for its PDF.
        guide.lo=guide.lo.map((v,a)=>Math.max(v,fineDomain.lo[a]));guide.hi=guide.hi.map((v,a)=>Math.min(v,fineDomain.hi[a]));
        if(guide.lo.some((v,a)=>v>=guide.hi[a]))Object.assign(guide,fineDomain);
        gather.setSourceGuide(guide);exteriorGather?.setSourceGuide(guide);
      }
      // Even legacy smoke display may request scattered contribution to the
      // surface points; the gather owns that once-scattered source and gain.
      frame=gather.encode(field.source,{gain,sourceSoftness,surfaceScattering,smokeEnabled:smokeMode==='distributed'});
      const exteriorFrame=exteriorGather&&smokeMode==='distributed'?exteriorGather.encode(field.source,{gain,sourceSoftness,smokeEnabled:true}):null;
      const reduction=points.encode(gather.transportSource());
      fineSourceRadius=Math.hypot(...fineDomain.lo.map((v,a)=>Math.max(Math.abs(v),Math.abs(fineDomain.hi[a]))));
      if(comparison.implementation==='shared')renderFireShadowBatch({scene,shadows:lights.map(light=>light.shadow)});
      else for(const light of lights)light.shadow.render();
      frame={...frame,exteriorSmokeReconstruction:exteriorFrame?.smokeReconstruction??null,exteriorSourceGeneration:exteriorFrame?ext.generation:null,
        exteriorVolumeReceivers:exteriorFrame?.volumeReceivers??0,pointRegions:reduction,surfaceTransport:status.surfaceTransport,previewStale:false};
      prototype.setSceneDistributedLightFrame(smokeMode==='distributed'?{texture:gather.smoke,...frame}:null);
      valid=true;status.status='submitted-awaiting-presentation';delete status.error;onStatus({...status});
    } catch(error){status.status='preparation-failed';status.error=String(error.message);prototype.setSceneDistributedLightFrame(null);onStatus({...status});throw error;}
  }
  prototype.setSceneMediumSource(null);prototype.setSceneSourceFrameConsumer(prepare);
  const nonnegative=(v)=>{if(!Number.isFinite(v)||v<0)throw new Error('nonnegative finite gain required');return v;};
  function setQuadrature(value,sampling='all'){
    validateSourceQuadrature(value,sampling);
    if(disposed)throw Error('hybrid lighting disposed');
    // Status observers serialize the entire configuration synchronously.
    // Publish a valid pair before requestRebuild notifies them.
    pointSampling=sampling;paired.value=sampling==='paired';
    if(value!==pointCount){
      pointCount=value;status.pointCount=value;requestRebuild();
    }
  }
  return {
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
    debugState(){return {...status,shadowImplementation:comparison.implementation,shadowGrain:comparison.grain,shadowWorldCellSize:comparison.worldCellSize,pointSampling,evaluatedPointCount:pointSampling==='paired'?2:pointCount,capturedPointCount:pointCount,gain,sourceTransform,sourceSoftness,smokeMode,surfaceScattering,surfaceGain:surfaceGain.value,frame,shadows:lights.map(l=>l.shadow.debugState())};},
    canRender(){const source=prototype.sceneVolumeSourceField();return !disposed&&valid&&source.status==='encoded'&&source.generation===frame?.generation&&source.frame===frame?.frame;},
    readback(){if(!gather)throw new Error('hybrid not encoded');return gather.readback();},
    readPointRegions(){if(!valid)throw Error('hybrid source not current');return points.readback();},
    dispose(){
      valid=false;disposed=true;prototype.setSceneSourceFrameConsumer(null);prototype.setSceneDistributedLightFrame(null);
      const cleanup=()=>{
      for(const [mesh,row] of originals){
        if(mesh.material===row.installed){
          // Preserve edits to the installed material without contaminating an
          // authored material shared by a separately edited mesh.
          const restored=(Array.isArray(row.source)?row.source:[row.source]).map((m,i)=>{
            const copy=m.clone(),type=m.isMeshPhysicalMaterial||m.isMeshPhysicalNodeMaterial?THREE.MeshPhysicalMaterial:THREE.MeshStandardMaterial;
            type.prototype.copy.call(copy,row.owned[i]);return copy;
          });mesh.material=Array.isArray(row.source)?restored:restored[0];
        }
        for(const material of row.owned)material.dispose();
      }
      originals.clear();releasePoints();gather?.destroy();exteriorGather?.destroy();
      };
      if(rebuildTask)rebuildTask.then(cleanup,cleanup);else {cleanup();rebuild?.hold(false);}
    },
  };
}
