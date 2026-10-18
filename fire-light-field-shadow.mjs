import * as THREE from './lib/three.webgpu.js';
import {radialSoftVisibility,createShadowFilterPattern} from './fire-shadow-filter.mjs';
import {validateShadowQuality} from './fire-shadow-quality.mjs';
import {validateShadowSampling} from './fire-shadow-sampling.mjs';
import {residentLightCoverage,validateResidentLightCoverage} from './scene-resident-coverage.mjs';
const {cameraProjectionMatrix,cameraViewMatrix,positionWorld,cubeTexture,float,vec3,vec4,uniform,step,mix}=THREE.TSL;

const activeBatches=new WeakSet();
function prepareShadowScene(scene) {
  scene.updateMatrixWorld(true);
  const bounds=new THREE.Box3(),objectBounds=new THREE.Box3(),casters=[];
  scene.traverseVisible(object=>{
    if(!object.isMesh||!object.castShadow)return;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    const coverage=residentLightCoverage(object);
    const resident=coverage?validateResidentLightCoverage(object,coverage):null;
    if(object.isSkinnedMesh||(!coverage&&(object.isInstancedMesh||materials.some(m=>m.transparent||m.alphaTest>0))))
      throw new Error(`fire-shadow-unsupported-caster: ${object.name||object.uuid} requires static opaque mesh`);
    if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();
    objectBounds.copy(resident?.bounds??object.geometry.boundingBox).applyMatrix4(coverage?.owner.matrixWorld??object.matrixWorld);
    bounds.union(objectBounds);casters.push(object);
  });
  const extent=bounds.isEmpty()?new THREE.Vector3(1,1,1):new THREE.Vector3(
    Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x)),
    Math.max(Math.abs(bounds.min.y),Math.abs(bounds.max.y)),
    Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z)));
  return {scene,casters,extent};
}

// Synchronous and frame-local: reuse preparation, never reuse old captures or
// let a retained snapshot authorize a later frame's geometry.
export function renderFireShadowBatch({scene,shadows}) {
  const prepared=prepareShadowScene(scene);
  activeBatches.add(prepared);
  try {for(const shadow of shadows)shadow.render(prepared);}
  finally {activeBatches.delete(prepared);}
}

// CPU frustum tests cannot see the GPU source used by vertexNode. Restore all
// temporary state even when a face fails, and keep actual material sidedness.
export function renderFireShadowCube({renderer,scene,cubeCamera,material,far,casters=null,sharedPreparation=true,RendererUtils=THREE.RendererUtils,coverageMaterials=null}) {
  const state=RendererUtils.resetRendererAndSceneState(renderer,scene);
  const culling=[],autoUpdate=scene.matrixWorldAutoUpdate;
  try {
    const disableCulling=object=>{
      if(object.isMesh&&object.castShadow) {culling.push([object,object.frustumCulled]);object.frustumCulled=false;}
    };
    if(casters)casters.forEach(disableCulling);else scene.traverseVisible(disableCulling);
    // Caller has updated world matrices for this capture batch. CubeCamera
    // still updates each face camera; only redundant scene walks are omitted.
    if(sharedPreparation)scene.matrixWorldAutoUpdate=false;
    scene.overrideMaterial=material;
    renderer.setClearColor(new THREE.Color(far,far,far),1);
    renderer.setRenderObjectFunction((...args)=>{
      if(!args[0].isMesh||!args[0].castShadow) return;
      const side=material.side;
      material.side=args[4].side;
      const prior=scene.overrideMaterial,source=args[4];
      try {
        if(coverageMaterials&&residentLightCoverage(args[0])){
          let row=coverageMaterials.get(source);
          if(!row||row.opacity!==source.opacityNode){
            row?.material.dispose();
            const replacement=material.clone(),radial=material.fragmentNode;
            replacement.fragmentNode=THREE.TSL.Fn(()=>{THREE.TSL.If(source.opacityNode.lessThan(source.alphaTest),()=>THREE.TSL.Discard());return radial;})();
            row={opacity:source.opacityNode,material:replacement};coverageMaterials.set(source,row);
          }
          row.material.side=source.side;scene.overrideMaterial=row.material;
        }
        renderer.renderObject(...args);
      }
      finally {material.side=side;scene.overrideMaterial=prior;}
    });
    cubeCamera.update(renderer,scene);
  } finally {
    scene.matrixWorldAutoUpdate=autoUpdate;
    for(const [object,frustumCulled] of culling) object.frustumCulled=frustumCulled;
    RendererUtils.restoreRendererAndSceneState(renderer,scene,state);
  }
}

export function createFireLightFieldShadow({renderer,scene,sourceNode,receiverNode,normalNode,requested=false,resolution=512,sourceRadius=()=>Math.sqrt(11),sourceSizeNode=null,shadowSoftness=0,shadowSampling='fixed',filterCoordinates,screenAligned=true,sharedPreparation=true,blockerSamples=9,filterSamples=16,filterPattern=createShadowFilterPattern(filterSamples,renderer.backend?.device?.limits)}) {
  validateShadowQuality({resolution,blockerSamples,filterSamples},renderer.backend?.device?.limits);
  if(!Number.isInteger(resolution)||resolution<=0) throw new Error('fire-shadow-resolution-must-be-positive-integer');
  const validateSoftness=value=>{if(!Number.isFinite(value)||value<0)throw Error('shadow softness must be finite and nonnegative');return value;};
  const softness=uniform(validateSoftness(shadowSoftness));
  const complementary=uniform(validateShadowSampling(shadowSampling)==='complementary','bool');
  if(shadowSoftness>0&&sourceSizeNode===null)throw Error('soft shadows require a source size node');
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
  const coverageMaterials=new Map();
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
  const sampleDepth=ray=>{
  // Explicit LOD is necessary inside spatially divergent source branches.
  // These radial depth cubes have exactly one mip level.
  const shadowSample=cubeTexture(target.texture,ray).level(0);
  // This cube stores world-space radial distances, not environment radiance.
  // Keep CubeCamera's backend convention but exclude CubeTextureNode's
  // materialEnvRotation (otherwise rotating the HDR rotates solid shadows).
  shadowSample.setupUV=(builder,uvNode)=>builder.renderer.coordinateSystem===THREE.WebGPUCoordinateSystem
    ?vec3(uvNode.x.negate(),uvNode.yz):uvNode;
  return shadowSample.r;
  };
  const shadowDistance=sampleDepth(direction),hardVisibility=step(distance.sub(bias),shadowDistance);
  const filterDifferential=screenAligned?THREE.TSL.dFdx(direction).toVar():null;
  const filtered=sourceSizeNode===null?hardVisibility:radialSoftVisibility({sampleDepth,delta,normal:normalNode,distance,bias,sourceRadius:sourceSizeNode,softness,hardVisibility,complementary,filterCoordinates,filterDifferential,screenAligned,blockerSamples,filterSamples,filterPattern});
  const visibility=mix(float(1),filtered,enabled.mul(effective));
  const status={identity:'gpu-centroid-cube-fire-visibility-v0',requested,effective:false,reason:'not-rendered',resolution,source:'live-gpu-emission-centroid',approximation:'single-center-opaque-static-mesh',renderCount:0,filter:sourceSizeNode===null||shadowSoftness===0?'hard':'radial-pcss',shadowSoftness,shadowSampling,blockerSamples,filterSamples};
  return {
    prepareSampling(){filterDifferential?.toStack();},
    setSampling(value){validateShadowSampling(value);complementary.value=value==='complementary';status.shadowSampling=value;},
    visibility,
    resource() {
      return {texture:status.effective ? renderer.backend.get(target.texture).texture : null,
        effective:status.effective, resolution, colorTexture:target.texture};
    },
    async diagnose(anchors,cameraPosition) {
      if(!status.effective||enabled.value===0) throw new Error('shadow-not-effective');
      const {diagnoseFireShadow}=await import('./fire-shadow-diagnostic.mjs');
      return diagnoseFireShadow({renderer,scene,anchors,cameraPosition,status:{...status},nodes:{
        receiver:vec4(receiverNode,visibility),source:vec4(sourceNode,bias),
        comparison:vec4(delta,distance.sub(bias)),normal:vec4(normalNode,shadowDistance),
      }});
    },
    render(prepared=null) {
      if(enabled.value===0) {status.effective=false;status.reason='disabled';effective.value=0;return;}
      effective.value=0;status.effective=false;status.reason='rendering';
      try {
        if(prepared&&(prepared.scene!==scene||!activeBatches.has(prepared)))throw Error('fire-shadow-inactive-or-foreign-batch');
        const {extent,casters}=prepared??prepareShadowScene(scene);
        const radius=sourceRadius();if(!Number.isFinite(radius)||radius<0)throw new Error('finite source radius required');
        const far=extent.length()+radius+.01;
        for(const camera of cubeCamera.children)if(!sharedPreparation||camera.far!==far){camera.far=far;camera.updateProjectionMatrix();}
        renderFireShadowCube({renderer,scene,cubeCamera,material,far,casters:sharedPreparation?casters:null,sharedPreparation,coverageMaterials});
        effective.value=1;status.effective=true;status.reason=null;
        status.renderCount++;status.meshCount=casters.length;status.far=far;
      } catch(error) {status.reason=String(error.message);throw error;}
    },
    setEnabled(value) {enabled.value=value?1:0;status.requested=!!value;return {...status};},
    setSoftness(value) {validateSoftness(value);if(sourceSizeNode===null&&value>0)throw Error('soft shadows require a source size node');softness.value=value;status.shadowSoftness=value;status.filter=value===0?'hard':'radial-pcss';return {...status};},
    debugState:()=>({...status,filterPattern:{route:filterPattern.route,reason:filterPattern.reason,bytes:filterPattern.bytes}}),
    dispose() {target.dispose();material.dispose();for(const row of coverageMaterials.values())row.material.dispose();coverageMaterials.clear();},
  };
}
