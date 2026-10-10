import { requestBrowserWebGpuDevice, createWebGpuInferenceSession, createWebGpuInferenceControl } from '../../webgpu-inference-kit/src/core.js';
import { createSuperMatAdapter, SUPERMAT_ROUTE_ID, superMatDeviceOptions } from '../../models/supermat/supermat-route.js';
import { MoGeInference } from './moge-producer.js';
import { MaterialPhotoViewer } from './viewer.js';
import { createPhotoRunState } from './photo-contracts.js';

const $=id=>document.getElementById(id), params=new URLSearchParams(location.search);
const photos={celebration:['Celebration','./images/celebration.png'],bag:['Leather & metal','./images/bag.webp'],orb:['Stone & glow','./images/evil-orb.png']};
const results=createPhotoRunState();
const state=window.__materialPhoto={status:'loading-image',error:null,source:null,runs:[],identity:null};
let image,selection,active=false,viewer,gpu,session,moge,materials,weightRoute,setupPromise;
let imageTicket=0;
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function view(mode){
  if(viewer)viewer.mode=mode;
  for(const button of document.querySelectorAll('[data-view]'))button.classList.toggle('selected',button.dataset.view===mode);
  $('stage-label').textContent={original:'Original photograph',photo:'Inferred depth',materials:'Inferred materials'}[mode];
}
async function load(blob,label,key=null){
  if(active)return;
  const ticket=++imageTicket;
  const bitmap=await createImageBitmap(blob);
  if(ticket!==imageTicket){bitmap.close();return;}
  const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d');
  context.drawImage(bitmap,0,0);bitmap.close();
  image=context.getImageData(0,0,canvas.width,canvas.height);
  selection=results.select(label);state.source=label;state.status='loaded';state.error=null;
  const old=$('preview').dataset.blob;
  const url=URL.createObjectURL(blob);$('preview').src=url;$('preview').dataset.blob=url;
  if(old)URL.revokeObjectURL(old);
  $('preview').hidden=false;$('scene').hidden=true;
  viewer?.clear();view('original');
  for(const button of document.querySelectorAll('[data-view]:not([data-view=original])'))button.disabled=true;
  for(const id of ['map','light','height','exposure','gi','reset'])$(id).disabled=true;
  for(const button of document.querySelectorAll('[data-sample]'))button.classList.toggle('selected',button.dataset.sample===key);
  $('name').textContent=label;$('resolution').textContent=`${image.width} x ${image.height}`;
  $('progress').value=0;$('elapsed').textContent='';$('timings').textContent='';$('run').disabled=false;
  status('Photograph loaded');
}
async function sample(key){const response=await fetch(photos[key][1]);if(!response.ok)throw Error(`Image HTTP ${response.status}`);await load(await response.blob(),photos[key][0],key);}

async function setup(){
  if(setupPromise)return setupPromise;
  setupPromise=(async()=>{
    status('Connecting shared WebGPU device');
    gpu=await requestBrowserWebGpuDevice(navigator.gpu,await superMatDeviceOptions(navigator.gpu,{adapterName:'material-photograph'}));
    session=await createWebGpuInferenceSession({sessionId:crypto.randomUUID(),device:gpu.device,adapter:gpu.adapter,backendIdentity:gpu.backendIdentity});
    viewer=await new MaterialPhotoViewer().init($('scene'),gpu.device);
    gpu.device.lost.then(info=>{if(info.reason!=='destroyed'){state.status='error';state.error=`WebGPU device lost: ${info.message}`;status(state.error,true);}});
    state.identity={backend:gpu.backendIdentity,renderer:'kaminos-three-webgpu',gi:viewer.gi.debugState().route??'three-ssilvb-scene-gi-v1',sharedDevice:viewer.renderer.backend.device===gpu.device};
  })();
  return setupPromise;
}
async function infer(){
  if(active||!image)return;
  active=true;state.status='running';state.error=null;
  const token=selection,input=image,started=performance.now(),record={source:state.source,status:'running',phases:{}};
  for(const button of document.querySelectorAll('[data-sample]'))button.disabled=true;
  $('file').disabled=$('run').disabled=true;
  const clock=setInterval(()=>{$('elapsed').textContent=`${((performance.now()-started)/1000).toFixed(1)} s elapsed`;},100);
  $('progress').removeAttribute('value');
  try{
    await setup();
    if(!moge){
      const candidate=new MoGeInference(gpu);
      try{
        await candidate.init((received,total)=>status(`1/2 Geometry: loading MoGe ${Math.round(received/1e6)}${total?` / ${Math.round(total/1e6)}`:''} MB`));
        if(!candidate.useRealWeights)throw Error('MoGe real weights did not load; preview refuses stub inference');
        moge=candidate;
      }catch(error){await candidate.dispose();throw error;}
    }
    status('1/2 Geometry: inferring depth & normals');
    let phase=performance.now();
    const depth=await moge.run(input,{scheduler:{mode:'cooperative',splitVitBlocks:true,splitDecoderResBlocks:true,pacing:'bounded-prefix'}});
    record.phases.geometryMs=performance.now()-phase;
    record.moge={weights:moge.weightsSource,width:depth.width,height:depth.height,route:depth.webGpuRouteReceipt??null};
    results.publish(token,'geometry',depth);
    viewer.setImage(input,depth);viewer.map='surface';$('map').value='surface';
    $('preview').hidden=true;$('scene').hidden=false;
    document.querySelector('[data-view=photo]').disabled=false;$('reset').disabled=false;view('photo');
    await new Promise(requestAnimationFrame);
    if(!materials){
      weightRoute??=await session.registerRoute({routeId:`${SUPERMAT_ROUTE_ID}.material-photo-weights`});
      materials=await createSuperMatAdapter({route:weightRoute,weightsUrl:params.get('weights')??'/scratch/supermat-weights/f16/',
        activations:'f32',fuseNorm:false,gemmPrecision:'f32',attention:'streaming',onProgress:event=>{
          if(event.phase==='weights')status(`2/2 Materials: loading SuperMat ${event.resourceIndex+1}/${event.resourceCount} resources`);
        }});
    }
    const route=await session.registerRoute({routeId:SUPERMAT_ROUTE_ID});
    const control=createWebGpuInferenceControl({queue:gpu.device.queue});
    phase=performance.now();
    let output;
    try{
      const job=route.enqueue({jobId:crypto.randomUUID(),execute:invocation=>materials.run({image:input,size:512,
        schedule:{runtime:route.runtime,invocation,control},onRunProgress:progress=>{
          const names={preprocess:'Preparing image',encode:'Image encoder',unet:'Material inference','decode-albedo':'Albedo decoder','decode-orm':'Finish decoder','pack-maps':'Material maps'};
          status(`2/2 Materials: ${names[progress.phase]??progress.phase} (${progress.phaseIndex+1}/${progress.phaseCount})`);
          if(progress.totalFlops)$('progress').value=progress.completedFlops/progress.totalFlops;else $('progress').removeAttribute('value');
        }})});
      const completion=await job.completion;
      if(completion.status!=='succeeded')throw Error(completion.failure?.message??`SuperMat ${completion.status}`);
      output=completion.output;
    }finally{await control.close();await route.drain();session.unregisterRoute(route.routeId);}
    record.phases.materialsMs=performance.now()-phase;
    record.supermat={identity:materials.identity,timings:output.timings,dutyCount:output.dutyCount};
    results.publish(token,'materials',output);viewer.setMaterials(output);view('materials');
    document.querySelector('[data-view=materials]').disabled=false;
    for(const id of ['map','light','height','exposure','gi','reset'])$(id).disabled=false;
    record.wallMs=performance.now()-started;record.status='done';
    record.output={surfaceVertices:viewer.surface.position.length/3,triangles:viewer.surface.indices.length/3,materialSize:[output.width,output.height]};
    state.status='done';state.result=record.output;state.identity.supermat=materials.identity;
    $('identity').textContent='MoGe-2 + SuperMat | same GPUDevice';
    $('timings').textContent=`Depth ${(record.phases.geometryMs/1000).toFixed(2)} s | Materials ${(record.phases.materialsMs/1000).toFixed(2)} s`;
    $('progress').value=1;status('Depth & materials complete');
  }catch(error){record.status='error';record.error=String(error.stack??error);state.status='error';state.error=error.message;status(error.message,true);$('progress').removeAttribute('value');}
  finally{clearInterval(clock);record.elapsedMs=performance.now()-started;state.runs.push(record);active=false;
    $('run').disabled=$('file').disabled=false;for(const button of document.querySelectorAll('[data-sample]'))button.disabled=false;
  }
}
for(const button of document.querySelectorAll('[data-sample]'))button.onclick=()=>sample(button.dataset.sample).catch(fail);
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>view(button.dataset.view);
$('file').onchange=()=>{const file=$('file').files[0];if(file)load(file,file.name).catch(fail);};
$('run').onclick=infer;
$('map').onchange=()=>{viewer.map=$('map').value;};
for(const id of ['light','height'])$(id).oninput=()=>viewer.setLight(Number($('light').value),Number($('height').value));
$('exposure').oninput=()=>{viewer.renderer.toneMappingExposure=Number($('exposure').value);};
$('gi').onchange=()=>{viewer.useGI=$('gi').checked;};
$('reset').onclick=()=>{viewer.reset();$('light').value=-35;$('height').value=35;$('exposure').value=1;};
function fail(error){state.status='error';state.error=error.message;status(error.message,true);}
window.__materialPhotoActions={infer,sample,view,async pixels(){
  viewer.render();await gpu.device.queue.onSubmittedWorkDone();
  const source=$('scene'),canvas=new OffscreenCanvas(source.width,source.height),context=canvas.getContext('2d');
  context.drawImage(source,0,0);const rgba=context.getImageData(0,0,source.width,source.height).data;
  let min=255,max=0,nonBackground=0;
  for(let i=0;i<rgba.length;i+=4){for(let c=0;c<3;c++){min=Math.min(min,rgba[i+c]);max=Math.max(max,rgba[i+c]);}
    if(Math.max(rgba[i],rgba[i+1],rgba[i+2])-Math.min(rgba[i],rgba[i+1],rgba[i+2])>20||rgba[i]>45)nonBackground++;
  }return{width:source.width,height:source.height,range:max-min,nonBackground};
}};
try{await sample(params.get('sample') in photos?params.get('sample'):'celebration');if(params.get('autorun')==='1')await infer();}catch(error){fail(error);}
