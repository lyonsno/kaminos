import {PerspectiveCamera,WebGPUCoordinateSystem,Matrix4} from './lib/three.core.js';
import {buildTriangleVisibility} from './scene-light-visibility.mjs';
import {SURFACE_TEACHER_IMAGE_WGSL,SURFACE_TEACHER_QUERY_WGSL,SURFACE_TEACHER_HISTORY_WGSL,SURFACE_TEACHER_FILTER_WGSL} from './surface-teacher-wgsl.mjs';

const finite3=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
export class SurfaceTeacher {
 constructor(device,{triangles,materials,lights=[],environment=.15,bounces=3}) {
  this.device=device;this.resources=[];this.targets=[];this.pipelines={};this.disposed=false;this.serial=0;this.samples=0;this.valid=false;
  this.params=this.buffer('surface teacher parameters',new Float32Array(44),GPUBufferUsage.UNIFORM);
  this.historyParams=this.buffer('surface teacher history parameters',new Float32Array(20),GPUBufferUsage.UNIFORM);
  this.filterParams=[1,2,4].map(step=>this.buffer('surface teacher wavelet step',new Float32Array([step,.01,0,0]),GPUBufferUsage.UNIFORM));
  for(const [name,code]of Object.entries({image:SURFACE_TEACHER_IMAGE_WGSL,query:SURFACE_TEACHER_QUERY_WGSL,history:SURFACE_TEACHER_HISTORY_WGSL,filter:SURFACE_TEACHER_FILTER_WGSL})){
   this.pipelines[name]=device.createComputePipeline({label:`surface teacher ${name}`,layout:'auto',compute:{module:device.createShaderModule({label:`surface teacher ${name}`,code}),entryPoint:'main'}});
  }
  this.setScene({triangles,materials,lights});this.setTransport({environment,bounces});
 }
 buffer(label,data,usage=GPUBufferUsage.STORAGE){
  if(data.byteLength>this.device.limits.maxBufferSize||(usage&GPUBufferUsage.STORAGE)&&data.byteLength>this.device.limits.maxStorageBufferBindingSize)throw Error(`${label} exceeds the active device's buffer capacity`);
  const buffer=this.device.createBuffer({label,size:Math.max(16,data.byteLength),usage:usage|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(buffer,0,data);this.resources.push(buffer);return buffer;
 }
 setScene({triangles,materials,lights=[]}){
  if(!Array.isArray(materials)||!materials.length||materials.some(m=>!finite3(m.color)||m.color.some(v=>v<0||v>1)||!Number.isFinite(m.roughness)||m.roughness<0||m.roughness>1||!Number.isFinite(m.metalness)||m.metalness<0||m.metalness>1))throw Error('physical material colors, roughness and metalness required');
  if(lights.some(l=>!finite3(l.position)||!finite3(l.color)||l.color.some(v=>v<0)||!['directional','point','spot'].includes(l.type)||l.type==='directional'&&Math.hypot(...l.position)===0||l.type==='spot'&&(!finite3(l.direction)||!Number.isFinite(l.angle)||l.angle<=0||l.angle>=Math.PI/2||!Number.isFinite(l.penumbra)||l.penumbra<0||l.penumbra>1)))throw Error('finite directional, inverse-square point or spot lights required');
  if(triangles.some(t=>!Number.isSafeInteger(t.materialIndex)||t.materialIndex<0||t.materialIndex>=materials.length))throw Error('each triangle must address an existing material');
  const packed=buildTriangleVisibility(triangles).packGpu();
  for(let i=0;i<packed.triangleCount;i++)packed.triangles[i*12+3]=triangles[packed.triangleIndices[i]].materialIndex;
  const materialData=new Float32Array(materials.length*8);materials.forEach((m,i)=>materialData.set([...m.color,1,m.roughness,m.metalness,0,0],i*8));
  const lightData=new Float32Array(Math.max(1,lights.length)*16);lights.forEach((l,i)=>lightData.set([...l.position,l.type==='spot'?2:l.type==='point'?1:0,...l.color,0,...(l.direction??[0,0,-1]),Math.cos(l.angle??0),Math.cos((l.angle??0)*(1-(l.penumbra??0))),0,0,0],i*16));
  const next=[this.buffer('surface teacher BVH nodes',packed.nodes),this.buffer('surface teacher triangles',packed.triangles),this.buffer('surface teacher materials',materialData),this.buffer('surface teacher lights',lightData)];
  for(const buffer of this.sceneBuffers||[]){buffer.destroy();this.resources.splice(this.resources.indexOf(buffer),1);}this.sceneBuffers=next;this.lightCount=lights.length;this.triangleCount=packed.triangleCount;this.reset('source or lighting changed');
 }
 setTransport({environment=this.environment,bounces=this.bounces}){
  if(!Number.isFinite(environment)||environment<0||!Number.isSafeInteger(bounces)||bounces<1)throw Error('nonnegative environment and positive integer path depth required');
  if(environment!==this.environment||bounces!==this.bounces){this.environment=environment;this.bounces=bounces;this.reset('transport changed');}
 }
 reset(reason='explicit'){this.valid=false;this.samples=0;this.resetReason=reason;}
 group(pipeline,resources){return this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:resources.map((resource,binding)=>({binding,resource:resource?.createView?resource.createView():{buffer:resource}}))});}
 common(){return [...this.sceneBuffers,this.params];}
 writeParams({view,width=1,height=1,frame=this.serial,previousVP=this.previousVP}={}){
  const data=new Float32Array(44),words=new Uint32Array(data.buffer);let vp=null;
  if(view){
   if(!finite3(view.position)||!finite3(view.target)||!finite3(view.up??[0,1,0]))throw Error('finite shared camera view required');
   const camera=new PerspectiveCamera(view.fov??45,width/height,view.near??.01,view.far??100);camera.coordinateSystem=WebGPUCoordinateSystem;camera.zoom=view.zoom??1;camera.position.fromArray(view.position);camera.up.fromArray(view.up??[0,1,0]);camera.lookAt(...view.target);camera.updateMatrixWorld(true);camera.updateProjectionMatrix();
   vp=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);data.set(vp.clone().invert().elements,0);data.set((previousVP??vp).elements,16);data.set(view.position,32);
  }
  words.set([width,height,frame,this.bounces],36);data.set([0,0,this.environment,this.lightCount],40);this.device.queue.writeBuffer(this.params,0,data);return vp;
 }
 async evaluate(queries,{sample=0}={}){
  if(this.disposed)throw Error('surface teacher is disposed');
  if(!Array.isArray(queries)||!queries.length||queries.some(q=>!finite3(q.origin)||!finite3(q.direction)||Math.hypot(...q.direction)===0))throw Error('nonempty finite ray queries required');
  const data=new Float32Array(queries.length*8);queries.forEach((q,i)=>data.set([...q.origin,0,...q.direction,0],i*8));
  const input=this.buffer('surface teacher ray queries',data);const output=this.buffer('surface teacher raw linear answers',new Float32Array(queries.length*4),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
  const read=this.device.createBuffer({size:queries.length*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
   this.writeParams({frame:sample});const encoder=this.device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setPipeline(this.pipelines.query);pass.setBindGroup(0,this.group(this.pipelines.query,[...this.common(),input,output]));pass.dispatchWorkgroups(Math.ceil(queries.length/64));pass.end();encoder.copyBufferToBuffer(output,0,read,0,queries.length*16);this.device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
   const values=new Float32Array(read.getMappedRange()).slice();return Array.from({length:queries.length},(_,i)=>Array.from(values.subarray(i*4,i*4+4)));
  }finally{read.destroy();for(const b of [input,output]){b.destroy();this.resources.splice(this.resources.indexOf(b),1);}}
 }
 resize(width,height){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>this.device.limits.maxTextureDimension2D||height>this.device.limits.maxTextureDimension2D)throw Error('image extent exceeds the active device capacity');
  if(width===this.width&&height===this.height)return;
  for(const texture of this.targets)texture.destroy();this.targets=[];
  const texture=label=>{const value=this.device.createTexture({label,size:[width,height],format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});this.targets.push(value);return value;};
  this.raw=texture('surface teacher raw image');this.histories=[texture('surface teacher history A'),texture('surface teacher history B')];this.points=[texture('surface teacher point A'),texture('surface teacher point B')];this.normals=[texture('surface teacher normal A'),texture('surface teacher normal B')];this.filtered=[texture('surface teacher filtered A'),texture('surface teacher filtered B')];this.width=width;this.height=height;this.index=0;this.reset('image extent changed');
 }
 render({view,width,height,filter=true}){
  if(this.disposed)throw Error('surface teacher is disposed');this.resize(width,height);
  const key=JSON.stringify(view),moving=this.viewKey!==undefined&&key!==this.viewKey;
  const vp=this.writeParams({view,width,height});const historyData=new Float32Array(20);historyData.set((this.previousVP??vp).elements);historyData.set([this.valid?1:0,moving?1:0,Math.max(.002,Math.hypot(...view.position)*4/height),0],16);this.device.queue.writeBuffer(this.historyParams,0,historyData);
  const i=this.index,j=1-i,encoder=this.device.createCommandEncoder({label:'surface teacher image and reconstruction'});
  const dispatch=(name,resources)=>{const pipeline=this.pipelines[name],pass=encoder.beginComputePass({label:`surface teacher ${name}`});pass.setPipeline(pipeline);pass.setBindGroup(0,this.group(pipeline,resources));pass.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8));pass.end();};
  dispatch('image',[...this.common(),this.raw,this.points[i],this.normals[i]]);
  dispatch('history',[this.raw,this.points[i],this.normals[i],this.histories[j],this.points[j],this.normals[j],this.histories[i],this.historyParams]);
  let output=this.histories[i];if(filter){for(let step=0;step<3;step++){const target=this.filtered[step%2];dispatch('filter',[output,this.points[i],this.normals[i],target,this.filterParams[step]]);output=target;}}
  this.device.queue.submit([encoder.finish()]);this.output=output;this.accumulation=this.histories[i];this.previousVP=vp;this.viewKey=key;this.valid=true;this.index=j;this.serial++;this.samples=moving?1:this.samples+1;return this.state();
 }
 async readLinear(){
  if(!this.accumulation)throw Error('no completed image to capture');
  const stride=Math.ceil(this.width*16/256)*256,size=stride*this.height;
  const read=this.device.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
  try{const encoder=this.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:this.accumulation},{buffer:read,bytesPerRow:stride},[this.width,this.height]);this.device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const source=new Float32Array(read.getMappedRange());const result=new Float32Array(this.width*this.height*4);for(let y=0;y<this.height;y++)result.set(source.subarray(y*stride/4,y*stride/4+this.width*4),y*this.width*4);return result;}finally{read.destroy();}
 }
 publish(renderer,texture){
  if(renderer.backend.device!==this.device)throw Error('Surface teacher render device changed; reopen the experiment');
  renderer.initTexture(texture);const destination=renderer.backend.get(texture).texture;
  if(destination.width!==this.width||destination.height!==this.height||destination.format!=='rgba32float')throw Error('Surface teacher presentation texture extent or format mismatch');
  const encoder=this.device.createCommandEncoder();encoder.copyTextureToTexture({texture:this.output},{texture:destination},[this.width,this.height]);this.device.queue.submit([encoder.finish()]);
 }
 state(){return {route:'explicit-surface-webgpu-path-teacher-v1',triangles:this.triangleCount,width:this.width??0,height:this.height??0,samples:this.samples,frame:this.serial,bounces:this.bounces,environment:this.environment,resetReason:this.resetReason,reconstruction:'geometry-validated temporal accumulation and variance-guided atrous',rawOutput:'linear RGB; alpha stores accumulated sample count',disposed:this.disposed};}
 dispose(){if(this.disposed)return;this.disposed=true;for(const value of [...this.resources,...this.targets])value.destroy();}
}
