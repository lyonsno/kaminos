import {RepeatWrapping,MirroredRepeatWrapping,ClampToEdgeWrapping,NearestFilter,LinearFilter,NearestMipmapNearestFilter,NearestMipmapLinearFilter,LinearMipmapNearestFilter,LinearMipmapLinearFilter} from './lib/three.core.js';

export const SOURCE_MATERIAL_WGSL=/* wgsl */`
struct Params {color:vec4f, factors:vec4f, baseUV:array<vec4f,3>, roughUV:array<vec4f,3>, metalUV:array<vec4f,3>}
struct Answer {base:vec4f, factors:vec4f}
@group(0) @binding(0) var<storage,read> queries:array<vec4f>;
@group(0) @binding(1) var<uniform> params:Params;
@group(0) @binding(2) var base:texture_2d<f32>;
@group(0) @binding(3) var rough:texture_2d<f32>;
@group(0) @binding(4) var metal:texture_2d<f32>;
@group(0) @binding(5) var baseSampler:sampler;
@group(0) @binding(6) var roughSampler:sampler;
@group(0) @binding(7) var metalSampler:sampler;
@group(0) @binding(8) var<storage,read_write> answers:array<Answer>;
fn uv(p:vec2f,m:array<vec4f,3>)->vec2f{return m[0].xy*p.x+m[1].xy*p.y+m[2].xy;}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&queries)){return;}
 let p=queries[id.x].xy;
 let c=textureSampleLevel(base,baseSampler,uv(p,params.baseUV),0.0)*params.color;
 let r=textureSampleLevel(rough,roughSampler,uv(p,params.roughUV),0.0).g*params.factors.x;
 let m=textureSampleLevel(metal,metalSampler,uv(p,params.metalUV),0.0).b*params.factors.y;
 answers[id.x]=Answer(vec4f(c.rgb,1.0),vec4f(r,m,c.a,0.0));
}
`;
const IDENTITY=[1,0,0,0,1,0,0,0,1];
const finite=(a,n)=>a?.length===n&&Array.from(a).every(Number.isFinite);
const pipelines=new WeakMap();

export function sourceMaterialUniform(binding){
 if(!finite(binding.color,4)||binding.color.some(v=>v<0||v>1)||!finite([binding.roughness,binding.metalness],2)||[binding.roughness,binding.metalness].some(v=>v<0||v>1))throw Error('Physical source material factors required');
 const maps=[binding.base,binding.rough,binding.metal];
 for(const m of maps)if(!m?.texture||!m.sampler||!finite(m.transform,9)||m.transform[2]!==0||m.transform[5]!==0||m.transform[8]!==1)throw Error('Texture, sampler and affine UV transform required for each material channel');
 const params=new Float32Array(44);params.set(binding.color);params.set([binding.roughness,binding.metalness,0,0],4);
 maps.forEach((m,j)=>{for(let k=0;k<3;k++)params.set(m.transform.slice(k*3,k*3+3),8+j*12+k*4);});
 if(!params.every(Number.isFinite))throw Error('Material factors must be representable as float32');return params;
}

// Point material labels only: explicit LOD 0, no lighting or footprint integral.
// Textures are borrowed from the caller and are never destroyed by this query.
export async function sampleSourceMaterialPoints(device,binding,uvs){
 if(!device||!Array.isArray(uvs)||uvs.some(p=>!finite(p,2)))throw Error('WebGPU device and finite source UV pairs required');
 const params=sourceMaterialUniform(binding);
 if(!uvs.length)return [];
 const count=uvs.length,size=count*32;if(size>device.limits.maxStorageBufferBindingSize||size>device.limits.maxBufferSize||Math.ceil(count/64)>device.limits.maxComputeWorkgroupsPerDimension)throw Error('Source material query exceeds the active device capacity');
 const data=Float32Array.from(uvs.flatMap(p=>[...p,0,0])),maps=[binding.base,binding.rough,binding.metal];
 if(!data.every(Number.isFinite)||!params.every(Number.isFinite))throw Error('Material queries and factors must be representable as float32');
 const owned=[],allocate=(size,usage)=>{const b=device.createBuffer({size,usage});owned.push(b);return b;};device.pushErrorScope('validation');let open=true;
 try{
  let pipeline=pipelines.get(device);if(!pipeline){const module=device.createShaderModule({label:'TRELLIS source PBR point labels',code:SOURCE_MATERIAL_WGSL});const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});pipelines.set(device,pipeline);}
  const input=allocate(data.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),config=allocate(params.byteLength,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),output=allocate(size,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),read=allocate(size,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(input,0,data);device.queue.writeBuffer(config,0,params);
  const resources=[{buffer:input},{buffer:config},...maps.map(m=>m.texture.createView()),...maps.map(m=>m.sampler),{buffer:output}];
  const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:resources.map((resource,binding)=>({binding,resource}))}),encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();encoder.copyBufferToBuffer(output,0,read,0,size);device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);const values=new Float32Array(read.getMappedRange()).slice();read.unmap();const error=await device.popErrorScope();open=false;if(error)throw Error(error.message);if(!values.every(Number.isFinite))throw Error('Non-finite source material response');
  return Array.from({length:count},(_,i)=>({linearBaseColor:Array.from(values.subarray(i*8,i*8+3)),opacity:values[i*8+3],roughness:values[i*8+4],metalness:values[i*8+5],rawTextureFactorAlpha:values[i*8+6]}));
 }finally{if(open)await device.popErrorScope();for(const b of owned)b.destroy();}
}

// Reuses Three's effective GPU textures (including sRGB format and upload orientation).
// This adapter admits an opaque standard material; other material models fail visibly.
export function createSourceMaterialSampler(renderer,material){
 const device=renderer.backend?.device;if(!renderer.backend?.isWebGPUBackend||!device)throw Error('Shared WebGPU renderer required');
 const admit=()=>{
  if(!material?.isMeshStandardMaterial||material.isNodeMaterial||material.transparent||material.alphaTest||material.alphaHash||material.alphaToCoverage||material.alphaMap||material.opacity!==1||material.vertexColors||material.normalMap||material.bumpMap||material.displacementMap||material.aoMap||material.lightMap||material.emissiveMap||material.emissive?.getHex()!==0||material.isMeshPhysicalMaterial)throw Error('Source point sampler currently requires opaque standard PBR without additional material channels');
 };
 admit();let disposed=false,white,lastTextures=null;
 const fallback=()=>{if(!white){white=device.createTexture({label:'Source point label white fallback',size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});device.queue.writeTexture({texture:white},new Uint8Array([255,255,255,255]),{bytesPerRow:4},[1,1]);}return {texture:white,sampler:device.createSampler({magFilter:'linear',minFilter:'linear'}),transform:IDENTITY};};
 const address=new Map([[RepeatWrapping,'repeat'],[MirroredRepeatWrapping,'mirror-repeat'],[ClampToEdgeWrapping,'clamp-to-edge']]);
 const nearest=new Set([NearestFilter,NearestMipmapNearestFilter,NearestMipmapLinearFilter]),linear=new Set([LinearFilter,LinearMipmapNearestFilter,LinearMipmapLinearFilter]);
 const map=texture=>{
  if(!texture)return fallback();
  if(texture.channel!==0||texture.isCubeTexture||texture.isDataArrayTexture||texture.isData3DTexture||!address.has(texture.wrapS)||!address.has(texture.wrapT)||![...nearest,...linear].includes(texture.minFilter)||![NearestFilter,LinearFilter].includes(texture.magFilter))throw Error('Source point sampler requires supported 2D UV0 texture sampling');
  if(texture.matrixAutoUpdate)texture.updateMatrix();renderer.initTexture(texture);const data=renderer.backend.get(texture),gpu=data.texture;
  if(!gpu||gpu.width!==texture.image?.width||gpu.height!==texture.image?.height||gpu.dimension!=='2d')throw Error('Source texture upload is missing or a placeholder');
  return {texture:gpu,transform:Array.from(texture.matrix.elements),sampler:device.createSampler({addressModeU:address.get(texture.wrapS),addressModeV:address.get(texture.wrapT),magFilter:texture.magFilter===NearestFilter?'nearest':'linear',minFilter:nearest.has(texture.minFilter)?'nearest':'linear'})};
 };
 return {
  binding(){if(disposed)throw Error('Source material sampler is disposed');admit();const base=map(material.map),rough=map(material.roughnessMap),metal=map(material.metalnessMap);lastTextures=Object.fromEntries(Object.entries({base,rough,metal}).map(([k,m])=>[k,{width:m.texture.width,height:m.texture.height,format:m.texture.format,mipLevelCount:m.texture.mipLevelCount,transform:m.transform}]));return {color:[material.color.r,material.color.g,material.color.b,material.opacity],roughness:material.roughness,metalness:material.metalness,base,rough,metal};},
  async sample(uvs){return sampleSourceMaterialPoints(device,this.binding(),uvs);},
  read(){return {backend:'WebGPU',sampling:'explicit source texture LOD 0; no footprint or radiance integration',baseColorSpace:material.map?.colorSpace??'factor only',maps:{baseColor:!!material.map,roughness:!!material.roughnessMap,metalness:!!material.metalnessMap},effectiveTextures:lastTextures,disposed};},
  dispose(){if(disposed)return;disposed=true;white?.destroy();}
 };
}
