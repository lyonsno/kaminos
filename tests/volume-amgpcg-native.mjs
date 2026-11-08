// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
import {createAmgpcgPressure,amgpcgPlan,AMGPCG_SHADER_MODULES} from '../volume-amgpcg.mjs';

// Manufactured pressure and the canonical 7-point pressure operator supply
// an independent numerical oracle. These execute the complete production
// solver and existing-pressure buffer bridge, not a JavaScript solver model.
function problem(dims,{openTop=false,openWorld=false,obstacle=false,zero=false}={}){
 const count=dims.reduce((a,b)=>a*b,1),mask=new Uint32Array(count),expected=Float64Array.from({length:count},(_,i)=>zero?0:.015*Math.sin(i*.37)+.003*(i%dims[0]));
 const ix=(x,y,z)=>x+dims[0]*(y+dims[1]*z);
 if(obstacle)for(let z=2;z<4;z++)for(let y=2;y<5;y++)mask[ix(3,y,z)]=1;
 const apply=p=>Float64Array.from({length:count},(_,i)=>{
  if(mask[i])return 0;const c=[i%dims[0],Math.floor(i/dims[0])%dims[1],Math.floor(i/(dims[0]*dims[1]))];let v=0;
  for(let a=0;a<3;a++)for(const sign of [-1,1]){const q=[...c];q[a]+=sign;
   if(q[a]<0||q[a]>=dims[a]){if(openWorld||(openTop&&a===1&&sign===1))v+=p[i];}
   else{const j=ix(...q);if(!mask[j])v+=p[i]-p[j];}
  }return v;
 });
 const rhs=apply(expected),input=new Float32Array(count*4);
 rhs.forEach((v,i)=>input.set([-v,0,.75,.25],i*4));
 return {dims,count,mask,expected,rhs,input,apply,openTop,openWorld};
}
function residualRelative(p,values){const actual=p.apply(values);let error=0,norm=0;actual.forEach((v,i)=>{error+=(v-p.rhs[i])**2;norm+=p.rhs[i]**2;});return Math.sqrt(error/Math.max(norm,1e-30));}
function check(p,values){assert.ok(values.every(Number.isFinite),'pressure output must be finite');const r=residualRelative(p,values);assert.ok(r<2e-4,`relative pressure residual ${r}`);return r;}

test('AMGPCG manufactured solves cover open/closed, ragged grids, solids, warm starts and zero RHS',async()=>{
 await withKaminosGpu(async ctx=>{
  const rows=[];
  for(const [dims,options] of [[[8,12,8],{openTop:true}],[[8,8,8],{}],[[9,17,7],{openWorld:true,obstacle:true}],[[8,12,8],{openTop:true,zero:true}],[[8,12,8],{openTop:true,dispatchLimit:4}],[[16,16,16],{openTop:true,dispatchLimit:4}]]){
   // Force small multi-dimensional tiles while executing the real production
   // shaders on hardware. This tests index coverage, not an artificial device
   // capacity claim; actual WebGPU devices retain their baseline 65535 limit.
   const limits=options.dispatchLimit?new Proxy(ctx.device.limits,{get(target,key){return key==='maxComputeWorkgroupsPerDimension'?options.dispatchLimit:Reflect.get(target,key,target);}}):ctx.device.limits;
   const device=options.dispatchLimit?new Proxy(ctx.device,{get(target,key){if(key==='limits')return limits;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}):ctx.device;
   const p=problem(dims,options),owned=[];
   const buffer=(size,usage)=>{const b=device.createBuffer({size,usage});owned.push(b);return b;};
   const pressure=buffer(p.input.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC);
   const solid=device.createTexture({size:dims,dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});owned.push(solid);
   device.queue.writeTexture({texture:solid},p.mask,{bytesPerRow:dims[0]*4,rowsPerImage:dims[1]},dims);
   const solver=createAmgpcgPressure(device,dims),read=buffer(p.input.byteLength,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
   if(options.dispatchLimit)assert.ok(solver.plan.linearDispatch[dims[0]===16?2:1]>1,'native case must exercise tiled dispatch dimensions');
   try{
    for(const warm of [false,true]){
     p.expected.forEach((v,i)=>{p.input[i*4+1]=warm?v*.5:0;});device.queue.writeBuffer(pressure,0,p.input);
     let receipt;
     await withGpuErrorScopes(device,'complete AMGPCG solve',async()=>{
      const encoder=device.createCommandEncoder();receipt=solver.encode(encoder,{pressure,solid,openTop:p.openTop,openWorld:p.openWorld,iterations:14,warmStart:warm});encoder.copyBufferToBuffer(pressure,0,read,0,p.input.byteLength);device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();
     });
     await read.mapAsync(GPUMapMode.READ);const output=new Float32Array(read.getMappedRange()).slice();read.unmap();
     const values=Float32Array.from({length:p.count},(_,i)=>output[i*4+1]);
     const residual=check(p,values);
     for(let i=0;i<p.count;i++){assert.equal(output[i*4],p.input[i*4]);assert.equal(output[i*4+2],.75);assert.equal(output[i*4+3],.25);if(p.mask[i])assert.equal(values[i],0);}
     rows.push({dims,options,warm,residual,receipt});
    }
   }finally{solver.destroy();owned.forEach(x=>x.destroy());}
  }
  console.log('amgpcg-native-results:',JSON.stringify(rows));
 },{wgslSources:AMGPCG_SHADER_MODULES.flatMap(({code,entryPoints})=>entryPoints.map(entryPoint=>({code,entryPoint,label:`AMGPCG ${entryPoint}`})))});
});

test('numerical oracle rejects a valid finite blank answer to a nonzero pressure problem',()=>{
 const p=problem([8,12,8],{openTop:true});assert.throws(()=>check(p,new Float32Array(p.count)),/relative pressure residual/);
});

test('multigrid plan preserves ragged coverage and baseline workgroup/storage limits',()=>{
 const p=amgpcgPlan([9,17,7]);assert.deepEqual(p.levels.map(l=>l.dims),[[9,17,7],[5,9,4],[3,5,2]]);
 assert.throws(()=>amgpcgPlan([8,8,8],{maxStorageBufferBindingSize:64}),/buffer exceeds/);
});
