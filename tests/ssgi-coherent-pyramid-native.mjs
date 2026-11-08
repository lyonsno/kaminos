// kaminos-test: node
import assert from 'node:assert/strict';
import {globals} from 'webgpu';
import {DataUtils} from '../lib/three.webgpu.js';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createCoherentPyramidGPU,SSGI_COHERENT_PYRAMID_WGSL} from '../lib/addons/tsl/display/SSGICoherentPyramidGPU.js';
Object.assign(globalThis,globals);

async function exercise(device,width,height,kind){
 const maps=[],buffers=[];let kernel;
 try {
  const depth=new Float32Array(width*height),light=new Float32Array(width*height*4),normal=new Float32Array(light.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=y*width+x,thin=kind==='thin'&&x%2===0&&y%2===0;
   depth[i]=thin?.9:.99;light.set(thin?[20,0,0,1]:kind==='odd'?[i,0,2,1]:[0,0,2,1],i*4);normal.set(thin?[1,0,0,1]:[0,0,1,1],i*4);
   if(kind==='fan'){const a=[-50,0,50,50][i]*Math.PI/180;normal.set([Math.sin(a),0,Math.cos(a),1],i*4);}
  }
  const inputs=[depth,light,normal].map((data,i)=>{
   const t=device.createTexture({size:[width,height],format:i===0?'r32float':'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});maps.push(t);
   device.queue.writeTexture({texture:t},data,{bytesPerRow:width*(i===0?4:16)},[width,height]);return t;
  });
  const levels=Math.floor(Math.log2(Math.max(width,height)))+1;
  const outputs=['rgba32float','rgba16float','rgba16float'].map(format=>{const t=device.createTexture({size:[width,height],format,mipLevelCount:levels,usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});maps.push(t);return t;});
  kernel=createCoherentPyramidGPU(device);kernel.run(inputs,outputs,new Float32Array([-.1001,-1.001,1,0,.1,100,.05,.5,0,0,0,0]));
  const values=[];
  for(let i=0;i<3;i++){
   const buffer=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});buffers.push(buffer);
   const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:outputs[i],mipLevel:levels-1},{buffer,bytesPerRow:256},{width:1,height:1});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
   values.push(i===0?[...new Float32Array(buffer.getMappedRange(),0,4)]:[...new Uint16Array(buffer.getMappedRange(),0,4)].map(DataUtils.fromHalfFloat));buffer.unmap();
  }
  const [point,color,n]=values;
  assert.ok(Math.abs(point[0]-.99)<1e-5,'Coarse depth must remain on the selected real background layer');
  assert.ok(Math.abs(point[3]-(kind==='thin'?.75:1))<1e-5,'Selected layer coverage is retained');
  const px=Math.round(point[1]*width-.5),py=Math.round(point[2]*height-.5);
  assert.ok(px>=0&&px<width&&py>=0&&py<height);assert.ok(Math.abs(point[1]-(px+.5)/width)<1e-6&&Math.abs(point[2]-(py+.5)/height)<1e-6,'Representative position is an actual source pixel');
  if(kind==='thin')assert.ok(!(px%2===0&&py%2===0),'Representative UV belongs to retained background');
  assert.deepEqual(n.slice(0,3),[0,0,1]);assert.ok(Math.abs(color[0]-(kind==='odd'?(width*height-1)/2:0))<.01,'Light excludes the incompatible bright foreground and covers odd edge rows');assert.equal(color[2],2);
 } finally {kernel?.dispose();buffers.forEach(b=>b.destroy());maps.forEach(t=>t.destroy());}
}

await withKaminosGpu(async({device})=>{
 for(const fixture of [[4,4,'thin'],[3,5,'odd'],[1,5,'odd'],[1,1,'flat'],[2,2,'fan']])await exercise(device,...fixture);
 const faulty=new Proxy(device,{get(target,key){if(key==='createShaderModule')return descriptor=>target.createShaderModule({...descriptor,code:descriptor.code.replace('points[representative].xyz','vec3f(0.5)')});const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(()=>exercise(faulty,4,4,'thin'),/selected real background layer/,'A compiling phantom-depth fault must fail the numerical oracle');
},{wgslSources:['initialize','reduce'].map(entryPoint=>({label:'production-coherent-pyramid-'+entryPoint,code:SSGI_COHERENT_PYRAMID_WGSL,entryPoint}))});
