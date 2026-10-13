import * as THREE from './lib/three.webgpu.js';
import {cloneSceneRadianceMaterial} from './scene-radiance.mjs';
import {createFireLightFieldShadow} from './fire-light-field-shadow.mjs';
import {collectStaticSceneGeometry,staticSceneGeometryRevision} from './scene-light-geometry.mjs';
import {buildTriangleVisibility} from './scene-light-visibility.mjs';
import {createVolumeGather,lightingDirections} from './scene-volume-gather.mjs';
import {createPointRegions} from './scene-point-regions.mjs';
import {validateSceneSourceTransform} from './scene-volume-source.mjs';
import {deriveSourceGuide} from './scene-source-guide.mjs';
import {validateSourceSoftness} from './scene-source-softening.mjs';

// Opt-in prototype. Smoke retains distributed transport. Surfaces consume a
// live GPU reduction of that same source, with independent raster visibility.
export function mountDistributedSceneRadiance({renderer,scene,prototype,device,directions=24,volumeGrid=16,pointCount=4,shadowResolution=256,getSourceGuide=null,onStatus=()=>{},createShadow=createFireLightFieldShadow}) {
  const {uniform,vec3,textureLoad,ivec2,positionWorld,normalWorld}=THREE.TSL;
  const points=createPointRegions(device,{count:pointCount});
  const external=new THREE.ExternalTexture(points.texture);
  external.image={width:pointCount,height:2};external.format=THREE.RGBAFormat;external.type=THREE.FloatType;
  external.colorSpace=THREE.NoColorSpace;external.minFilter=external.magFilter=THREE.NearestFilter;external.generateMipmaps=false;
  const translation=uniform(new THREE.Vector3()),scale=uniform(1),surfaceGain=uniform(1);
  const lights=Array.from({length:pointCount},(_,i)=>{
    const region=textureLoad(external,ivec2(i,0)),energy=textureLoad(external,ivec2(i,1)).rgb;
    const position=region.xyz.mul(scale).add(translation);
    const shadow=createShadow({renderer,scene,sourceNode:position,receiverNode:positionWorld,normalNode:normalWorld,requested:true,resolution:shadowResolution,sourceRadius:()=>translation.value.length()+scale.value*Math.sqrt(11)});
    // Source coefficients use volume-local lengths. Express distance there;
    // scaling the object should not silently scale its radiometric brightness.
    const delta=position.sub(positionWorld).div(scale),distance2=delta.dot(delta);
    const direction=delta.div(distance2.sqrt().max(1e-6));
    return {shadow,irradiance:energy.div(distance2.add(region.w)).mul(normalWorld.dot(direction).max(0)).mul(shadow.visibility)};
  });
  let irradiance=vec3(0);for(const light of lights)irradiance=irradiance.add(light.irradiance);irradiance=irradiance.mul(surfaceGain);
  const originals=new Map();let gather=null,geometryRevision=null,frame=null,disposed=false,valid=false;
  let gain=1,sourceSoftness=0,surfaceScattering=false,smokeMode='distributed',angularPattern='fixed',angularRotation=0,retainComparisons=false;
  let sourceTransform=validateSceneSourceTransform();
  const status={identity:'hybrid-distributed-smoke-point-surfaces-v0',status:'awaiting-source',surfaceTransport:'gpu-point-regions',surfaceReceivers:0,pointCount,shadowResolution,volumeGrid,directions,
    geometryBuilds:0,visibilityBuilds:0,previewStale:false,receiverSpacingRequested:0,surfaceReconstructionRequested:0,
    limitations:['point-region-surface-approximation','point-surfaces-omit-medium-extinction','hard-point-shadows','smoke-visibility-refresh-on-source-transform','CPU-world-BVH-rebuild-on-object-edit','no-surface-bounce']};
  function installMaterials(){
    scene.traverseVisible(mesh=>{
      if(!mesh.isMesh)return;
      const prior=originals.get(mesh);if(prior&&mesh.material===prior.installed)return;
      if(prior){for(const m of prior.owned)m.dispose();originals.delete(mesh);}
      const source=mesh.material,list=Array.isArray(source)?source:[source];
      if(!list.every(m=>m.isMeshStandardMaterial||m.isMeshStandardNodeMaterial||m.isMeshPhysicalMaterial||m.isMeshPhysicalNodeMaterial))return;
      const owned=list.map(original=>{
        const material=cloneSceneRadianceMaterial(renderer.library,original),setup=material.setupMaterialLightings;
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
      const revision=staticSceneGeometryRevision(scene);
      if(!gather||revision!==geometryRevision){
        status.status='building-smoke-world-visibility';onStatus({...status});
        const started=performance.now(),geometry=collectStaticSceneGeometry(scene),packed=buildTriangleVisibility(geometry.triangles).packGpu();
        const next=createVolumeGather(device,{geometry:packed,receivers:[],volumeGrid,directions,angularPattern,angularRotation,worldGeometry:true});
        prototype.setSceneDistributedLightFrame(null);gather?.destroy();gather=next;geometryRevision=revision;
        status.geometryBuilds++;status.visibilityBuilds++;status.lastGeometryBuildMs=performance.now()-started;status.staticTriangles=packed.triangleCount;
      }
      gather.setDirections(directions);gather.setAngularPattern(angularPattern,angularRotation);gather.setRetainComparisons(retainComparisons);
      if(angularPattern==='guided'){
        if(!getSourceGuide)throw new Error('hybrid guided smoke requires authored source guide');
        gather.setSourceGuide(deriveSourceGuide(getSourceGuide(),sourceTransform));
      }
      // Even legacy smoke display may request scattered contribution to the
      // surface points; the gather owns that once-scattered source and gain.
      frame=gather.encode(field.source,{gain,sourceSoftness,surfaceScattering,smokeEnabled:smokeMode==='distributed'});
      const reduction=points.encode(gather.transportSource());
      for(const light of lights)light.shadow.render();
      frame={...frame,pointRegions:reduction,surfaceTransport:status.surfaceTransport,previewStale:false};
      prototype.setSceneDistributedLightFrame(smokeMode==='distributed'?{texture:gather.smoke,...frame}:null);
      valid=true;status.status='submitted-awaiting-presentation';delete status.error;onStatus({...status});
    } catch(error){status.status='preparation-failed';status.error=String(error.message);prototype.setSceneDistributedLightFrame(null);onStatus({...status});throw error;}
  }
  prototype.setSceneMediumSource(null);prototype.setSceneSourceFrameConsumer(prepare);
  const nonnegative=(v)=>{if(!Number.isFinite(v)||v<0)throw new Error('nonnegative finite gain required');return v;};
  return {
    setGain(value){gain=nonnegative(value);},setSurfaceGain(value){surfaceGain.value=nonnegative(value);},
    setSurfaceScattering(value){surfaceScattering=!!value;},setSourceSoftness(value){sourceSoftness=validateSourceSoftness(value);},
    setSmokeMode(value){if(!['distributed','legacy'].includes(value))throw new Error('unknown smoke mode');smokeMode=value;},
    setDirections(value){lightingDirections(value);directions=value;status.directions=value;},
    setAngularPattern(pattern,rotation=0){if(!['fixed','spatial','source','guided'].includes(pattern)||!Number.isFinite(rotation))throw new Error('valid angular pattern required');angularPattern=pattern;angularRotation=rotation;},
    setRetainComparisons(value){retainComparisons=!!value;},
    // Host restores these controls for both routes. Record but never pretend
    // they affect point surfaces; the prototype UI marks them inapplicable.
    setReceiverSpacing(value){status.receiverSpacingRequested=value;},setSurfaceReconstruction(value){status.surfaceReconstructionRequested=value;},setEditing(){},
    debugState(){return {...status,gain,sourceTransform,sourceSoftness,smokeMode,surfaceScattering,surfaceGain:surfaceGain.value,frame,shadows:lights.map(l=>l.shadow.debugState())};},
    canRender(){const source=prototype.sceneVolumeSourceField();return !disposed&&valid&&source.status==='encoded'&&source.generation===frame?.generation&&source.frame===frame?.frame;},
    readback(){if(!gather)throw new Error('hybrid not encoded');return gather.readback();},
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
      originals.clear();for(const light of lights)light.shadow.dispose();
      delete renderer.backend.get(external).texture;external.dispose();points.destroy();gather?.destroy();
    },
  };
}
