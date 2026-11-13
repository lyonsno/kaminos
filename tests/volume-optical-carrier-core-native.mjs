// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {withKaminosGpu} from '../tools/shader-herder.mjs';
import {createOpticalParticles,opticalParticleSettings} from '../volume-optical-particles.mjs';
import {createOpticalCarrierSource} from '../volume-optical-carrier-core.mjs';

test('source-born optical route has explicit births, grid refresh, held state and no chemistry/exchange/acquisition',async()=>withKaminosGpu(async({device:d})=>{
 const owner=createOpticalParticles(d,{transparent:true}),resources=[];
 const buffer=(size,usage)=>{const b=d.createBuffer({size,usage});resources.push(b);return b;};
 const texture=descriptor=>{const t=d.createTexture(descriptor);resources.push(t);return t;};
 const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC,identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 const sourceOwner=createOpticalCarrierSource(d),source=sourceOwner.prepare({viewProj:identity,step:0,backtrace:1,pitch:1,staggered:false,outputWidth:8,outputHeight:8,displayWidth:8,displayHeight:8,coarsePresent:true,emitterBounds:{lo:[-.1,-.1,-.1],hi:[.1,.1,.1]}});
 const fine=buffer(8*64,storage),reactants=texture({size:[2,2,2],dimension:'3d',format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 const target=texture({size:[8,8],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),depth=texture({size:[1,1],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
 const camera=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,1,1,0,8,8,1,0]);
 const material=new Float32Array(8*16),oxygen=new Float32Array(16);for(let i=0;i<8;i++){material.set([.2,.8,1,0],i*16+4);oxygen[i*2]=3;}
 d.queue.writeBuffer(fine,0,material);d.queue.writeTexture({texture:reactants},oxygen,{bytesPerRow:16,rowsPerImage:2},[2,2,2]);
 const settings={enabled:true,carrierMode:1,capacity:4,acquisitionMode:1,acquisitionEnabled:false,exchangeEnabled:false,groupingEnabled:false,followFraction:0,carrierRate:2,carrierLifetime:4,carrierEaseIn:0,carrierEaseOut:0,flow:0};
 async function draw(step,patch={}){source.step=step;const e=d.createCommandEncoder(),p=e.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});p.end();const passes=[];owner.encode(e,{view:target.createView(),format:'rgba8unorm',source,fine,reactants,dims:[2,2,2],invViewProj:identity,settings:{...settings,...patch},cameraValues:camera,depth,identity:'clean-carrier-fixture',profileWrites:name=>{passes.push(name);return{};}});d.queue.submit([e.finish()]);await d.queue.onSubmittedWorkDone();return {...await owner.sample(),passes};}
 try{
  const a=await draw(0);assert.equal(a.records.filter((v,i)=>i%24===3&&v>0).length,0);
  const b=await draw(1);assert.equal(b.records.filter((v,i)=>i%24===3&&v>0).length,2);assert.equal(b.state.carrier.totalBirths,2);assert.equal(b.state.carrier.rayAcquisition,false);assert.equal(b.state.exchange,null);assert.equal(b.passes.includes('births'),false);
  assert.ok(b.state.lightingSource.revision>a.state.lightingSource.revision,'carrier advancement invalidates live lighting');
  for(let i=0;i<2;i++)assert.deepEqual(Array.from(b.records.slice(i*24+20,i*24+24)).map(x=>Math.round(x*10)),[10,8,2,30]);
  const held=await draw(1,{carrierStrain:5,carrierRotation:3});assert.deepEqual(held.records,b.records);assert.equal(held.passes.includes('update'),false);assert.equal(held.state.carrier.requestedBirths,0);
  assert.deepEqual(held.deformation,b.deformation,'paused shape is held too');
  for(let i=0;i<8;i++)material[i*16]=((i>>1)&1)*.5;
  d.queue.writeBuffer(fine,0,material);
  const sheared=await draw(2,{carrierRate:0,carrierRelaxation:0});assert.ok(Math.abs(sheared.deformation[4])>.4,'actual trilinear velocity gradient shears support even with stationary centers');assert.deepEqual(sheared.records.slice(0,3),b.records.slice(0,3));
  material[4]=.9;for(let i=0;i<8;i++)material[i*16+4]=.9;d.queue.writeBuffer(fine,0,material);
  const refreshed=await draw(3,{carrierRate:0});assert.ok(Math.abs(refreshed.records[22]-.9)<1e-6,'material follows current grid rather than a local reaction');
  const retired=await draw(6,{carrierRate:0});assert.equal(retired.records.filter((v,i)=>i%24===3&&v>0).length,0);
  material.fill(0);for(let i=0;i<8;i++){material[i*16+6]=1;oxygen[i*2+1]=.1;}d.queue.writeBuffer(fine,0,material);d.queue.writeTexture({texture:reactants},oxygen,{bytesPerRow:16,rowsPerImage:2},[2,2,2]);owner.reset();await draw(0);const clean=await draw(1);assert.ok(clean.records[8]+clean.records[9]+clean.records[10]>0,'fresh grid burn emits even without soot');
  assert.throws(()=>opticalParticleSettings({...settings,fillExtinction:1,depthMode:2}),/does not run/);
 }finally{owner.dispose();sourceOwner.dispose();resources.forEach(r=>r.destroy());}
}));
