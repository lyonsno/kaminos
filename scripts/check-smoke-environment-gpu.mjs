import * as THREE from '../lib/three.webgpu.js';
import {createSceneSmokeEnvironment} from '../scene-smoke-environment.mjs';
import {createVolumeGather,lightingDirections} from '../scene-volume-gather.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';

// Tiny actual-Three + actual-WGSL witness. No fake renderer or CPU output oracle.
export async function checkSmokeEnvironmentGpu(device){
 const renderer=new THREE.WebGPURenderer({device});await renderer.init();
 const scene=new THREE.Scene(),generator=new THREE.PMREMGenerator(renderer),rows=[];
 // Vendored Three's minimum PMREM LOD is a 16px cube face: use the
 // corresponding 64x32 equirectangular input, not an invalid 8px face.
 const rgb=[.25,.5,1],pixels=new Float32Array(64*32*4);
 for(let i=0;i<pixels.length;i+=4)pixels.set([...rgb,1],i);
 const image=new THREE.DataTexture(pixels,64,32,THREE.RGBAFormat,THREE.FloatType);image.mapping=THREE.EquirectangularReflectionMapping;image.needsUpdate=true;
 const pmrem=generator.fromEquirectangular(image);scene.environment=pmrem.texture;scene.environmentIntensity=2;
 const projection=createSceneSmokeEnvironment({renderer,scene,device}),source=device.createTexture({size:[4,8,4],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 let gather;
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 const near=(values,expected,message,tolerance=.015)=>assert(values.every((v,c)=>Number.isFinite(v)&&Math.abs(v-expected[c])<tolerance),`${message}: ${values} != ${expected}`);
 const upload=sigma=>{const data=new Float32Array(4*8*4*4);for(let i=3;i<data.length;i+=4)data[i]=sigma;device.queue.writeTexture({texture:source},data,{bytesPerRow:64,rowsPerImage:8},[4,8,4]);};
 const field={status:'encoded',texture:source,dimensions:[4,8,4],generation:1,frame:1};
 const sample=async(options)=>{const metadata=gather.encode(field,options);const read=await gather.readback();const value=Array.from(read.smoke.data.slice(0,3));rows.push({options:{gain:options.gain,environment:options.environment?.metadata??null},metadata,value});return value;};
 try{
  const previous=new THREE.RenderTarget(2,2);renderer.setRenderTarget(previous);renderer.toneMapping=THREE.ACESFilmicToneMapping;
  const environment=projection.frame();assert(renderer.getRenderTarget()===previous,'projection must restore host target');assert(renderer.toneMapping===THREE.ACESFilmicToneMapping,'projection must restore tone mapping');
  const pixelBuffer=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const copy=device.createCommandEncoder();copy.copyTextureToBuffer({texture:environment.texture,origin:[10,10]},{buffer:pixelBuffer,bytesPerRow:256},[1,1]);device.queue.submit([copy.finish()]);await pixelBuffer.mapAsync(GPUMapMode.READ);
  const projected=Array.from(new Uint16Array(pixelBuffer.getMappedRange()).slice(0,4),THREE.DataUtils.fromHalfFloat);pixelBuffer.unmap();pixelBuffer.destroy();
  rows.push({phase:'actual-projected-environment',projected});near(projected.slice(0,3),rgb.map(v=>v*2),'actual GPU environment projection');
  assert(projection.frame().metadata.generation===environment.metadata.generation,'unchanged environment must not project per frame');
  scene.backgroundIntensity=100;assert(projection.frame().metadata.generation===environment.metadata.generation,'background grading must not illuminate smoke');
  scene.environmentRotation.y=.3;assert(projection.frame().metadata.generation===environment.metadata.generation+1,'rotation must invalidate projection');
  renderer.setRenderTarget(null);previous.dispose();
  gather=createVolumeGather(device,{geometry:buildTriangleVisibility([]).packGpu(),receivers:[],volumeGrid:2,smokeRefinement:1,directions:8});
  upload(0);
  near(await sample({gain:0,environment:projection.frame()}),rgb.map(v=>v*2),'unoccluded mean scene radiance with zero fire gain');
  near(await sample({gain:9}),[0,0,0],'missing environment must clear prior sky');
  for(const pattern of ['spatial','source','guided']){
   gather.setAngularPattern(pattern);near(await sample({gain:0,environment:projection.frame()}),rgb.map(v=>v*2),`${pattern} full-sphere sky`);
  }
  gather.setAngularPattern('fixed');upload(1);
  const p=[-.5,-.5,-.5],hi=[1,3,1];
  const transmission=lightingDirections(8).reduce((sum,d)=>sum+Math.exp(-Math.min(...d.map((v,a)=>v>0?(hi[a]-p[a])/v:v<0?(-1-p[a])/v:Infinity))),0)/8;
  near(await sample({gain:0,environment:projection.frame()}),rgb.map(v=>v*2*transmission),'smoke must attenuate environment by Beer-Lambert');
  scene.environmentIntensity=0;assert(projection.frame()===null,'zero intensity must disable environment');
  scene.environmentIntensity=1;
  near(await sample({gain:0,environment:projection.frame()}),rgb.map(v=>v*transmission),'intensity edit must update actual texture');
  gather.destroy();gather=null;upload(0);
  // Enclosure lies outside the source volume: clipping visibility at its exit
  // would wrongly light every enclosed receiver.
  const box=new THREE.BoxGeometry(10,10,10),triangles=[],pos=box.attributes.position;
  for(let i=0;i<box.index.count;i+=3){const v=[];for(let j=0;j<3;j++){const n=box.index.getX(i+j);v.push([pos.getX(n),pos.getY(n),pos.getZ(n)]);}triangles.push({a:v[0],b:v[1],c:v[2]});}box.dispose();
  gather=createVolumeGather(device,{geometry:buildTriangleVisibility(triangles).packGpu(),receivers:[],volumeGrid:2,smokeRefinement:1,directions:8});
  for(const pattern of ['fixed','source','guided']){gather.setAngularPattern(pattern);near(await sample({gain:0,environment:projection.frame()}),[0,0,0],`${pattern} opaque enclosure blocks environment`);}
  gather.destroy();gather=null;upload(1);
  const partial=triangles.filter(t=>[t.a,t.b,t.c].every(p=>p[0]===5));
  assert(partial.length===2,'partial visibility fixture must contain the actual +X wall');
  for(const pattern of ['source','guided']){
   const geometry=buildTriangleVisibility(partial).packGpu();
   gather=createVolumeGather(device,{geometry,receivers:[],volumeGrid:2,smokeRefinement:1,directions:8,angularPattern:pattern});
   const cold=await sample({gain:0,environment:projection.frame()});gather.destroy();
   gather=createVolumeGather(device,{geometry,receivers:[],volumeGrid:2,smokeRefinement:1,directions:24,angularPattern:pattern});
   await sample({gain:0,environment:projection.frame()});gather.setDirections(8);
   const lowered=await sample({gain:0,environment:projection.frame()});
   near(lowered,cold,`${pattern} cold8 and retained24→8 must agree through partial visibility`,.00001);
   assert(lowered.some(x=>x>0),'partial wall must leave some sky visible');
   gather.destroy();gather=null;
  }
  return {identity:'actual-scene-pmrem-and-smoke-gather-v1',rows};
 }finally{gather?.destroy();projection.dispose();source.destroy();pmrem.dispose();image.dispose();generator.dispose();renderer.dispose();}
}
