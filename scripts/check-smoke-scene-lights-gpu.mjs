import * as THREE from '../lib/three.webgpu.js';
import {collectSceneSmokeLights} from '../scene-smoke-lights.mjs';
import {createVolumeGather} from '../scene-volume-gather.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';

// Actual Three light records and production WGSL; tiny deterministic fields.
export async function checkSmokeSceneLightsGpu(device){
 const source=device.createTexture({size:[4,8,4],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 const field={status:'encoded',texture:source,dimensions:[4,8,4],generation:1,frame:1},scene=new THREE.Scene(),rows=[];
 let gather,light;
 const upload=sigma=>{const a=new Float32Array(4*8*4*4);for(let i=3;i<a.length;i+=4)a[i]=sigma;device.queue.writeTexture({texture:source},a,{bytesPerRow:64,rowsPerImage:8},[4,8,4]);};
 const build=(wall=null)=>{gather?.destroy();const triangles=wall===null?[]:[{a:[wall,-10,-10],b:[wall,10,-10],c:[wall,10,10]},{a:[wall,-10,-10],b:[wall,10,10],c:[wall,-10,10]}];gather=createVolumeGather(device,{geometry:buildTriangleVisibility(triangles).packGpu(),receivers:[],volumeGrid:2,smokeRefinement:1,directions:8});};
 const sample=async(label,expected,transform)=>{
  const packet=collectSceneSmokeLights(scene,transform),metadata=gather.encode(field,{gain:0,sceneLights:packet});
  const result=await gather.readback(),rgb=Array.from(result.smoke.data.slice(0,3));rows.push({label,rgb,expected,metadata,packet});
  if(!rgb.every((x,c)=>Number.isFinite(x)&&Math.abs(x-expected[c])<.0005))throw Error(label+': '+JSON.stringify(rows.at(-1)));
  return metadata;
 };
 const aim=()=>{light.position.set(.5,-.5,-.5);if(light.target){light.target.position.set(-.5,-.5,-.5);scene.add(light.target);}light.castShadow=true;scene.add(light);};
 try{
  upload(0);build();light=new THREE.SpotLight(0xffffff,4*Math.PI);aim();light.angle=Math.PI/4;light.penumbra=.25;
  await sample('actual spot, inverse-square / isotropic4pi',[1,1,1]);
  light.color.setRGB(.25,.5,1);await sample('linear light color',[.25,.5,1]);light.color.setRGB(1,1,1);
  upload(1);await sample('same-frame smoke extinction',Array(3).fill(Math.exp(-1)));
  light.target.position.set(2,-.5,-.5);await sample('outside actual spot cone',[0,0,0]);light.target.position.set(-.5,-.5,-.5);
  light.visible=false;await sample('hidden light removes contribution',[0,0,0]);light.visible=true;
  light.intensity=0;await sample('zero intensity removes contribution',[0,0,0]);light.intensity=4*Math.PI;
  build(0);await sample('opaque wall between light and smoke',[0,0,0]);
  light.castShadow=false;await sample('actual no-shadow light still has medium extinction',Array(3).fill(Math.exp(-1)));light.castShadow=true;
  build(.75);await sample('solid beyond point light must not shadow it',Array(3).fill(Math.exp(-1)));
  build();upload(0);
  light.position.set(4,3,4);light.target.position.set(2,3,4);light.intensity=16*Math.PI;
  await sample('source translation/scale retain world inverse-square',[1,1,1],{translate:[3,4,5],scale:2});
  light.removeFromParent();light.target.removeFromParent();light=new THREE.PointLight(0xffffff,4*Math.PI);aim();
  await sample('actual point light',[1,1,1]);light.distance=.5;await sample('actual cutoff distance',[0,0,0]);light.removeFromParent();
  light=new THREE.DirectionalLight(0xffffff,4*Math.PI);aim();await sample('actual directional light',[1,1,1]);
  upload(1);await sample('directional light crosses full smoke domain',Array(3).fill(Math.exp(-1.5)));
  build(5);await sample('directional occluder beyond source bounds',[0,0,0]);
  return {identity:'actual-three-punctual-smoke-gpu-v1',rows};
 }finally{gather?.destroy();source.destroy();}
}
