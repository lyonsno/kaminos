import {createVolumeGather,sourceRaySample,integrateCellRay} from '../scene-volume-gather.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
export async function checkSourceAwareGPU(){
  const adapter=await navigator.gpu.requestAdapter();
  if(!adapter||adapter.isFallbackAdapter||/swiftshader/i.test(JSON.stringify(adapter.info)))throw new Error('native WebGPU required');
  const device=await adapter.requestDevice(),errors=[],outputs=[];
  device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const receivers=[
    {position:[0,1,2],normal:[0,0,-1]},
    {position:[0,1,0],normal:[0,0,1],twoSided:true},
    {position:[1,1,0],normal:[-1,0,0]},
    {position:[-1,3,-1],normal:[1,0,0],twoSided:true},
  ];
  const triangles=[{a:[-1,-1,.4],b:[1,-1,.4],c:[0,3,.4]}];
  const bvh=buildTriangleVisibility(triangles);
  const gather=createVolumeGather(device,{geometry:bvh.packGpu(),receivers,volumeGrid:2,directions:12,angularPattern:'source'});
  const dimensions=[4,8,4],source=new Float32Array(4*8*4*4);
  const texture=device.createTexture({size:dimensions,dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
  try{
    let frame=0;
    for(const [count,phase] of [[12,0],[16,1],[12,0],[24,2],[24,0]]){
      for(let z=0;z<4;z++)for(let y=0;y<8;y++)for(let x=0;x<4;x++){
        const i=(x+4*(y+8*z))*4;
        source.set(phase===2?[0,0,0,.2]:[x===phase?4:0,y/8,z/4,.2+x*.1],i);
      }
      device.queue.writeTexture({texture},source,{bytesPerRow:64,rowsPerImage:8},dimensions);
      gather.setDirections(count);
      const metadata=gather.encode({status:'encoded',texture,dimensions,localMax:[1,3,1],generation:1,frame:frame++},{smokeEnabled:false});
      const actual=await gather.readback(),expected=[],expectedBack=[];
      for(const r of receivers){
        const front=[0,0,0],back=[0,0,0];
        for(let a=0;a<count;a++){
          const s=sourceRaySample(r.position,a);
          const cosine=s.direction.reduce((v,d,i)=>v+d*r.normal[i],0);
          if(!r.twoSided&&cosine<=0)continue;
          const hit=bvh.trace(r.position,s.direction);
          const light=integrateCellRay(c=>source.slice((c[0]+4*(c[1]+8*c[2]))*4,(c[0]+4*(c[1]+8*c[2]))*4+4),dimensions,r.position,s.direction,hit?.distance??Infinity);
          const dest=cosine>=0?front:back;
          for(let c=0;c<3;c++)dest[c]+=Math.abs(cosine)*light[c]/(count*s.pdf);
        }
        expected.push(...front,1);expectedBack.push(...back,1);
      }
      let error=0;
      for(const [field,want] of [[actual.surface,expected],[actual.surfaceBack,expectedBack]])for(let i=0;i<want.length;i++){
        if(!Number.isFinite(field.data[i]))throw new Error('nonfinite native readback');
        error=Math.max(error,Math.abs(field.data[i]-want[i]));
      }
      outputs.push({count,phase,metadata,source:Array.from(source),expected,expectedBack,
        front:Array.from(actual.surface.data.slice(0,expected.length)),back:Array.from(actual.surfaceBack.data.slice(0,expectedBack.length)),maxError:error});
      if(error>0.002)throw new Error('source GPU/CPU mismatch '+error);
    }
    await device.queue.onSubmittedWorkDone();
    if(errors.length)throw new Error(errors.join('\n'));
    return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture},outputs,errors,status:'passed'};
  }catch(e){return {status:'failed',error:String(e),outputs,errors};}
  finally{gather.destroy();texture.destroy();device.destroy();}
}
