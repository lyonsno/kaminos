import * as THREE from './lib/three.webgpu.js';
const {cameraProjectionMatrix,cameraViewMatrix,positionWorld,cubeTexture,float,vec3,vec4,uniform,step,mix}=THREE.TSL;

function nodeIdentity(node) {
  return node?.uuid??node?.id??(node==null?null:'present');
}

export function fireShadowMaterialRevisionState(material) {
  if(!material) return null;
  return {
    uuid:material.uuid,version:material.version,visible:material.visible!==false,side:material.side,
    transparent:!!material.transparent,opacity:material.opacity,alphaTest:material.alphaTest,
    alphaHash:!!material.alphaHash,transmission:material.transmission??0,
    alphaTestNode:nodeIdentity(material.alphaTestNode),transmissionNode:nodeIdentity(material.transmissionNode),
    backdropNode:nodeIdentity(material.backdropNode),
  };
}

export function isFireShadowOpaqueMaterial(material) {
  return !!material&&material.visible!==false&&!material.transparent&&!(material.opacity<1)
    &&!(material.alphaTest>0)&&material.alphaTestNode==null&&!material.alphaHash
    &&!(material.transmission>0)&&material.transmissionNode==null&&material.backdropNode==null;
}

function assertFireShadowCaster(object) {
  const materials=Array.isArray(object.material)?object.material:[object.material];
  if(object.isSkinnedMesh||object.isInstancedMesh||!object.geometry?.attributes?.position
    ||materials.some(material=>!isFireShadowOpaqueMaterial(material))) {
    throw new Error(`fire-shadow-unsupported-caster: ${object.name||object.uuid} requires static opaque mesh`);
  }
  return materials;
}

function casterGeometryState(geometry) {
  const position=geometry.attributes.position,index=geometry.index;
  return {
    uuid:geometry.uuid,version:geometry.version??0,
    position:{count:position.count,itemSize:position.itemSize,normalized:!!position.normalized,version:position.version},
    index:index?{count:index.count,itemSize:index.itemSize,normalized:!!index.normalized,version:index.version}:null,
    groups:geometry.groups.map(group=>[group.start,group.count,group.materialIndex]),
    drawRange:[geometry.drawRange.start,geometry.drawRange.count],
  };
}

function collectFireShadowCasterState(scene,{recomputeBounds=false}={}) {
  const casters=[];
  scene.updateMatrixWorld(true);
  scene.traverseVisible(object=>{
    if(!object.isMesh||!object.castShadow) return;
    const materials=assertFireShadowCaster(object);
    if(recomputeBounds) object.geometry.computeBoundingBox();
    casters.push({object,revision:{
        uuid:object.uuid,matrixWorld:object.matrixWorld.elements,
        geometry:casterGeometryState(object.geometry),
        materials:materials.map(fireShadowMaterialRevisionState),
      }});
  });
  return casters;
}

export function fireShadowCasterRevision(scene) {
  const revisions=collectFireShadowCasterState(scene).map(entry=>entry.revision);
  revisions.sort((left,right)=>left.uuid.localeCompare(right.uuid));
  return JSON.stringify(revisions);
}

// CPU frustum tests cannot see the GPU source used by vertexNode. Restore all
// temporary state even when a face fails, and keep actual material sidedness.
export function renderFireShadowCube({renderer,scene,cubeCamera,material,far,RendererUtils=THREE.RendererUtils}) {
  const state=RendererUtils.resetRendererAndSceneState(renderer,scene);
  const culling=[];
  try {
    scene.traverseVisible(object=>{
      if(object.isMesh&&object.castShadow) {culling.push([object,object.frustumCulled]);object.frustumCulled=false;}
    });
    scene.overrideMaterial=material;
    renderer.setClearColor(new THREE.Color(far,far,far),1);
    renderer.setRenderObjectFunction((...args)=>{
      if(!args[0].isMesh||!args[0].castShadow) return;
      const side=material.side;
      material.side=args[4].side;
      try {renderer.renderObject(...args);}
      finally {material.side=side;}
    });
    cubeCamera.update(renderer,scene);
  } finally {
    for(const [object,frustumCulled] of culling) object.frustumCulled=frustumCulled;
    RendererUtils.restoreRendererAndSceneState(renderer,scene,state);
  }
}

export function createFireLightFieldShadow({renderer,scene,sourceNode,receiverNode,normalNode,requested=false,resolution=512}) {
  if(!Number.isInteger(resolution)||resolution<=0) throw new Error('fire-shadow-resolution-must-be-positive-integer');
  const enabled=uniform(requested?1:0),effective=uniform(0);
  const target=new THREE.CubeRenderTarget(resolution,{
    type:THREE.HalfFloatType,format:THREE.RGBAFormat,
    minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,
    generateMipmaps:false,depthBuffer:true,
  });
  target.texture.name='Live emission centroid kiln radial shadow';
  target.texture.colorSpace=THREE.NoColorSpace;
  const cubeCamera=new THREE.CubeCamera(.005,100,target);
  const material=new THREE.NodeMaterial();
  material.name='Fire light radial depth from GPU centroid';
  material.blending=THREE.NoBlending;material.toneMapped=false;
  // Native WebGPU cube rotations; source translation is GPU-resident and is
  // identical to the receiver's live far-field source. No CPU centroid lag.
  material.vertexNode=cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(positionWorld.sub(sourceNode),1));
  material.fragmentNode=vec4(vec3(positionWorld.sub(sourceNode).length()),1);
  const visibilityAt=(receiver,normal)=>{
    const sourceDistance=receiver.sub(sourceNode).length();
    const towardsSource=sourceNode.sub(receiver);
    const faceSign=mix(float(-1),float(1),step(float(0),normal.dot(towardsSource)));
    // Offset along the receiver plane's light-facing normal by one cube texel.
    // Radial-only bias fails on a floor viewed by the light at grazing angles.
    const receiverOffset=normal.mul(faceSign).mul(sourceDistance.mul(2/resolution).max(.001));
    const delta=receiver.add(receiverOffset).sub(sourceNode),distance=delta.length();
    const direction=delta.div(distance.max(.00001));
    // Bias follows the radial texel footprint, not viewer depth or light gain.
    const bias=distance.mul(2/resolution).max(.001);
    const shadowDistance=cubeTexture(target.texture,direction).r;
    return {
      visibility:mix(float(1),step(distance.sub(bias),shadowDistance),enabled.mul(effective)),
      delta,distance,bias,shadowDistance,
    };
  };
  const receiverVisibility=visibilityAt(receiverNode,normalNode);
  const visibility=receiverVisibility.visibility;
  const bounds=new THREE.Box3(),objectBounds=new THREE.Box3();
  const status={identity:'gpu-centroid-cube-fire-visibility-v0',requested,effective:false,reason:'not-rendered',resolution,source:'live-gpu-emission-centroid',approximation:'single-center-opaque-static-mesh',renderCount:0};
  let sourceRevision=0;
  const invalidate=(reason='source-invalidated')=>{
    sourceRevision++;effective.value=0;status.effective=false;status.reason=reason;
    status.sourceIdentity=null;
  };
  return {
    visibility,
    visibilityAt(receiver,normal) { return visibilityAt(receiver,normal).visibility; },
    invalidate,
    async diagnose(anchors,cameraPosition,validateSource=()=>{}) {
      validateSource();
      const revision=sourceRevision;
      const check=()=>{
        validateSource();
        if(!status.effective||enabled.value===0||revision!==sourceRevision) throw new Error('shadow-not-effective');
      };
      check();
      const {diagnoseFireShadow}=await import('./fire-shadow-diagnostic.mjs');
      check();
      const result=await diagnoseFireShadow({renderer,scene,anchors,cameraPosition,status:{...status},nodes:{
        receiver:vec4(receiverNode,visibility),source:vec4(sourceNode,receiverVisibility.bias),
        comparison:vec4(receiverVisibility.delta,receiverVisibility.distance.sub(receiverVisibility.bias)),normal:vec4(normalNode,receiverVisibility.shadowDistance),
      }});
      check();
      return result;
    },
    render(sourceIdentity=null) {
      if(enabled.value===0) {status.effective=false;status.reason='disabled';effective.value=0;return;}
      effective.value=0;status.effective=false;status.reason='rendering';
      try {
        bounds.makeEmpty();
        // Bounds are derived state. Rebuild them whenever the visibility cache
        // is rebuilt so a versioned in-place position edit cannot retain stale far.
        const casters=collectFireShadowCasterState(scene,{recomputeBounds:true});
        for(const {object} of casters) {
          objectBounds.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
          bounds.union(objectBounds);
        }
        // Bound scene plus source domain [-1,1]^3; no arbitrary distance cap.
        const extent=bounds.isEmpty()?new THREE.Vector3(1,1,1):new THREE.Vector3(
          Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x)),
          Math.max(Math.abs(bounds.min.y),Math.abs(bounds.max.y)),
          Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z)));
        const far=extent.length()+Math.sqrt(3)+.01;
        for(const camera of cubeCamera.children) {camera.far=far;camera.updateProjectionMatrix();}
        renderFireShadowCube({renderer,scene,cubeCamera,material,far});
        effective.value=1;status.effective=true;status.reason=null;
        status.sourceIdentity=sourceIdentity;
        status.renderCount++;status.meshCount=casters.length;status.far=far;
      } catch(error) {status.reason=String(error.message);throw error;}
    },
    setEnabled(value) {
      if(!value||enabled.value===0) invalidate(value?'not-rendered':'disabled');
      enabled.value=value?1:0;status.requested=!!value;return {...status};
    },
    debugState:()=>({...status}),
    dispose() {invalidate('disposed');target.dispose();material.dispose();},
  };
}
