import {createVolumeGather,sourceRaySample,integrateCellRay} from '../scene-volume-gather.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
import {composeScatteredSource} from '../scene-volume-scattering.mjs';
export async function checkSourceAwareGPU(){
 const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.isFallbackAdapter)throw new Error('native WebGPU required');
 const device=await adapter.requestDevice(),errors=[],outputs=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 const receivers=[{position:[0,1,2],normal:[0,0,-1]},{position:[1,1,0],normal:[-1,0,0],twoSided:true}];
 const bvh=buildTriangleVisibility([{a:[-1,-1,.4],b:[1,-1,.4],c:[0,3,.4]}]);
 const gather=createVolumeGather(device,{geometry:bvh.packGpu(),receivers,volumeGrid:2,directions:12,angularPattern:'source'});
 const dimensions=[4,8,4],values=new Float32Array(4*8*4*4),sigmas=new Float32Array(4*8*4);
 const texture=device.createTexture({dimension:'3d',size:dimensions,format:'rgba32float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
 const scatteringTexture=device.createTexture({dimension:'3d',size:dimensions,format:'r32float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
 const sample=(data,c)=>{const i=(c[0]+4*(c[1]+8*c[2]))*4;return data.slice(i,i+4);};
 const expectedSurface=(data,count)=>receivers.flatMap(r=>{const out=[0,0,0];for(let a=0;a<count;a++){
  const ray=sourceRaySample(r.position,a),cosine=ray.direction.reduce((s,v,i)=>s+v*r.normal[i],0);if(cosine<=0)continue;
  const light=integrateCellRay(c=>sample(data,c),dimensions,r.position,ray.direction,bvh.trace(r.position,ray.direction)?.distance??Infinity);
  for(let k=0;k<3;k++)out[k]+=cosine*light[k]/(count*ray.pdf);
 }return out;});
 const compare=(got,want,name)=>{let error=0;for(let i=0;i<want.length;i++){if(!Number.isFinite(got[i])||!Number.isFinite(want[i]))throw Error('nonfinite '+name);error=Math.max(error,Math.abs(got[i]-want[i]));}if(error>.003)throw Error(name+' error '+error);return error;};
 try{
 let frame=0,baseline=null,lit=null;
 for(const [sigma,gain,on,count,emit]of [[0,1,false,12,1],[0,1,true,12,1],[.25,1,true,12,1],[.5,1,true,12,1],[.5,2,true,12,1],[.5,1,true,16,1],[.5,1,true,16,0],[.5,0,true,16,1],[.5,1,false,12,1]]){
  for(let i=0;i<sigmas.length;i++){values.set([2*emit,emit,.5*emit,.5],i*4);sigmas[i]=sigma;}
  device.queue.writeTexture({texture},values,{bytesPerRow:64,rowsPerImage:8},dimensions);device.queue.writeTexture({texture:scatteringTexture},sigmas,{bytesPerRow:16,rowsPerImage:8},dimensions);
  gather.setDirections(count);const metadata=gather.encode({status:'encoded',texture,scatteringTexture,scatteringGeneration:frame+1,dimensions,localMax:[1,3,1],generation:frame+1,frame:frame++},{gain,surfaceScattering:on});
  const actual=await gather.readback({includeScattering:on});let combined=new Float32Array(values.map((v,i)=>i%4===3?v:v*gain));let buildError=0;
  if(on){const pd=actual.preparedSmoke.dimensions,mean=actual.preparedSmoke.data;for(let z=0;z<4;z++)for(let y=0;y<8;y++)for(let x=0;x<4;x++){
   const i=x+4*(y+8*z),p=[x,y,z].map((c,a)=>Math.min(pd[a]-1,Math.floor((c+.5)/dimensions[a]*pd[a]))),at=(p[0]+pd[0]*(p[1]+pd[1]*p[2]))*4;
   combined.set(composeScatteredSource(Array.from(values.slice(i*4,i*4+4)),sigma,Array.from(mean.slice(at,at+3)),gain),i*4);
  }buildError=compare(actual.scatteredSource.data,combined,'scatter source');}
  const expected=expectedSurface(combined,count),front=receivers.flatMap((_,i)=>Array.from(actual.surface.data.slice(i*4,i*4+3))),error=compare(front,expected,'surface');
  const smoke=Array.from(actual.smoke.data);if(sigma===0&&gain===1&&count===12){if(!baseline)baseline={front,smoke};else{compare(front,baseline.front,'zero albedo restoration');compare(smoke,baseline.smoke,'unchanged smoke');}}
  if(sigma===.5&&gain===1&&count===12&&on)lit=front;
  if(sigma===.5&&gain===2&&on)compare(front,lit.map(x=>2*x),'master gain once');
  if(!emit||gain===0)compare(front,front.map(()=>0),'off response');
  outputs.push({sigma,gain,on,count,emit,metadata,front,expected,error,buildError,smoke,source:Array.from(values),scattering:Array.from(sigmas)});
 }
 if(!outputs[3].front.some((v,i)=>v>outputs[1].front[i]+.001))throw Error('albedo does not increase surface illumination');
 await device.queue.onSubmittedWorkDone();if(errors.length)throw Error(errors.join('\n'));return {status:'passed',adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture},outputs,errors};
 }catch(e){return {status:'failed',error:String(e),outputs,errors};}finally{gather.destroy();texture.destroy();scatteringTexture.destroy();device.destroy();}
}
