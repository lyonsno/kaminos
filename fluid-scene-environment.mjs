import * as THREE from './lib/three.webgpu.js';
import {uniform,vec4,pmremTexture,equirectDirection,uv} from './lib/three.tsl.js';

// Shared scene PMREM to world-radiance texture; no private lighting preset.
export function createFluidSceneEnvironment({renderer,scene,options}){
  const environmentRotation=uniform(new THREE.Matrix3()), environmentIntensity=uniform(1);
  let environmentTarget=null, environmentQuad=null, environmentSource=null, environmentKey=null, environmentGeneration=0;
  function renderEnvironment() {
    const source=scene.environment;
    if (!source) throw Error('Local liquid host environment is missing');
    const key=JSON.stringify([source.uuid,source.version,scene.environmentIntensity,scene.environmentRotation.toArray()]);
    if (key===environmentKey) return;
    if (source!==environmentSource) {
      environmentTarget?.dispose(); environmentQuad?.material.dispose();
      // Keep the current host PMREM atlas width; no lower private environment.
      const width=source.image?.width;
      if (!Number.isInteger(width) || width<2) throw Error('Host environment extent unavailable');
      environmentTarget=new THREE.RenderTarget(width,Math.ceil(width/2),options);
      const material=new THREE.NodeMaterial(); material.toneMapped=false;
      // The retained sampler uses v=acos(worldY)/PI: north is the top row.
      material.fragmentNode=vec4(pmremTexture(source,environmentRotation.mul(equirectDirection(uv().flipY())),0).rgb.mul(environmentIntensity),1);
      environmentQuad=new THREE.QuadMesh(material); environmentSource=source;
    }
    environmentRotation.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(scene.environmentRotation).transpose());
    environmentIntensity.value=scene.environmentIntensity;
    renderer.setRenderTarget(environmentTarget); environmentQuad.render(renderer);
    environmentKey=key; environmentGeneration++;
  }

 return {render:renderEnvironment,view:()=>renderer.backend.get(environmentTarget.texture).texture.createView(),state:()=>({environmentSource:environmentSource?.uuid??null,environmentGeneration}),dispose(){environmentTarget?.dispose();environmentQuad?.material.dispose();}};
}
