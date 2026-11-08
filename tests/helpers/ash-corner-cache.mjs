// Shared by the production runtime GPU check; this file is not a test entry.
import assert from 'node:assert/strict';
export async function compareAshCornerCache({ctx,patch,attributes,source}){
 const {pathToFileURL}=await import('node:url'),load=p=>import(pathToFileURL(source+'/'+p));
 const {refinementVertexWGSL}=await load('ash/refinement-surface.mjs'),{refinementArena}=await load('ash/refinement-shader.mjs');
 const {device}=ctx,U=globalThis.GPUBufferUsage,p=patch.layout,a=refinementArena(p);
 await patch.deposit({blanketDepth:.14});
 const state=await patch.diagnostics(),count=state.stats.visibleFaces;assert.ok(count>0);
 const entries=[...attributes],mass=entries.find(([a])=>a.array instanceof Float32Array&&a.array.length===p.count)[1].buffer;
 const byLength=n=>entries.filter(([a])=>a.array instanceof Uint32Array&&a.array.length===n).map(x=>x[1].buffer);
 const [solid,next]=byLength(p.count),[limits]=byLength(p.count*2),[faces]=byLength(a.surfaceCache.words),[tree]=byLength(a.words.length);
 assert.ok(mass&&solid&&next&&limits&&faces&&tree,'the real runtime buffers must all be present');
 async function vertices(cached){
  const output=device.createBuffer({size:count*64,usage:U.STORAGE|U.COPY_SRC});const read=device.createBuffer({size:output.size,usage:U.COPY_DST|U.MAP_READ});
  try{
   const code=refinementVertexWGSL(p,a,{cached})+`
@group(0) @binding(0) var<storage,read> mass:array<f32>;
@group(0) @binding(1) var<storage,read> solid:array<u32>;
@group(0) @binding(2) var<storage,read> faces:array<u32>;
@group(0) @binding(3) var<storage,read> tree:array<u32>;
@group(0) @binding(4) var<storage,read> scratch:array<u32>;
@group(0) @binding(5) var<storage,read> pairs:array<u32>;
@group(0) @binding(6) var<storage,read_write> output:array<vec4<f32>>;
@compute @workgroup_size(64) fn compare(@builtin(global_invocation_id) id:vec3<u32>){let rank=id.x;if(rank>=${count}u){return;}for(var n=0u;n<4u;n++){output[rank*4u+n]=ash_refined_vertex(rank,vec2<f32>(f32(n&1u),f32(n>>1u)),1.0,&mass,&solid,&faces,&tree${cached?',&scratch,&pairs':''});}}
`;
   const module=await ctx.compileShaderModule({code,label:cached?'actual cached ash corners':'reference ash corners'});
   const layout=device.createBindGroupLayout({entries:[mass,solid,faces,tree,next,limits,output].map((_,binding)=>({binding,visibility:globalThis.GPUShaderStage.COMPUTE,buffer:{type:binding===6?'storage':'read-only-storage'}}))});
   const pipeline=await device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module,entryPoint:'compare'}}),group=device.createBindGroup({layout,entries:[mass,solid,faces,tree,next,limits,output].map((buffer,binding)=>({binding,resource:{buffer}}))});
   const e=device.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();e.copyBufferToBuffer(output,0,read,0,output.size);device.queue.submit([e.finish()]);await read.mapAsync(globalThis.GPUMapMode.READ);return new Float32Array(read.getMappedRange().slice(0));
  }finally{read.unmap();read.destroy();output.destroy();}
 }
 const original=await vertices(false),cached=await vertices(true);let maxNormalBytes=0;
 for(let i=0;i<original.length;i+=4){for(let axis=0;axis<3;axis++)assert.equal(cached[i+axis],original[i+axis],'cache preserves physical vertex position');const x=Math.round(original[i+3]),y=Math.round(cached[i+3]);assert.ok(Math.abs((x&255)-(y&255))<=1,'coverage stays within one quantization step');for(const shift of [8,16])maxNormalBytes=Math.max(maxNormalBytes,Math.abs(((x>>>shift)&255)-((y>>>shift)&255)));}
 assert.ok(maxNormalBytes<=4,`packed lighting drift ${maxNormalBytes}/255 exceeds the encoding tolerance`);
 console.log(JSON.stringify({surfaceFaces:count,maxNormalBytes,physicalVertices:'exact',coverageBytes:1}));
}
