import * as THREE from './lib/three.webgpu.js';
import {cloneSceneRadianceMaterial} from './scene-radiance.mjs';
import {createFireLightFieldShadow,renderFireShadowBatch} from './fire-light-field-shadow.mjs';
import {createLocalSceneVisibility} from './scene-local-visibility.mjs';
import {createVolumeGather,lightingDirections} from './scene-volume-gather.mjs';
import {createPointRegions} from './scene-point-regions.mjs';
import {validateSceneSourceTransform} from './scene-volume-source.mjs';
import {deriveSourceGuide} from './scene-source-guide.mjs';
import {validateSourceSoftness} from './scene-source-softening.mjs';
import {validateShadowSampling} from './fire-shadow-sampling.mjs';
import {validateSourceQuadrature} from './fire-source-quadrature.mjs';
import {validateShadowQuality} from './fire-shadow-quality.mjs';
import {createShadowFilterPattern} from './fire-shadow-filter.mjs';

// Opt-in prototype. Smoke retains distributed transport. Surfaces consume a
// live GPU reduction of that same source, with independent raster visibility.
export function mountDistributedSceneRadiance({renderer,scene,prototype,device,directions=24,volumeGrid=16,smokeRefinement=4,pointCount=4,shadowResolution=256,shadowSoftness=0,shadowSampling='fixed',blockerSamples=9,filterSamples=16,getSourceGuide=null,onStatus=()=>{},createShadow=createFireLightFieldShadow}) {
  validateShadowQuality({resolution:shadowResolution,blockerSamples,filterSamples},device.limits);
  if(!Number.isFinite(shadowSoftness)||shadowSoftness<0)throw Error('shadow softness must be finite and nonnegative');
  validateShadowSampling(shadowSampling);
  validateSourceQuadrature(pointCount);
  const {uniform,vec2,vec3,textureLoad,ivec2,positionWorld,normalWorld,screenCoordinate,Fn,If}=THREE.TSL;
  const translation=uniform(new THREE.Vector3()),scale=uniform(1),surfaceGain=uniform(1);
  const paired=uniform(false,'bool');let pointSampling='all';
  let points,external,lights,irradiance;
  function buildPoints(count){
  const filterPattern=createShadowFilterPattern(filterSamples,device.limits);
  points=createPointRegions(device,{count,partition:count>1?'energy':'vertical'});
  external=new THREE.ExternalTexture(points.texture);
  external.image={width:count,height:2};external.format=THREE.RGBAFormat;external.type=THREE.FloatType;
  external.colorSpace=THREE.NoColorSpace;external.minFilter=external.magFilter=THREE.NearestFilter;external.generateMipmaps=false;
  lights=Array.from({length:count},(_,i)=>{
    const region=textureLoad(external,ivec2(i,0)),energy=textureLoad(external,ivec2(i,1)).rgb;
    const position=region.xyz.mul(scale).add(translation);
    const filterCoordinates=paired.select(vec2(screenCoordinate.x.div(2).floor(),screenCoordinate.y),screenCoordinate.xy);
    const shadow=createShadow({renderer,scene,sourceNode:position,receiverNode:positionWorld,normalNode:normalWorld,requested:true,resolution:shadowResolution,sourceRadius:()=>translation.value.length()+scale.value*Math.sqrt(11),sourceSizeNode:region.w.max(0).sqrt().mul(scale),shadowSoftness,shadowSampling,filterCoordinates,blockerSamples,filterSamples,filterPattern});
    // Source coefficients use volume-local lengths. Express distance there;
    // scaling the object should not silently scale its radiometric brightness.
    const delta=position.sub(positionWorld).div(scale),distance2=delta.dot(delta);
    const direction=delta.div(distance2.sqrt().max(1e-6));
    return {shadow,irradiance:energy.div(distance2.add(region.w)).mul(normalWorld.dot(direction).max(0)).mul(shadow.visibility)};
  });
  const currentLights=lights;
  irradiance=Fn(()=>{
    // Derivatives must be evaluated in uniform flow, before source selection.
    for(const light of currentLights)light.shadow.prepareSampling?.();
    const sum=vec3(0).toVar();
    const add=indices=>{for(const i of indices)sum.addAssign(currentLights[i].irradiance.mul(2));};
    if(count===4)If(paired,()=>{
      If(screenCoordinate.x.floor().add(screenCoordinate.y.floor()).mod(2).lessThan(1),()=>add([0,2])).Else(()=>add([1,3]));
    }).Else(()=>{for(const light of currentLights)sum.addAssign(light.irradiance);});
    else for(const light of currentLights)sum.addAssign(light.irradiance);
    return sum.mul(surfaceGain);
  })();
  }
  function releasePoints(){for(const light of lights)light.shadow.dispose();delete renderer.backend.get(external).texture;external.dispose();points.destroy();}
  buildPoints(pointCount);
  const originals=new Map(),localVisibility=createLocalSceneVisibility();let gather=null,geometryRevision=null,frame=null,disposed=false,valid=false;
  let gain=1,sourceSoftness=0,surfaceScattering=false,smokeMode='distributed',angularPattern='fixed',angularRotation=0,retainComparisons=false;
  let sourceTransform=validateSceneSourceTransform();
  const status={identity:'hybrid-distributed-smoke-point-surfaces-v0',status:'awaiting-source',surfaceTransport:'gpu-point-regions',surfaceReceivers:0,pointCount,shadowResolution,shadowSoftness,shadowSampling,blockerSamples,filterSamples,maxShadowResolution:device.limits.maxTextureDimension2D,volumeGrid,directions,
    geometryBuilds:0,visibilityBuilds:0,previewStale:false,receiverSpacingRequested:0,surfaceReconstructionRequested:0,
    limitations:['point-region-surface-approximation','point-surfaces-omit-medium-extinction','center-cube-area-shadow-approximation','GPU-smoke-visibility-refresh-on-transform','CPU-local-BVH-rebuild-on-vertex-or-topology-edit','no-surface-bounce']};
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
    try {
      sourceTransform=validateSceneSourceTransform(field.source.worldTransform);
      translation.value.set(...sourceTransform.translate);scale.value=sourceTransform.scale;
      installMaterials();
      const started=performance.now(),snapshot=localVisibility.snapshot(scene),{revision,geometry:packed}=snapshot;
      status.localBvhBuilds=snapshot.localBuilds;status.visibilityMeshes=snapshot.meshCount;
      if(!gather||revision!==geometryRevision){
        status.status='building-smoke-world-visibility';onStatus({...status});
        const next=createVolumeGather(device,{geometry:packed,receivers:[],volumeGrid,smokeRefinement,directions,angularPattern,angularRotation,worldGeometry:true});
        prototype.setSceneDistributedLightFrame(null);gather?.destroy();gather=next;geometryRevision=revision;
        status.geometryBuilds++;status.visibilityBuilds++;status.lastGeometryBuildMs=performance.now()-started;status.staticTriangles=packed.triangleCount;
      }
      gather.setGeometryTransforms(packed.matrices);
      gather.setDirections(directions);gather.setAngularPattern(angularPattern,angularRotation);gather.setRetainComparisons(retainComparisons);
      if(angularPattern==='guided'){
        if(!getSourceGuide)throw new Error('hybrid guided smoke requires authored source guide');
        gather.setSourceGuide(deriveSourceGuide(getSourceGuide(),sourceTransform));
      }
      // Even legacy smoke display may request scattered contribution to the
      // surface points; the gather owns that once-scattered source and gain.
      frame=gather.encode(field.source,{gain,sourceSoftness,surfaceScattering,smokeEnabled:smokeMode==='distributed'});
      const reduction=points.encode(gather.transportSource());
      renderFireShadowBatch({scene,shadows:lights.map(light=>light.shadow)});
      frame={...frame,pointRegions:reduction,surfaceTransport:status.surfaceTransport,previewStale:false};
      prototype.setSceneDistributedLightFrame(smokeMode==='distributed'?{texture:gather.smoke,...frame}:null);
      valid=true;status.status='submitted-awaiting-presentation';delete status.error;onStatus({...status});
    } catch(error){status.status='preparation-failed';status.error=String(error.message);prototype.setSceneDistributedLightFrame(null);onStatus({...status});throw error;}
  }
  prototype.setSceneMediumSource(null);prototype.setSceneSourceFrameConsumer(prepare);
  const nonnegative=(v)=>{if(!Number.isFinite(v)||v<0)throw new Error('nonnegative finite gain required');return v;};
  function setQuadrature(value,sampling='all'){
    validateSourceQuadrature(value,sampling);
    if(disposed)throw Error('hybrid lighting disposed');
    if(value!==pointCount){
      valid=false;releasePoints();buildPoints(value);pointCount=value;status.pointCount=value;status.status='awaiting-source';
      for(const row of originals.values())for(const material of row.owned)material.needsUpdate=true;
    }
    pointSampling=sampling;paired.value=sampling==='paired';
  }
  return {
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
      valid=false;
      releasePoints();
      shadowResolution=next.resolution;blockerSamples=next.blockerSamples;filterSamples=next.filterSamples;
      buildPoints(pointCount);
      Object.assign(status,{shadowResolution,blockerSamples,filterSamples,status:'awaiting-source'});
      for(const row of originals.values())for(const material of row.owned)material.needsUpdate=true;
    },
    setQuadrature,setPointCount(value){setQuadrature(value);},setPointSampling(value){setQuadrature(pointCount,value);},
    // Host restores these controls for both routes. Record but never pretend
    // they affect point surfaces; the prototype UI marks them inapplicable.
    setReceiverSpacing(value){status.receiverSpacingRequested=value;},setSurfaceReconstruction(value){status.surfaceReconstructionRequested=value;},setEditing(){},
    debugState(){return {...status,pointSampling,evaluatedPointCount:pointSampling==='paired'?2:pointCount,capturedPointCount:pointCount,gain,sourceTransform,sourceSoftness,smokeMode,surfaceScattering,surfaceGain:surfaceGain.value,frame,shadows:lights.map(l=>l.shadow.debugState())};},
    canRender(){const source=prototype.sceneVolumeSourceField();return !disposed&&valid&&source.status==='encoded'&&source.generation===frame?.generation&&source.frame===frame?.frame;},
    readback(){if(!gather)throw new Error('hybrid not encoded');return gather.readback();},
    readPointRegions(){if(!valid)throw Error('hybrid source not current');return points.readback();},
    dispose(){
      valid=false;disposed=true;prototype.setSceneSourceFrameConsumer(null);prototype.setSceneDistributedLightFrame(null);
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
      originals.clear();releasePoints();gather?.destroy();
    },
  };
}
