// Actual host environment, projected once per lighting edit on the shared GPU.
// Background visibility/grading is deliberately not an illumination input.
import * as THREE from './lib/three.webgpu.js';
const {vec4,pmremTexture,equirectDirection,uv,uniform}=THREE.TSL;

export function sceneSmokeEnvironmentRecipe(scene,blur=0){
  validateSmokeEnvironmentBlur(blur);
  const source=scene.environment,intensity=scene.environmentIntensity??1;
  if(!Number.isFinite(intensity)||intensity<0)throw Error('nonnegative finite scene environment intensity required');
  if(!source||intensity===0)return null;
  const width=source.image?.width,rotation=scene.environmentRotation.toArray();
  if(!Number.isInteger(width)||width<2)throw Error('scene environment extent unavailable');
  if(rotation.slice(0,3).some(x=>!Number.isFinite(x)))throw Error('finite scene environment rotation required');
  return {route:'scene-pmrem-world-radiance-v1',source:source.uuid,version:source.version,
    intensity,blur,rotation,width,height:Math.ceil(width/2)};
}

export function createSceneSmokeEnvironment({renderer,scene,device,blur=0}){
  validateSmokeEnvironmentBlur(blur);
  const rotation=uniform(new THREE.Matrix3()),intensity=uniform(1),bandwidth=uniform(blur);
  let target=null,quad=null,source=null,key=null,generation=0,disposed=false;
  function release(){target?.dispose();quad?.material.dispose();target=null;quad=null;source=null;key=null;}
  return {
    setBlur(value){blur=validateSmokeEnvironmentBlur(value);},
    frame(){
      if(disposed)throw Error('smoke environment disposed');
      const recipe=sceneSmokeEnvironmentRecipe(scene,blur);
      if(!recipe)return null;
      if(renderer.backend.device!==device)throw Error('smoke environment requires the scene GPU device');
      const next=JSON.stringify(recipe);
      if(next!==key){
        if(source!==scene.environment||target?.width!==recipe.width||target?.height!==recipe.height){
          release();source=scene.environment;
          target=new THREE.RenderTarget(recipe.width,recipe.height,{type:THREE.HalfFloatType,depthBuffer:false,
            minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
          const material=new THREE.NodeMaterial();material.toneMapped=false;
          material.fragmentNode=vec4(pmremTexture(source,rotation.mul(equirectDirection(uv().flipY())),bandwidth).rgb.mul(intensity),1);
          quad=new THREE.QuadMesh(material);
        }
        rotation.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(scene.environmentRotation).transpose());
        intensity.value=recipe.intensity;bandwidth.value=recipe.blur;
        const saved=THREE.RendererUtils.resetRendererAndSceneState(renderer,scene);
        try{renderer.setRenderTarget(target);quad.render(renderer);}
        finally{THREE.RendererUtils.restoreRendererAndSceneState(renderer,scene,saved);}
        key=next;generation++;
      }
      const texture=renderer.backend.get(target.texture).texture;
      if(!texture)throw Error('smoke environment projection has no native GPU texture');
      return {texture,metadata:{...recipe,generation}};
    },
    dispose(){disposed=true;release();},
  };
}

export function validateSmokeEnvironmentBlur(value){
  if(!Number.isFinite(value)||value<0||value>1)throw Error('smoke environment blur must be in [0,1]');
  return value;
}
