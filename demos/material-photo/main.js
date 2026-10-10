import { requestBrowserWebGpuDevice, createWebGpuInferenceSession, createWebGpuInferenceControl } from '../../webgpu-inference-kit/src/core.js';
import { createSuperMatAdapter, SUPERMAT_ROUTE_ID, superMatDeviceOptions } from '../../models/supermat/supermat-route.js';
import { MoGeInference } from './moge-producer.js';
import { MaterialPhotoViewer } from './viewer.js';
import { createPhotoRunState, pixelSummary } from './photo-contracts.js';

const $=id=>document.getElementById(id), params=new URLSearchParams(location.search);
const photos={celebration:['Celebration','./images/celebration.png'],bag:['Backpack','./images/bag.webp'],orb:['Metal & glow','./images/evil-orb.png']};
const results=createPhotoRunState();
const state=window.__materialPhoto={status:'loading-image',error:null,source:null,runs:[],identity:null};
let image,selection,active=false,viewer,gpu,session,moge,materials,weightRoute,setupPromise;
let imageTicket=0;
const viewOrder=['original','photo','relit','materials'];
const tuningFields=['gain','radius','thickness','slices','steps','denoise','aoStrength','expFactor','screenSpaceSampling','linearThickness','backfaceLighting','depthPhi','normalPhi','lumaPhi'];
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function view(mode){
  if(mode==='materials'&&!viewer?.maps)mode='photo';
  if(['photo','relit'].includes(mode)&&!viewer?.surface)mode='original';
  if(!viewOrder.includes(mode))throw Error('Unknown photograph view');
  if(viewer){viewer.mode=mode;viewer.map='surface';}
  $('map').value='surface';
  for(const button of document.querySelectorAll('[data-view]')){
    button.classList.toggle('selected',button.dataset.view===mode);
    button.setAttribute('aria-pressed',String(button.dataset.view===mode));
  }
  $('stage-label').textContent={original:'Original photograph',photo:'Inferred depth',relit:'Relit photograph',materials:'Inferred materials'}[mode];
  syncControls();
}
function syncSun(){
  const light=viewer?.getLightHandle();
  if(!light)return;
  $('sun').style.left=`${(0.5+light.x*.38)*100}%`;
  $('sun').style.top=`${(0.5-light.y*.38)*100}%`;
  $('sun').setAttribute('aria-label',`Sun position ${Math.round(light.x*100)}, ${Math.round(light.y*100)}`);
}
function syncControls(){
  const surface=!!viewer?.surface,lit=surface&&['relit','materials'].includes(viewer.mode);
  $('sun').hidden=!lit;$('sun').disabled=!lit;
  $('gi').disabled=!surface;$('reset').disabled=!viewer?.original&&!surface;
  $('map').disabled=!surface;$('glow').disabled=!viewer?.maps||viewer.mode!=='materials';
  $('preset-export').disabled=$('preset-import').disabled=!surface;
  for(const id of tuningFields)$(id).disabled=!surface;
  for(const option of $('map').options??[])option.disabled=!viewer?.maps&&!['surface','normals'].includes(option.value);
  if(viewer){
    const settings=viewer.getTuning();
    for(const id of tuningFields)if(typeof settings[id]==='boolean')$(id).checked=settings[id];else $(id).value=settings[id];
    $('gi').checked=viewer.useGI;$('glow').checked=!!viewer.glow;
  }
  const available=document.querySelectorAll('[data-view]');
  const count=[...available].filter(button=>!button.disabled).length;
  $('view-prev').disabled=$('view-next').disabled=count<2;
  syncSun();
}
function disableMaterials(){
  document.querySelector('[data-view=materials]').disabled=true;
  $('glow').disabled=true;
}
async function load(blob,label,key=null,ticket=++imageTicket){
  if(active)return;
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
  syncControls();
  for(const button of document.querySelectorAll('[data-sample]'))button.classList.toggle('selected',button.dataset.sample===key);
  $('name').textContent=label;$('resolution').textContent=`${image.width} x ${image.height}`;
  $('progress').value=0;$('elapsed').textContent='';$('timings').textContent='';$('run').disabled=false;
  status('Photograph loaded');
}
async function sample(key){
  if(active)return;
  const ticket=++imageTicket;
  try{
    const response=await fetch(photos[key][1]);
    if(ticket!==imageTicket)return;
    if(!response.ok)throw Error(`Image HTTP ${response.status}`);
    await load(await response.blob(),photos[key][0],key,ticket);
  }catch(error){if(ticket===imageTicket)throw error;}
}

async function setup(){
  if(setupPromise)return setupPromise;
  setupPromise=(async()=>{
    status('Connecting shared WebGPU device');
    gpu=await requestBrowserWebGpuDevice(navigator.gpu,await superMatDeviceOptions(navigator.gpu,{adapterName:'material-photograph'}));
    session=await createWebGpuInferenceSession({sessionId:crypto.randomUUID(),device:gpu.device,adapter:gpu.adapter,backendIdentity:gpu.backendIdentity});
    viewer=new MaterialPhotoViewer();await viewer.init($('scene'),gpu.device);
    gpu.device.lost.then(info=>{if(info.reason!=='destroyed'){state.status='error';state.error=`WebGPU device lost: ${info.message}`;status(state.error,true);}});
    state.identity={backend:gpu.backendIdentity,renderer:'kaminos-three-webgpu',gi:viewer.gi.debugState().route??'three-ssilvb-scene-gi-v1',sharedDevice:viewer.renderer.backend.device===gpu.device};
  })().catch(async error=>{
    for(const cleanup of [()=>viewer?.dispose(),()=>session?.close(),()=>gpu?.device.destroy()]){
      try{await cleanup();}catch(cause){(state.cleanupErrors??=[]).push(String(cause));}
    }
    viewer=session=gpu=null;setupPromise=null;
    throw error;
  });
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
    record.moge={weights:moge.weightsSource,width:depth.width,height:depth.height,route:depth.routeResult?.receipt??null};
    results.publish(token,'geometry',depth);
    disableMaterials();
    viewer.setImage(input,depth);viewer.map='surface';$('map').value='surface';
    $('preview').hidden=true;$('scene').hidden=false;
    document.querySelector('[data-view=photo]').disabled=false;document.querySelector('[data-view=relit]').disabled=false;view('photo');
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
    results.publish(token,'materials',output);viewer.setMaterials(output);
    document.querySelector('[data-view=materials]').disabled=false;
    view('materials');
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
function cycleView(delta){
  const available=viewOrder.filter(mode=>!document.querySelector(`[data-view=${mode}]`).disabled);
  const index=available.indexOf(viewer?.mode??'original');
  view(available[(index+delta+available.length)%available.length]);
}
$('view-prev').onclick=()=>cycleView(-1);$('view-next').onclick=()=>cycleView(1);
$('file').onchange=()=>{const file=$('file').files[0];if(file)load(file,file.name).catch(fail);};
$('run').onclick=infer;
$('map').onchange=()=>{if(viewer)viewer.map=$('map').value;};
$('gi').onchange=()=>{viewer.useGI=$('gi').checked;};
$('glow').onchange=()=>{viewer.glow=$('glow').checked;};
$('reset').onclick=()=>{viewer.reset();syncControls();};
for(const id of tuningFields)$(id).onchange=()=>{
  try{
    const boolean=['screenSpaceSampling','linearThickness'].includes(id);
    const value=boolean?$(id).checked:String($(id).value).trim()===''?NaN:Number($(id).value);
    viewer.setTuning({[id]:value});$('preset-error').textContent='';
  }catch(error){$('preset-error').textContent=error.message;$('advanced').open=true;}
  syncControls();
};
let sunPointer=null;
function setLightPosition(u,v){viewer.setLightScreenPosition(u,v);syncSun();}
function dragSun(event){
  const bounds=$('scene').getBoundingClientRect();
  setLightPosition((event.clientX-bounds.left)/bounds.width,(event.clientY-bounds.top)/bounds.height);
}
$('sun').onpointerdown=event=>{
  if(event.button!==0||sunPointer!==null)return;
  event.preventDefault();event.stopPropagation();sunPointer=event.pointerId;
  viewer.target.set(0,0);$('sun').setPointerCapture(event.pointerId);dragSun(event);
};
$('sun').onpointermove=event=>{if(event.pointerId===sunPointer){event.preventDefault();event.stopPropagation();dragSun(event);}};
function releaseSun(event){if(event.pointerId===sunPointer){sunPointer=null;if($('sun').hasPointerCapture(event.pointerId))$('sun').releasePointerCapture(event.pointerId);}}
$('sun').onpointerup=$('sun').onpointercancel=$('sun').onlostpointercapture=releaseSun;
$('sun').onkeydown=event=>{
  const delta={ArrowLeft:[-.04,0],ArrowRight:[.04,0],ArrowUp:[0,.04],ArrowDown:[0,-.04]}[event.key];
  if(delta){event.preventDefault();event.stopPropagation();const light=viewer.getLightHandle();viewer.setLightHandle(light.x+delta[0],light.y+delta[1]);syncSun();}
  else if(event.key==='Home'){event.preventDefault();viewer.setLight();syncSun();}
};
function exportPreset(){if(!viewer?.surface)throw Error('Preset requires a depth surface');return viewer.exportPreset();}
function importPreset(json){
  try{if(!viewer?.surface)throw Error('Preset requires a depth surface');viewer.applyPreset(typeof json==='string'?JSON.parse(json):json);syncControls();$('preset-error').textContent='';return true;}
  catch(error){$('preset-error').textContent=error.message;$('advanced').open=true;return false;}
}
$('preset-export').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(exportPreset(),null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='material-photograph-preset.json';link.click();URL.revokeObjectURL(url);
};
$('preset-import').onclick=()=>$('preset-file').click();
$('preset-file').onchange=async()=>{
  const file=$('preset-file').files[0];
  try{if(file)importPreset(await file.text());}catch(error){$('preset-error').textContent=error.message;}
  $('preset-file').value='';
};
function fail(error){state.status='error';state.error=error.message;status(error.message,true);}
window.__materialPhotoActions={infer,sample,view,exportPreset,importPreset,setLightPosition,presentation:()=>viewer?.presentation()??null,async pixels(presentedFrame){
  // Inspect the browser's presented canvas screenshot, not a discarded WebGPU drawing buffer.
  const response=await fetch(presentedFrame),bitmap=await createImageBitmap(await response.blob());
  const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d');
  context.drawImage(bitmap,0,0);bitmap.close();
  return pixelSummary(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
}};
try{await sample(params.get('sample') in photos?params.get('sample'):'celebration');if(params.get('autorun')==='1')await infer();}catch(error){fail(error);}
