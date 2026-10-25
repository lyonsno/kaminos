// The installed package is the only model/runtime import used by this consumer.
import {createU2NetApp,removeForegroundU2Net} from '@kaminos/u2net';
import {createWebGpuInferenceSession,createWebGpuForegroundService} from '@kaminos/webgpu-inference-kit';
const state=window.u2netWitness={phase:'starting',frames:0,gpuErrors:[],runs:[]};
const fail=e=>{state.phase='failed';state.error=String(e.error?.stack??e.reason?.stack??e.message??e.reason??e);};
window.addEventListener('error',fail);window.addEventListener('unhandledrejection',fail);
const $=id=>document.getElementById(id);
const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('WebGPU unavailable');
state.adapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture,isFallbackAdapter:adapter.info.isFallbackAdapter??null};
const device=await adapter.requestDevice();
device.addEventListener('uncapturederror',e=>state.gpuErrors.push(e.error.message));
const session=await createWebGpuInferenceSession({device,adapter,adapterName:adapter.info.description||'native-WebGPU'});
const foreground=createWebGpuForegroundService({device,routeId:'u2net-witness-host'});
const app=window.u2netApp=await createU2NetApp({session,foreground,weightsUrl:'/weights/',load:false,onProgress:p=>{state.loading=p;}});
const canvas=$('activity'),context=canvas.getContext('webgpu'),format=navigator.gpu.getPreferredCanvasFormat();context.configure({device,format,alphaMode:'opaque'});
const uniform=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const module=device.createShaderModule({code:`
@group(0) @binding(0) var<uniform> u:vec4f;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3))[i],0,1);}
@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f{
 var c=vec3f(.04,.08,.11);let x=p.x-20.;let span=u.y-40.;
 if(abs(p.y-70.)<1.&&x>=0.&&x<=span){c=vec3f(.4);}
 if(abs(x-round(x/(span/10.))*(span/10.))<1.&&p.y>62.&&p.y<78.){c=vec3f(.6);}
 if(abs(p.x-(20.+u.x*span))<6.&&p.y>20.&&p.y<56.){c=vec3f(1.,.8,.25);}return vec4f(c,1.);
}`});
const pipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format}]}});
const binding=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]});
let live=true,page=false,sequence=0,current=null;
const submit=device.queue.submit;
device.queue.submit=function(commands){const r=submit.call(this,commands);if(current){current.queue.push(page?'page':'model');
  if(!page&&current.park&&!current.pausePromise){current.pausePromise=app.pause();}}
  return r;};
const started=performance.now();let last=null;
function frame(){if(!live)return;foreground.request({requestId:`frame:${++sequence}`,run:ctx=>{
  device.queue.writeBuffer(uniform,0,new Float32Array([1-Math.abs(((performance.now()-started)/1500)%2-1),canvas.width,0,0]));
  const enc=device.createCommandEncoder(),pass=enc.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}]});
  pass.setPipeline(pipeline);pass.setBindGroup(0,binding);pass.draw(3);pass.end();page=true;
  try {const {submittedAtMs}=ctx.submit([enc.finish()]);if(last!==null)$('gap').textContent=`Last draw submission gap: ${(submittedAtMs-last).toFixed(1)} ms`;last=submittedAtMs;state.frames++;}finally{page=false;}
}}).completion.then(r=>{if(r.status==='completed'&&live)requestAnimationFrame(frame);});}
requestAnimationFrame(frame);
const config=await (await fetch('/input/case.json')).json();
const pixels=new Uint8Array(await(await fetch('/input/source-rgb.u8')).arrayBuffer());
const input={pixels,width:config.source[0],height:config.source[1]};
function show(id,rgba,width,height){const c=$(id);c.width=width;c.height=height;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba),width,height),0,0);}
const rgba=new Uint8Array(pixels.length/3*4);for(let i=0;i<pixels.length/3;i++){rgba.set(pixels.subarray(i*3,i*3+3),i*4);rgba[i*4+3]=255;}show('source',rgba,input.width,input.height);
await app.load();state.phase='idle';$('status').textContent='Loaded; installed U2Net application.';
window.runCutout=async(park=false)=>{
  current={queue:[],park,pausePromise:null};state.current=current;state.phase='running';$('status').textContent='Removing background…';
  try {const result=await app.removeForeground(input);window.cutout=result;
    state.runs.push({queue:current.queue,width:result.width,height:result.height,provenance:result.provenance});
    show('cutout',result.rgba,result.width,result.height);state.phase='done';$('status').textContent='Cutout complete; renderer still drawing.';
  }catch(e){state.phase=e.name==='AbortError'?'stopped':'failed';state.error=String(e.stack||e);if(state.phase==='failed')throw e;}
  finally{current=null;}
};
window.directCutout=async()=>{const result=await removeForegroundU2Net({...input,runner:app.model});window.directOutput=result;};
window.destroyModel=async()=>{await app.destroy();state.afterDestroy={session:session.snapshot().status,routes:session.snapshot().routes.length,foregroundDisposed:foreground.snapshot().disposed};};
window.closeHost=async()=>{live=false;await foreground.dispose();session.close();uniform.destroy();device.queue.submit=submit;device.destroy();};
