// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {SPLIT_OPTICAL_WGSL,createSplitIntegral,splitIntegralSettings} from '../volume-split-integral.mjs';

test('camera pull retrieves old-pixel source anchors through camera and flow motion',async()=>{
 await withKaminosGpu(async({device:d})=>{
  const owner=createSplitIntegral(d),storage=d.createBindGroupLayout({entries:[{binding:39,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'storage'}}]});
  const target=d.createTexture({size:[3,1],format:'rgba32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const module=d.createShaderModule({code:`
   fn worldInsideFine(p:vec3<f32>)->bool{return true;}
   fn worldToCell(p:vec3<f32>)->vec3<f32>{return p;}
   fn sampleFluidSlot(p:vec3<f32>,slot:u32)->vec4<f32>{return vec4<f32>(0,0,.1,0);}
   ${SPLIT_OPTICAL_WGSL}
   @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position)vec4<f32>{
    let p=array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));return vec4<f32>(p[i],0,1);
   }
   @fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0)vec4<f32>{
    let x=p.x/3.0*2.0-1.0-splitOptions.viewProj[3].x;
    let ro=vec3<f32>(x,0,-1);let rd=vec3<f32>(0,0,1);var r=splitInit(p.xy,ro,rd,0,2,.75);
    let t=splitSampleDepth(r,ro,rd,.5);
    let first=select(vec3<f32>(0,4,0),vec3<f32>(4,0,0),p.x<1.0);
    splitObserve(&r,0u,ro+rd*t,select(vec3<f32>(0),first,splitOptions.size.z==2u),0,t,0,select(2.0,1.0,splitOptions.size.z==2u),.2);
    if(splitOptions.size.z==2u){splitObserve(&r,1u,ro+rd*1.5,vec3<f32>(0,0,2),0,1.5,1,2,.2);}
    return splitFinish(r,u32(p.x),ro,rd);
   }`});
  assert.deepEqual((await module.getCompilationInfo()).messages.filter(x=>x.type==='error'),[]);
  const pipeline=d.createRenderPipeline({layout:d.createPipelineLayout({bindGroupLayouts:[storage,owner.emptyLayout,owner.emptyLayout,owner.layout]}),vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba32float'}]},primitive:{topology:'triangle-list'}});
  const vp=x=>[1,0,0,0,0,1,0,0,0,0,1,0,x,0,0,1];
  async function draw(mode,x,step=0,identity='same-source',cameraMotion='reproject'){
   const e=d.createCommandEncoder(),prepared=owner.prepare(e,{width:3,height:1,settings:{mode,fresh:1,memory:10000,opacityMemory:10000,response:0,exploration:0,footprint:.25,cameraMotion},identity,step,viewProj:vp(x),backtrace:.5,fineScale:1});
   const p=e.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store'}]});p.setPipeline(pipeline);p.setBindGroup(0,d.createBindGroup({layout:storage,entries:[{binding:39,resource:{buffer:owner.buffer}}]}));p.setBindGroup(1,owner.emptyGroup);p.setBindGroup(2,owner.emptyGroup);p.setBindGroup(3,prepared.group);p.draw(3);p.end();
   const read=d.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});e.copyTextureToBuffer({texture:target},{buffer:read,bytesPerRow:256},[3,1]);d.queue.submit([e.finish()]);
   try{await read.mapAsync(GPUMapMode.READ);return {state:prepared.state,rgba:Array.from(new Float32Array(read.getMappedRange()).slice(0,12)),records:(await owner.sample()).records};}finally{read.unmap();read.destroy();}
  }
  try{
   await draw('split',0);
   const moved=await draw('transport',2/3,1);
   assert.ok(moved.rgba[4]>3.9,'new middle pixel must retrieve the old left red source, not clear or retain the old green pixel');
   assert.ok(moved.rgba[6]>1.85,'independent rear source survives the same camera pull');
   assert.ok(Math.abs(moved.records[24+18]-.55)<1e-5,'rear anchor also follows the current flow');
   assert.equal(moved.state.reset,false);assert.equal(moved.state.cameraReprojected,true);
   const changed=await draw('transport',2/3,1,'different-source');assert.equal(changed.state.reset,true);assert.equal(changed.rgba[4],0);
   owner.reset();await draw('split',0,0,'same-source','reset');
   const reset=await draw('transport',2/3,0,'same-source','reset');assert.equal(reset.state.reset,true);assert.equal(reset.state.frames,1);assert.equal(reset.rgba[4],0);
   owner.reset();await draw('split',0);
   const unseen=await draw('transport',4);assert.ok(unseen.rgba.every((v,i)=>i%4===3?v===1:v===0),'off-screen source records cannot create a frozen frame in newly exposed space');
  }finally{owner.dispose();target.destroy();}
 });
});

test('camera history policy is explicit and rejects unknown values',()=>{
 assert.equal(splitIntegralSettings().cameraMotion,'reproject');
 assert.equal(splitIntegralSettings({cameraMotion:'reset'}).cameraMotion,'reset');
 assert.throws(()=>splitIntegralSettings({cameraMotion:'unknown'}),/camera/i);
});

test('camera history selector applies its string policy and respects comparison hold',async()=>{
 const {default:definition}=await import('../experiments/split-optical-transport.experiment.mjs');
 let held=false,view={position:[0,0,3]},applied;const records=[];
 const doc={activeElement:null};
 class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag;this.children=[];this.dataset={};this.style={};this.classList={contains:()=>false};}
  append(...els){this.children.push(...els);}prepend(...els){this.children.unshift(...els);}setAttribute(){}
  querySelectorAll(){const all=e=>[e,...e.children.flatMap(all)];return all(this).filter(e=>e.dataset.optical);}
 }
 doc.createElement=tag=>new Element(tag);doc.defaultView={__kaminosVolumePrototype:{setSplitIntegral:o=>{applied=o;},debugState:()=>({}),isIntegralEvaluationHeld:()=>held}};
 const session={onFrame:()=>()=>{},redraw(){},readView:()=>view,setView:v=>(view=v),dispose(){}};
 const owner=await definition.create({host:{scene:{open:async()=>session},controls:{document:doc,installNumberDrag:()=>null}},record:r=>records.push(r),updateInputs(){}});
 const root=new Element('div');owner.mount({root,document:doc,invoke:async(op,value)=>owner.operations[op](value)});
 const select=root.querySelectorAll().find(e=>e.dataset.optical==='cameraMotion');select.value='reset';select.dispatchEvent(new Event('change'));await Promise.resolve();
 assert.equal(applied.cameraMotion,'reset','UI choice must reach the same policy operation as agents');
 held=true;assert.throws(()=>owner.operations.setView({position:[1,0,3]}),/Resume history comparison/);assert.deepEqual(view,{position:[0,0,3]});
 held=false;owner.operations.setView({position:[1,0,3]});assert.deepEqual(view,{position:[1,0,3]});assert.equal(records.at(-1).kind,'optical-transport.camera');await owner.dispose();
});
