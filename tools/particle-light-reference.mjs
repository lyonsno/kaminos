// Offline reference/readback only; never imported by the serving renderer.
export async function readLightBuffer(device,buffer){
 const copy=device.createBuffer({size:buffer.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 try{const e=device.createCommandEncoder();e.copyBufferToBuffer(buffer,0,copy,0,buffer.size);device.queue.submit([e.finish()]);await copy.mapAsync(GPUMapMode.READ);return new Float32Array(copy.getMappedRange().slice(0));}finally{copy.unmap();copy.destroy();}
}
export async function readLightCoefficients(device,owner){
 const {dims:[nx,ny,nz],atlas:[w,h]}=owner.plan,pitch=Math.ceil(w*8/256)*256;
 const copy=device.createBuffer({size:pitch*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 try{const e=device.createCommandEncoder();e.copyTextureToBuffer({texture:owner.coefficients},{buffer:copy,bytesPerRow:pitch},[w,h]);device.queue.submit([e.finish()]);await copy.mapAsync(GPUMapMode.READ);const raw=new Float16Array(copy.getMappedRange().slice(0)),out=new Float32Array(nx*ny*nz*4);for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)for(let a=0;a<4;a++)out[4*(x+nx*(y+ny*z))+a]=raw[y*pitch/2+4*(x+nx*z)+a];return out;}finally{copy.unmap();copy.destroy();}
}
// An independent ray for each requested receiver. This deliberately repeats
// upstream cells rather than using a recurrence from a neighboring receiver.
export function referenceLightAt(c,solids,dims,at,reverse=false){
 const [nx,ny,nz]=dims,[x,y,z]=at,index=k=>x+nx*(y+ny*k),result=[0,0,0,1];
 for(let step=0;step<nz;step++){
  const k=z+(reverse?step:-step);if(k<0||k>=nz)break;const i=index(k);
  if(solids[i]){result[3]=0;break;}
  const fraction=step===0?.5:1,tau=c[4*i+3]*fraction,T=Math.exp(-tau),phi=tau>1e-9?-Math.expm1(-tau)/tau:1;
  for(let a=0;a<3;a++)result[a]+=result[3]*c[4*i+a]*fraction*phi;
  result[3]*=T;
 }
 return result;
}
