import {validateOpticalFrame} from './volume-temporal-material.mjs';

export function validateOpticalSequence(manifest){
 if(manifest?.schema!=='kaminos.optical-sequence.v1'||manifest.status!=='captured'||!Array.isArray(manifest.frames)||!manifest.frames.length)throw Error('Complete captured optical sequence required');
 if(manifest.source?.backend!=='WebGPU:apple'||!manifest.source?.presetId||!manifest.source?.commit)throw Error('Observed production source identity required');
 if(manifest.basis!=='cie-xyz-d65')throw Error('Declared positive CIE XYZ optical basis required');
 const validDimensions=d=>Array.isArray(d)&&d.length===3&&d.every(n=>Number.isSafeInteger(n)&&n>0);
 if(!validDimensions(manifest.dimensions)||!Array.isArray(manifest.bounds)||manifest.bounds.length!==2||!manifest.bounds.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))||manifest.bounds[1].some((x,a)=>x<=manifest.bounds[0][a]))throw Error('Valid optical dimensions and physical bounds required');
 if(manifest.reconstructions&&(!validDimensions(manifest.reconstructionDimensions)||Object.entries(manifest.reconstructions).some(([mode,rows])=>!['single','forward','future'].includes(mode)||!Array.isArray(rows)||rows.length!==manifest.frames.length)))throw Error('Complete reconstruction dimensions and modes required');
 let previous=-Infinity;
 for(const f of manifest.frames){
  if(!Number.isSafeInteger(f.step)||f.step<=previous||!f.optical?.sha256||!f.velocity?.sha256)throw Error('Unique increasing simulation steps and retained field hashes required');
  previous=f.step;
 }
 return manifest;
}

export async function loadOpticalSequence(url,fetcher=fetch){
 const response=await fetcher(url);if(!response.ok)throw Error('Sequence manifest HTTP '+response.status);
 const manifest=validateOpticalSequence(await response.json()),base=new URL(url,globalThis.location?.href??'http://localhost/');
 const resolve=path=>{
  if(typeof path!=='string'||!path||path.startsWith('/')||path.split('/').includes('..'))throw Error('Relative retained field path required');
  if(base.pathname==='/api/read'){
   const result=new URL(base),parent=base.searchParams.get('path');
   if(!parent||!base.searchParams.get('root'))throw Error('Mounted manifest root and path required');
   result.searchParams.set('path',parent.slice(0,parent.lastIndexOf('/')+1)+path);return result;
  }return new URL(path,base);
 };
 const array=async (entry,count)=>{
  if(!entry?.sha256)throw Error('Retained field hash required');
  const response=await fetcher(resolve(entry.path));if(!response.ok)throw Error('Sequence field HTTP '+response.status);
  const bytes=await response.arrayBuffer();if(bytes.byteLength!==count*4)throw Error('Incomplete sequence field');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==entry.sha256)throw Error('Sequence field hash mismatch');return new Float32Array(bytes);
 };
 const n=manifest.dimensions.reduce((a,x)=>a*x,1),frames=[];
 for(const row of manifest.frames){
  const frame={time:row.step,dimensions:manifest.dimensions,bounds:manifest.bounds,optical:await array(row.optical,n*4),velocity:await array(row.velocity,n*3)};
  frames.push(validateOpticalFrame(frame));
 }
 const modes={native:frames};
 if(manifest.reconstructions)for(const [mode,rows]of Object.entries(manifest.reconstructions)){
  if(rows.length!==frames.length)throw Error('Incomplete reconstruction sequence');
  const d=manifest.reconstructionDimensions,count=d.reduce((a,x)=>a*x,1);
  modes[mode]=[];
  for(let i=0;i<rows.length;i++){
   if(rows[i].step!==frames[i].time)throw Error('Reconstruction/source time mismatch');
   const optical=await array(rows[i],count*4);if(!optical.every(x=>Number.isFinite(x)&&x>=0))throw Error('Invalid reconstructed optical field');
   modes[mode].push({time:frames[i].time,dimensions:d,bounds:manifest.bounds,optical});
  }
 }
 return {manifest,frames,modes};
}

// Capture the production optical source and exported base flow on one held
// simulation step. Velocity is converted from fluid-cell displacement to the
// optical volume's physical coordinates per simulation step.
export async function captureOpticalSequenceFrame(prototype,device){
 const before=prototype.debugState(),producer=prototype.joinedProducerState(),source=prototype.sceneVolumeSourceField();
 if(before.backend!=='WebGPU:apple'||source.status!=='encoded'||!producer.fluidBuffer)throw Error('Active encoded native optical source and fluid producer required');
 const readback=device.createBuffer({label:'temporal optical base-flow capture',size:producer.fluidBuffer.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 let fluid;
 try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(producer.fluidBuffer,0,readback,0,readback.size);device.queue.submit([encoder.finish()]);await readback.mapAsync(GPUMapMode.READ);fluid=new Float32Array(readback.getMappedRange()).slice();readback.unmap();}finally{readback.destroy();}
 const captured=await prototype.sampleSceneVolumeSource(),after=prototype.debugState();
 if(after.simStepCount!==before.simStepCount||captured.generation!==source.generation||captured.frame!==source.frame)throw Error('Source changed during optical sequence capture');
 const dims=captured.dimensions,n=dims.reduce((a,x)=>a*x,1),velocity=new Float32Array(n*3),fd=producer.dims;
 if(fluid.length!==fd.reduce((a,x)=>a*x,16))throw Error('Unexpected production fluid-cell layout');
 const scale=producer.timeStep.backtraceScale*producer.pitch;
 const staggered=before.velocityStaggering?.effective?.mode==='staggered';
 for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){
  const id=x+dims[0]*(y+dims[1]*z),point=[x,y,z].map((v,a)=>(v+.5)*fd[a]/dims[a]);
  for(let a=0;a<3;a++){
   const q=point.map((v,c)=>v-(staggered&&a===c?1:.5)),base=q.map(Math.floor),f=q.map((v,c)=>v-base[c]);let v=0;
   for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
    const off=[dx,dy,dz],c=base.map((v,k)=>Math.max(0,Math.min(fd[k]-1,v+off[k]))),w=off.reduce((w,v,k)=>w*(v?f[k]:1-f[k]),1);
    v+=fluid[(c[0]+fd[0]*(c[1]+fd[1]*c[2]))*16+a]*w;
   }velocity[id*3+a]=v*scale;
  }
 }
 const frame={time:before.simStepCount,dimensions:dims,bounds:[source.localMin,source.localMax],optical:Float32Array.from(captured.values),velocity};
 // Preserve the producer's exact raw coefficients before the reconstruction
 // validates them. Invalid captures remain diagnostic evidence, never inputs
 // silently clamped into an admitted reconstruction.
 return {...frame,identity:{backend:before.backend,step:before.simStepCount,frame:source.frame,generation:source.generation,fluidDimensions:fd,timeStep:producer.timeStep,velocity:'exported-base-flow; face-centred interpolation when declared; wavelet perturbations not included'}};
}
