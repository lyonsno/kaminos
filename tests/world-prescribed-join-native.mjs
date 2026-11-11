// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {writeFile} from 'node:fs/promises';
import {createWorldSmoke, worldSmokePlan, intermediateSmokePlan} from '../volume-world-smoke.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';

// Tiny production dispatches, including transport, pressure restriction, Jacobi,
// projection and the uniform producer. No copied pressure implementation.
const transform = {translate:[0,0,0],scale:1};
const index = (c,d) => c[0]+d[0]*(c[1]+d[1]*c[2]);
function donor(c,a,plan,fineTransform=transform){
  return c.every((v,k)=>{
    const p=plan.min[k]+(v+.5+(k===a?.5:0))*plan.flowPitch;
    return p>=(fineTransform.lo?.[k]??fineTransform.translate[k]-fineTransform.scale)-1e-7
      && p<=(fineTransform.hi?.[k]??fineTransform.translate[k]+(k===1?3:1)*fineTransform.scale)+1e-7;
  });
}
function inspect(plan,before,after,fineTransform=transform){
  const dims=plan.flowDims;let donorChange=0,donorCount=0,exteriorBefore=0,exteriorAfter=0,exteriorCount=0;
  const face=(v,c,a)=>v[4*index(c.map((n,k)=>Math.max(0,Math.min(dims[k]-1,n))),dims)+a];
  for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){
    const c=[x,y,z];let db=0,da=0,free=false;
    for(let a=0;a<3;a++){
      if(donor(c,a,plan,fineTransform)){donorCount++;donorChange=Math.max(donorChange,Math.abs(face(after,c,a)-face(before,c,a)));}
      const prev=c.map((n,k)=>n-(k===a?1:0));
      free ||= !donor(c,a,plan,fineTransform)||!donor(prev,a,plan,fineTransform);
      db+=face(before,c,a)-face(before,prev,a);da+=face(after,c,a)-face(after,prev,a);
    }
    // The pre-existing World outer wall uses replicated lower faces. This
    // interface test measures free fluid away from that separate boundary.
    if(free&&c.every((v,k)=>v>0&&v<dims[k]-1)){exteriorCount++;exteriorBefore+=db*db;exteriorAfter+=da*da;}
  }
  return {donorChange,donorCount,exteriorBefore:Math.sqrt(exteriorBefore/exteriorCount),exteriorAfter:Math.sqrt(exteriorAfter/exteriorCount)};
}
async function fixture(ctx,{pressure=8,iterations=160,join='prescribed-flow',fineTransform=transform,solid=false,middle=false}={}){
  const {device}=ctx,resources=[],owned=[];
  const proxy=new Proxy(device,{get(t,k){
    if(k==='createBuffer')return d=>{const b=t.createBuffer(d);resources.push({label:d.label,buffer:b,size:d.size});return b;};
    const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;
  }});
  const plan=worldSmokePlan({flow:8,material:4,pressure,extent:2});
  const fineDims=[8,16,8],fineData=new Float32Array(8*16*8*16);
  for(let i=0;i<8*16*8;i++){fineData[16*i+1]=2;fineData[16*i+7]=1;}
  const fine=device.createBuffer({size:fineData.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(fine);
  device.queue.writeBuffer(fine,0,fineData);
  const reaction=device.createTexture({size:fineDims,dimension:'3d',format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING});owned.push(reaction);
  const solids=device.createTexture({size:plan.flowDims,dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(solids);
  if(solid){const mask=new Uint32Array(plan.flowCells);mask[index([4,6,4],plan.flowDims)]=1;device.queue.writeTexture({texture:solids},mask,{bytesPerRow:32,rowsPerImage:16},plan.flowDims);}
  device.pushErrorScope('validation');
  let field,intermediate;
  try{
    field=createWorldSmoke(proxy,plan,transform);
    const encoder=device.createCommandEncoder();
    const input={fineBuffer:fine,reactionTexture:reaction,fineDims,fineVelocityMode:'staggered',transform:fineTransform,time:{dtScale:0,backtraceScale:0},buoyancy:0,iterations,join};
    if(middle){intermediate=createWorldSmoke(device,intermediateSmokePlan(plan,{flow:6,material:6,extent:1.5}),transform,{exportFields:true});intermediate.encode(encoder,input);}
    const receipt=field.encode(encoder,{...input,intermediate,solids:solid?solids:undefined});
    const reads=resources.filter(r=>/^world smoke (flow [01]|pressure [01]|pressure rhs)/.test(r.label)).map(r=>{
      const read=device.createBuffer({size:r.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});owned.push(read);
      encoder.copyBufferToBuffer(r.buffer,0,read,0,r.size);return {...r,read};
    });
    device.queue.submit([encoder.finish()]);
    const arrays={};
    for(const r of reads){await r.read.mapAsync(GPUMapMode.READ);arrays[r.label]=Array.from(new Float32Array(r.read.getMappedRange()));r.read.unmap();}
    const validation=await device.popErrorScope();assert.equal(validation,null,validation?.message);
    const before=arrays['world smoke flow 1'],after=arrays['world smoke flow 0'];
    assert.ok(after.every(Number.isFinite),'all projected faces finite');
    return {plan,receipt,fineTransform,solid,middle,arrays,metrics:inspect(plan,before,after,intermediate?{lo:intermediate.plan.min,hi:intermediate.plan.max}:fineTransform)};
  }finally{field?.destroy();intermediate?.destroy();for(const r of owned)r.destroy();}
}
const runs=[];
test('Fine supplied faces survive World projection and the surrounding solve removes their exterior divergence',async()=>{
  try{
    await withKaminosGpu(async ctx=>{
      const result=await fixture(ctx);runs.push(result);
      assert.ok(result.metrics.donorCount>0);
      assert.ok(result.metrics.donorChange<1e-7,`prescribed Fine faces changed by ${result.metrics.donorChange}`);
      assert.ok(result.metrics.exteriorAfter<result.metrics.exteriorBefore*.1,JSON.stringify(result.metrics));
      assert.equal(result.receipt.join,'prescribed-flow');
      const baseline=await fixture(ctx,{join:'projected-donor'});runs.push(baseline);
      assert.ok(baseline.metrics.donorChange>.05,'the oracle must reject the former unconstrained projection');
      for(const pressure of [4,3,12]){
        const coarse=await fixture(ctx,{pressure});runs.push(coarse);
        assert.ok(coarse.metrics.donorChange<1e-7,`pressure ${pressure}: prescribed Fine faces`);
        assert.ok(coarse.metrics.exteriorAfter<coarse.metrics.exteriorBefore,`pressure ${pressure}: ${JSON.stringify(coarse.metrics)}`);
      }
      const shifted=await fixture(ctx,{fineTransform:{translate:[.125,.25,-.125],scale:.75}});runs.push(shifted);
      assert.ok(shifted.metrics.donorChange<1e-7,'fractional Fine placement preserves donated faces');
      assert.ok(shifted.metrics.exteriorAfter<shifted.metrics.exteriorBefore*.1,JSON.stringify(shifted.metrics));
      const obstacle=await fixture(ctx,{solid:true});runs.push(obstacle);
      const projected=obstacle.arrays['world smoke flow 0'];
      for(let a=0;a<3;a++){
        assert.equal(projected[4*index([4,6,4],obstacle.plan.flowDims)+a],0);
        const c=[4,6,4].map((n,k)=>n-(k===a?1:0));assert.equal(projected[4*index(c,obstacle.plan.flowDims)+a],0,'solids take precedence over the donor');
      }
      const middle=await fixture(ctx,{middle:true});runs.push(middle);
      assert.ok(middle.metrics.donorChange<1e-7,'World preserves the supplied Middle field through projection');
      assert.ok(middle.metrics.exteriorAfter<middle.metrics.exteriorBefore*.1,JSON.stringify(middle.metrics));
    },{onEvidence:e=>runs.push({evidence:e})});
  }finally{if(process.env.KAMINOS_JOIN_TEST_REPORT)await writeFile(process.env.KAMINOS_JOIN_TEST_REPORT,JSON.stringify({runs},null,2));}
});
