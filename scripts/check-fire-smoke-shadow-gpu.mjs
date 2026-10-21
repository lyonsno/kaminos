import * as THREE from '../lib/three.webgpu.js';
import {createFireSmokeShadow} from '../fire-smoke-shadow.mjs';

// Browser-side, tiny production-kernel + production-TSL conformance witness.
// Caller owns the adapter/browser and persistent report destination.
export async function checkFireSmokeShadowGpu(device){
  const source=device.createTexture({size:[4,8,4],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const points=device.createTexture({size:[1,2],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const renderer=new THREE.WebGPURenderer({device});let smoke,target,material;
  try{
    device.queue.writeTexture({texture:points},new Float32Array(8),{bytesPerRow:16},[1,2]);
    smoke=createFireSmokeShadow(device,{points,count:1,resolution:4,steps:16});
    await renderer.init();target=new THREE.RenderTarget(1,1,{type:THREE.FloatType,depthBuffer:false});
    const receiver=THREE.TSL.uniform(new THREE.Vector3());
    material=new THREE.NodeMaterial();material.toneMapped=false;
    material.fragmentNode=THREE.TSL.vec4(THREE.TSL.vec3(smoke.visibility(THREE.TSL.vec3(0),receiver,0)),1);
    const quad=new THREE.QuadMesh(material),rows=[];
    for(const sigma of [0,2]){
      const values=new Float32Array(4*8*4*4);for(let i=3;i<values.length;i+=4)values[i]=sigma;
      device.queue.writeTexture({texture:source},values,{bytesPerRow:64,rowsPerImage:8},[4,8,4]);
      const identity={generation:sigma+1,frame:sigma+1,count:1};
      const field={...identity,status:'encoded',texture:source,dimensions:[4,8,4]};
      const metadata=smoke.encode(field,identity);
      for(const distance of [0,.25,1,3]){
        receiver.value.set(distance,0,0);renderer.setRenderTarget(target);quad.render(renderer);
        const rgba=Array.from(await renderer.readRenderTargetPixelsAsync(target,0,0,1,1)),expected=Math.exp(-sigma*Math.min(distance,1));
        rows.push({sigma,distance,rgba,expected,metadata});
        if(!rgba.every(Number.isFinite)||rgba.slice(0,3).some(x=>x<0||x>1||Math.abs(x-expected)>.03))throw Error(`smoke prefix shader mismatch: ${JSON.stringify(rows.at(-1))}`);
      }
    }
    return {identity:'production-smoke-prefix-and-tsl-v1',rows};
  }finally{target?.dispose();material?.dispose();smoke?.dispose(renderer);renderer.dispose();source.destroy();points.destroy();}
}
