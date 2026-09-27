import * as THREE from './lib/three.webgpu.js';
import {createFireLightFieldShadow} from './fire-light-field-shadow.mjs';
import {validateScenePointSource} from './scene-volume-source.mjs';
import {SCENE_MEDIUM_LOOKUP_WGSL,SCENE_POINT_TRANSFER_WGSL} from './scene-point-light.mjs';

// Private experiment mount: no authoring schema, persistence or new host API.
// A shared device and the ordinary identity world/volume transform are required.
export function mountSceneRadiance({renderer,scene,prototype,source:initial={position:[0,1.4,.7],intensity:[3,1,.2],stepLength:.03125}}) {
  const {uniform,vec3,positionWorld,normalWorld,texture3D,cubeTexture,sampler,wgslFn}=THREE.TSL;
  let source=validateScenePointSource(initial);
  const position=uniform(new THREE.Vector3(...source.position));
  const intensity=uniform(new THREE.Vector3(...source.intensity));
  const shadow=createFireLightFieldShadow({renderer,scene,sourceNode:position,receiverNode:positionWorld,normalNode:normalWorld,requested:true});
  function wrapTau(texture=null,dimensions=[32,64,32]) {
    const external=new THREE.ExternalTexture(texture);
    external.is3DTexture=true;
    const [width,height,depth]=dimensions;external.image={width,height,depth};
    external.format=THREE.RedFormat;external.type=THREE.FloatType;
    external.colorSpace=THREE.NoColorSpace;
    external.minFilter=THREE.NearestFilter;external.magFilter=THREE.NearestFilter;
    external.generateMipmaps=false;
    return external;
  }
  let tauExternal=wrapTau();
  const tauNode=texture3D(tauExternal);
  const cubeNode=cubeTexture(shadow.resource().colorTexture);
  const mediumFn=wgslFn(SCENE_MEDIUM_LOOKUP_WGSL);
  const transfer=wgslFn(SCENE_POINT_TRANSFER_WGSL,[mediumFn]);
  const transported=transfer({tau:tauNode,radial:cubeNode,radialSampler:sampler(cubeNode),
    source:position,intensity,receiver:positionWorld,normal:normalWorld,resolution:uniform(512)});
  const irradiance=transported.mul(normalWorld.dot(position.sub(positionWorld).normalize()).max(0));
  const originals=new Map(), converted=new Map();
  let visibilityKey=null,disposed=false,lastFrame=null;
  const status={identity:'shared-point-scene-radiance-experiment-v0',status:'mounted-awaiting-source',
    coordinateSpace:'identity-scene-and-volume-local',surfaceUnits:'relative-irradiance',smokeUnits:'relative-angular-mean-radiance',
    display:'existing-independent-mesh-and-volume-display-transforms',materialCount:0};
  function releaseTauWrapper() {
    // Three's destroyTexture also destroys ExternalTexture backing handles.
    // The source producer owns this GPUTexture; detach before wrapper disposal.
    delete renderer.backend.get(tauExternal).texture;
    tauExternal.dispose();
  }
  function materialFor(original) {
    if (converted.has(original)) return converted.get(original);
    if (!original.isMeshStandardMaterial && !original.isMeshStandardNodeMaterial && !original.isMeshPhysicalMaterial && !original.isMeshPhysicalNodeMaterial) return original;
    const material=renderer.library.fromMaterial(original).clone();
    const setup=material.setupMaterialLightings;
    material.setupMaterialLightings=function(builder) {
      return [...setup.call(this,builder),new THREE.IrradianceNode(irradiance)];
    };
    converted.set(original,material); status.materialCount=converted.size;
    return material;
  }
  function prepare(field) {
    if(disposed) throw new Error('scene radiance disposed');
    if(field.medium.status!=='encoded'||field.medium.generation!==field.source.generation) throw new Error('scene radiance requires same-generation medium');
    if(tauExternal.sourceTexture!==field.medium.texture) {
      // ExternalTexture's backend handle is immutable after initialization.
      // Dispose only its wrapper on a fluid rebuild, never the producer texture.
      if(tauExternal.sourceTexture) releaseTauWrapper();
      // A new wrapper identity also invalidates Three's cached sampled-texture
      // binding. Reusing the wrapper retained a destroyed pre-replay texture
      // in the first native consumer run (native-006).
      const nextVersion=tauExternal.version+1;
      tauExternal=wrapTau(field.medium.texture,field.medium.dimensions);
      // Bundled Three Bindings._update compares texture.version generations
      // before rebuilding the GPU bind group, even for a new wrapper identity.
      tauExternal.version=nextVersion;
      tauNode.value=tauExternal;
    }
    scene.updateMatrixWorld(true);
    const key=[...source.position];
    scene.traverseVisible(object=>{
      if(!object.isMesh) return;
      if(!originals.has(object)) {
        const original=object.material;
        const replacement=Array.isArray(original)?original.map(materialFor):materialFor(original);
        if(replacement!==original) {originals.set(object,{original,replacement});object.material=replacement;}
      }
      if(object.castShadow) {
        const geometry=object.geometry;
        key.push(object.uuid,...object.matrixWorld.elements,geometry.uuid,geometry.index?.version??0,
          ...Object.values(geometry.attributes).map(a=>a.version),
          ...(Array.isArray(object.material)?object.material:[object.material]).map(m=>`${m.side}/${m.transparent}/${m.alphaTest}`));
      }
    });
    const nextKey=JSON.stringify(key);
    if(nextKey!==visibilityKey) {shadow.render();visibilityKey=nextKey;}
    lastFrame=prototype.setScenePointLightFrame({source,medium:field.medium,shadow:shadow.resource()});
    status.status='source-bound-awaiting-host-depth';
  }
  prototype.setSceneMediumSource(source);
  prototype.setSceneSourceFrameConsumer(prepare);
  return {
    setSource(next) {
      source=validateScenePointSource({...source,...next});
      position.value.set(...source.position);intensity.value.set(...source.intensity);
      prototype.setSceneMediumSource(source);
      return {...source};
    },
    debugState:()=>({...status,source:{...source},frame:prototype.scenePointLightFrame(),shadow:shadow.debugState()}),
    canRender() {
      const medium=prototype.sceneMediumOpticalDepthField();
      // The host RAF is independent of volume replay/reset. Never submit a
      // material using a borrowed texture after its producer has retired it.
      return !disposed && medium.status==='encoded' && medium.texture===tauExternal.sourceTexture
        && medium.generation===lastFrame?.generation;
    },
    dispose() {
      prototype.setScenePointLightFrame(null);prototype.setSceneSourceFrameConsumer(null);
      for(const [object,{original,replacement}] of originals) if(object.material===replacement) object.material=original;
      for(const material of converted.values()) material.dispose();
      releaseTauWrapper();shadow.dispose();disposed=true;
    },
  };
}
