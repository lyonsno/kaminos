// kaminos-test: node
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// Exercise the shipped internal backend utility, without a second implementation.
const source=(await readFile(new URL('../lib/three.webgpu.js',import.meta.url),'utf8')).replaceAll("'./three.core.js'",JSON.stringify(new URL('../lib/three.core.js',import.meta.url).href));
const {WebGPUPipelineUtils,MeshBasicMaterial}=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {WebGPUPipelineUtils};').toString('base64'));
async function exercise(order){
 const data=new Map(),submitted=[],pending=[],scopes=[],popped=[];
 const device={createPipelineLayout:()=>({}),pushErrorScope(){scopes.push({index:submitted.length,error:submitted.length===0?{message:'A validation'}:null});},popErrorScope(){const s=scopes.pop();popped.push(s.index);return Promise.resolve(s.error);},
 createRenderPipeline(d){submitted.push(structuredClone(d));return {};},
 createRenderPipelineAsync(d){submitted.push(structuredClone(d));return new Promise(resolve=>pending.push(resolve));}};
 const backend={device,get(o){if(!data.has(o))data.set(o,{});return data.get(o);},attributeUtils:{createShaderVertexBuffers:()=>[]},utils:{getCurrentColorFormat:()=> 'rgba8unorm',getCurrentDepthStencilFormat:()=> 'depth24plus',getSampleCountRenderContext:()=>1}};
 const utility=new WebGPUPipelineUtils(backend);
 utility._getPrimitiveState=()=>({topology:'triangle-list'});utility._getDepthCompare=()=> 'less';utility._getColorWriteMask=()=>15;utility._reportShaderDiagnostics=async()=>{};
 const object=(name,depth)=>{const material=new MeshBasicMaterial();material.name=name;const pipeline={vertexProgram:{},fragmentProgram:{}};backend.get(pipeline.vertexProgram).module={module:{}};backend.get(pipeline.fragmentProgram).module={module:{}};return {object:{},geometry:{},material,pipeline,context:{textures:null,depth,stencil:false},getBindings:()=>[]};};
 const a=object('A',true),b=object('B',false),producer=object('producer',false),promises=[];
 utility.createRenderPipeline(a,promises);utility.createRenderPipeline(b,promises);utility.createRenderPipeline(producer,null);
 // Capture assertions after settlement so a pre-fix failure never strands work.
 for(const index of order){pending[index]({});await new Promise(r=>setImmediate(r));}
 await Promise.all(promises);
 assert.equal(submitted[0].depthStencil.format,'depth24plus');
 assert.equal(submitted[1].depthStencil,undefined,'depth-free async pipeline must not inherit a pending surface descriptor');
 assert.equal(submitted[2].depthStencil,undefined,'depth-free cold producer must not inherit a pending surface descriptor');
 assert.deepEqual(popped,[0,1,2],'scope ownership is sealed at submission, independent of native completion order');
 assert.equal(backend.get(a.pipeline).error,true);assert.notEqual(backend.get(b.pipeline).error,true,'A validation must not disable B');
}
try {await exercise([0,1]);await exercise([1,0]);} catch(error) {console.error(error.message);process.exitCode=1;}
console.log('PASS actual backend submission state and error ownership across both completion orders');
