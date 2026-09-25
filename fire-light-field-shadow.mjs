import * as THREE from './lib/three.webgpu.js';
const {cameraProjectionMatrix,cameraViewMatrix,positionWorld,cubeTexture,float,vec3,vec4,uniform,step,mix}=THREE.TSL;

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
  const sourceDistance=receiverNode.sub(sourceNode).length();
  const towardsSource=sourceNode.sub(receiverNode);
  const faceSign=mix(float(-1),float(1),step(float(0),normalNode.dot(towardsSource)));
  // Offset along the receiver plane's light-facing normal by one cube texel.
  // Radial-only bias fails on a floor viewed by the light at grazing angles.
  const receiverOffset=normalNode.mul(faceSign).mul(sourceDistance.mul(2/resolution).max(.001));
  const delta=receiverNode.add(receiverOffset).sub(sourceNode),distance=delta.length();
  const direction=delta.div(distance.max(.00001));
  // Bias follows the radial texel footprint, not viewer depth or light gain.
  const bias=distance.mul(2/resolution).max(.001);
  const shadowDistance=cubeTexture(target.texture,direction).r;
  const visibility=mix(float(1),step(distance.sub(bias),shadowDistance),enabled.mul(effective));
  const bounds=new THREE.Box3(),objectBounds=new THREE.Box3();
  const status={identity:'gpu-centroid-cube-fire-visibility-v0',requested,effective:false,reason:'not-rendered',resolution,source:'live-gpu-emission-centroid',approximation:'single-center-opaque-static-mesh',renderCount:0};
  return {
    visibility,
    async diagnose(anchors,cameraPosition) {
      if(!status.effective||enabled.value===0) throw new Error('shadow-not-effective');
      const {diagnoseFireShadow}=await import('./fire-shadow-diagnostic.mjs');
      return diagnoseFireShadow({renderer,scene,anchors,cameraPosition,status:{...status},nodes:{
        receiver:vec4(receiverNode,visibility),source:vec4(sourceNode,bias),
        comparison:vec4(delta,distance.sub(bias)),normal:vec4(normalNode,shadowDistance),
      }});
    },
    render() {
      if(enabled.value===0) {status.effective=false;status.reason='disabled';effective.value=0;return;}
      effective.value=0;status.effective=false;status.reason='rendering';
      try {
        bounds.makeEmpty();let meshCount=0;
        scene.updateMatrixWorld(true);
        scene.traverseVisible(object=>{
          if(!object.isMesh||!object.castShadow) return;
          const materials=Array.isArray(object.material)?object.material:[object.material];
          if(object.isSkinnedMesh||object.isInstancedMesh||materials.some(m=>m.transparent||m.alphaTest>0)) {
            throw new Error(`fire-shadow-unsupported-caster: ${object.name||object.uuid} requires static opaque mesh`);
          }
          if(!object.geometry.boundingBox) object.geometry.computeBoundingBox();
          objectBounds.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
          bounds.union(objectBounds);meshCount++;
        });
        // Bound scene plus source domain [-1,1]^3; no arbitrary distance cap.
        const extent=bounds.isEmpty()?new THREE.Vector3(1,1,1):new THREE.Vector3(
          Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x)),
          Math.max(Math.abs(bounds.min.y),Math.abs(bounds.max.y)),
          Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z)));
        const far=extent.length()+Math.sqrt(3)+.01;
        for(const camera of cubeCamera.children) {camera.far=far;camera.updateProjectionMatrix();}
        renderFireShadowCube({renderer,scene,cubeCamera,material,far});
        effective.value=1;status.effective=true;status.reason=null;
        status.renderCount++;status.meshCount=meshCount;status.far=far;
      } catch(error) {status.reason=String(error.message);throw error;}
    },
    setEnabled(value) {enabled.value=value?1:0;status.requested=!!value;return {...status};},
    debugState:()=>({...status}),
    dispose() {target.dispose();material.dispose();},
  };
}
