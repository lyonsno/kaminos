import { requestBrowserWebGpuDevice, createWebGpuInferenceSession, createWebGpuInferenceControl } from '../../webgpu-inference-kit/src/core.js';
import { createSuperMatAdapter, SUPERMAT_ROUTE_ID, superMatDeviceOptions } from '../../models/supermat/supermat-route.js';
import { MoGeInference } from './moge-producer.js';
import { MaterialPhotoViewer } from './comparison-viewer.js';
import { createPhotoRunState, pixelSummary } from './photo-contracts.js';
import { DEFAULT_PRESET, superMatProductProfile } from './demo-defaults.js';
import { createInferenceCache,photoCacheKey,retainedGeometry } from './inference-cache.js';
import { loadIncludedExample } from './included-examples.js';
import { buildPhotoSurface } from './photo-surface.js';

const $=id=>document.getElementById(id), params=new URLSearchParams(location.search);
const photos={celebration:['Celebration','./images/celebration.png'],bag:['Backpack','./images/bag.webp'],orb:['Metal & glow','./images/evil-orb.png']};
const results=createPhotoRunState();
const state=window.__materialPhoto={status:'loading-image',error:null,source:null,runs:[],identity:null};
const cache=createInferenceCache({onError:error=>{(state.cacheErrors??=[]).push(String(error));}});
// Bump these when producer/preparation semantics change. Custom weight URLs are
// deliberately session-local: their contents may change without changing the URL.
const cacheRevision=params.has('weights')?crypto.randomUUID():'moge-vendored-38539be0-supermat-f368906c.v1';
let imageKey,sampleKey,imageBlob,completed;
const geometryKey=key=>`${cacheRevision}:geometry:${key}`;
const materialKey=(key,size)=>`${cacheRevision}:materials:${key}:${size}:${JSON.stringify(superMatProductProfile(gpu.device))}`;
let image,selection,active=false,viewer,gpu,session,moge,materials,weightRoute,setupPromise;
let imageTicket=0;
let environmentTicket=0;
const viewOrder=['original','photo','relit','materials'];
const tuningFields=['gain','radius','thickness','slices','steps','denoise','aoStrength','expFactor','screenSpaceSampling','linearThickness','backfaceLighting','depthPhi','normalPhi','lumaPhi'];
const effectFields=['glowIntensity','glowThreshold','emissionReflection','bloomIntensity','bloomRadius','bloomThreshold','exposure'];
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function provenance(text){$('provenance').textContent=text;}
function runButton(){ $('run').disabled=active||!image||['loading-image','restoring'].includes(state.status); }
function showControls(open){
  $('controls').hidden=!open;$('workspace').dataset.controls=open?'open':'closed';
  $('tuning-toggle').setAttribute('aria-expanded',String(open));
  $('tuning-toggle').title=open?'Close tuning':'Open tuning';
}
$('tuning-toggle').onclick=()=>showControls($('controls').hidden);
showControls(false);
function view(mode){
  if(mode==='materials'&&!viewer?.maps)mode='photo';
  if(['photo','relit'].includes(mode)&&!viewer?.surface)mode='original';
  if(!viewOrder.includes(mode))throw Error('Unknown photograph view');
  if(viewer){viewer.mode=mode;viewer.map='surface';}
  $('map').value='surface';
  for(const button of document.querySelectorAll('[data-view]')){
    button.classList.toggle('selected',!viewer?.comparison&&button.dataset.view===mode);
    button.setAttribute('aria-pressed',String(!viewer?.comparison&&button.dataset.view===mode));
  }
  $('stage-label').textContent={original:'Original photograph',photo:'Inferred depth',relit:'Relit photograph',materials:'Inferred materials'}[mode];
  syncControls();
}
function compare(){
  if(viewer)viewer.map='surface';
  $('map').value='surface';
  viewer?.showComparison();
  $('stage-label').textContent='Four-way comparison';
  $('compare').classList.add('selected');
  for(const button of document.querySelectorAll('[data-view]')){button.classList.remove('selected');button.setAttribute('aria-pressed','false');}
  syncControls();
}
function syncSun(){
  const light=viewer?.getLightHandle();
  if(!light)return;
  const position=viewer.getLightRing();
  $('sun').style.left=`${position.u*100}%`;
  $('sun').style.top=`${position.v*100}%`;
  $('sun').setAttribute('aria-label',`Sun position ${Math.round(light.x*100)}, ${Math.round(light.y*100)}`);
}
function syncControls(){
  const surface=!!viewer?.surface,lit=surface&&(viewer.comparison||['relit','materials'].includes(viewer.mode));
  $('sun').hidden=!lit;$('sun').disabled=!lit;
  $('gi').disabled=!surface;$('reset').disabled=!viewer?.original&&!surface;
  $('map').disabled=!surface;$('glow').disabled=!viewer?.maps;
  for(const id of effectFields)$(id).disabled=id==='exposure'?!surface:!viewer?.maps;
  $('bloom').disabled=!viewer?.maps;
  $('preset-export').disabled=$('preset-import').disabled=!surface;
  $('compare').disabled=!surface;$('compare').classList.toggle('selected',!!viewer?.comparison);
  for(const id of ['environment','environment-rotation','environment-intensity','direct-intensity'])$(id).disabled=!viewer;
  for(const id of tuningFields)$(id).disabled=!surface;
  $('gi-view').disabled=!surface;
  for(const id of ['contrast-mode','roughness-strength','metallic-strength'])$(id).disabled=!viewer?.maps;
  for(const option of $('map').options??[])option.disabled=!viewer?.maps&&!['surface','normals'].includes(option.value);
  if(viewer){
    const settings=viewer.getTuning();
    for(const id of tuningFields)if(typeof settings[id]==='boolean')$(id).checked=settings[id];else $(id).value=settings[id];
    $('gi').checked=viewer.useGI;$('glow').checked=!!viewer.glow;
    const effects=viewer.getEffects();$('bloom').checked=effects.bloom;
    for(const id of effectFields){if($(id).max&&effects[id]>Number($(id).max))$(id).max=effects[id];$(id).value=effects[id];$(`${id}-value`).textContent=effects[id].toFixed(2);}
    $('gi-view').value=viewer.getDiagnostic();
    const contrast=viewer.getMaterialContrast();$('contrast-mode').value=contrast.mode;
    for(const name of ['roughness','metallic']){$(`${name}-strength`).value=contrast[name];$(`${name}-strength-value`).textContent=contrast[name].toFixed(2);}
    const correction=viewer.primary.presentation().contrast;
    $('contrast-readout').textContent=correction.analysis?`Highlight evidence ${(100*correction.analysis.highlightEvidence).toFixed(0)}% | Applied roughness ${(100*correction.gains.roughness).toFixed(0)}%, metallic ${(100*correction.gains.metallic).toFixed(0)}% | Raw ranges R ${correction.analysis.roughness.low}-${correction.analysis.roughness.high}, M ${correction.analysis.metallic.low}-${correction.analysis.metallic.high}`:'';
    const lighting=viewer.getLighting();
    $('environment').value=viewer.environment??'studio';
    $('environment-rotation').value=lighting.rotation;$('environment-intensity').value=lighting.intensity;$('direct-intensity').value=lighting.direct;
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
  state.status='loading-image';$('run').disabled=true;
  const bitmap=await createImageBitmap(blob);
  if(ticket!==imageTicket){bitmap.close();return;}
  const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d');
  context.drawImage(bitmap,0,0);bitmap.close();
  const input=context.getImageData(0,0,canvas.width,canvas.height),keyHash=await photoCacheKey(input);
  if(ticket!==imageTicket)return;
  image=input;imageKey=keyHash;sampleKey=key;imageBlob=blob;selection=results.select(label);state.source=label;state.status='loaded';state.error=null;state.result=null;state.cache=null;state.example=null;
  provenance('Original photograph');
  const old=$('preview').dataset.blob;
  const url=URL.createObjectURL(blob);$('preview').src=url;$('preview').dataset.blob=url;
  if(old)URL.revokeObjectURL(old);
  $('preview').hidden=false;$('scene').hidden=true;
  viewer?.clear();view('original');
  for(const button of document.querySelectorAll('[data-view]:not([data-view=original])'))button.disabled=true;
  syncControls();
  for(const button of document.querySelectorAll('[data-sample]'))button.classList.toggle('selected',button.dataset.sample===key);
  $('name').textContent=label;$('resolution').textContent=`${image.width} x ${image.height}`;
  if(!active){$('progress').value=0;$('elapsed').textContent='';}$('timings').textContent='';
  status('Photograph loaded');$('run').disabled=true;
  await restoreCached(ticket);
  if(ticket===imageTicket)runButton();
}
async function sample(key){
  const ticket=++imageTicket;
  state.status='loading-image';$('run').disabled=true;$('material-size').disabled=true;
  try{
    const response=await fetch(photos[key][1]);
    if(ticket!==imageTicket)return;
    if(!response.ok)throw Error(`Image HTTP ${response.status}`);
    await load(await response.blob(),photos[key][0],key,ticket);
  }catch(error){if(ticket===imageTicket)throw error;}
  finally{if(ticket===imageTicket){$('material-size').disabled=false;runButton();}}
}

async function setup(){
  if(setupPromise)return setupPromise;
  setupPromise=(async()=>{
    status('Connecting shared WebGPU device');
    gpu=await requestBrowserWebGpuDevice(navigator.gpu,await superMatDeviceOptions(navigator.gpu,{adapterName:'material-photograph'}));
    session=await createWebGpuInferenceSession({sessionId:crypto.randomUUID(),device:gpu.device,adapter:gpu.adapter,backendIdentity:gpu.backendIdentity});
    viewer=new MaterialPhotoViewer();await viewer.init($('scene'),gpu.device);
    await viewer.applyPreset(DEFAULT_PRESET);
    gpu.device.addEventListener('uncapturederror',event=>{
      (state.gpuErrors??=[]).push(event.error.message);fail(event.error);
    });
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
function presentDepth(input,depth){
  disableMaterials();viewer.setImage(input,depth);viewer.map='surface';$('map').value='surface';
  $('preview').hidden=true;$('scene').hidden=false;
  document.querySelector('[data-view=photo]').disabled=false;document.querySelector('[data-view=relit]').disabled=false;compare();
}
async function restoreCached(ticket=++imageTicket){
  const input=image,key=imageKey,token=selection,sample=sampleKey,size=Number($('material-size').value);
  state.status='restoring';
  const geometry=await cache.get(geometryKey(key));
  if(ticket!==imageTicket)return;
  // Never leave the previous resolution's material maps advertised as this one.
  state.result=null;state.cache=null;state.example=null;$('timings').textContent='';provenance('Original photograph');
  if(!active){$('elapsed').textContent='';$('progress').value=0;}
  let material=null;
  if(geometry){await setup();if(ticket!==imageTicket)return;material=await cache.get(materialKey(key,size));if(ticket!==imageTicket)return;}
  if(!material&&sample){
    try{
      const included=await loadIncludedExample(sample,key,size);
      if(ticket!==imageTicket)return;
      if(included){
        await setup();if(ticket!==imageTicket)return;
        results.publish(token,'geometry',included.depth);presentDepth(input,included.depth);
        results.publish(token,'materials',included.output);viewer.setMaterials(included.output);
        document.querySelector('[data-view=materials]').disabled=false;compare();
        state.status='included';state.example=included.provenance;
        provenance(`Included example | ${included.output.width} x ${included.output.height}`);
        status('Explore the included result');return;
      }
    }catch(error){if(ticket!==imageTicket)return;(state.exampleErrors??=[]).push(String(error));state.status='loaded';
      status('Example unavailable; photograph loaded',true);runButton();return;}
  }
  state.status='loaded';
  if(!geometry){viewer?.clear();$('preview').hidden=false;$('scene').hidden=true;view('original');
    for(const button of document.querySelectorAll('[data-view]:not([data-view=original])'))button.disabled=true;
    syncControls();status('Photograph loaded');return;}
  await setup();if(ticket!==imageTicket)return;
  results.publish(token,'geometry',geometry.depth);presentDepth(input,geometry.depth);
  state.cache={geometry:true,materials:!!material,size,source:'browser-result-storage',originalRun:material?.record??geometry.record};
  if(material){
    results.publish(token,'materials',material.output);viewer.setMaterials(material.output);
    document.querySelector('[data-view=materials]').disabled=false;compare();
    state.status='cached';state.result=material.record.output;state.identity.supermat=material.record.supermat.identity;
    provenance('Your cached result');
    $('identity').textContent='MoGe-2 + SuperMat | cached outputs';$('progress').value=1;
    $('timings').textContent=`Restored materials ${size} x ${size}`;status('Depth & materials restored');
  }else{status('Depth restored; materials not yet computed at this resolution');}
}
async function infer(){
  if(active||!image||['loading-image','restoring'].includes(state.status))return;
  active=true;state.status='running';state.error=null;
  const token=selection,ticket=imageTicket,input=image,key=imageKey,blob=imageBlob,sample=sampleKey,size=Number($('material-size').value),started=performance.now(),record={source:state.source,status:'running',phases:{}};
  const retainDisplay=!!viewer?.maps;
  const visible=()=>ticket===imageTicket&&size===Number($('material-size').value);
  const progressStatus=text=>{state.job={source:record.source,size,status:'running',message:text};$('job-status').textContent=`${record.source} | ${text}`;if(visible())status(text);};
  state.cache=null;
  completed=null;$('view-result').hidden=true;$('run').disabled=true;
  progressStatus('Starting generation');
  const clock=setInterval(()=>{$('elapsed').textContent=`${((performance.now()-started)/1000).toFixed(1)} s elapsed`;},100);
  $('progress').removeAttribute('value');
  try{
    if(![512,768,1024].includes(size))throw Error('Choose a supported material resolution');
    await setup();
    const retained=await cache.get(geometryKey(key));
    if(!retained&&!moge){
      const candidate=new MoGeInference(gpu);
      try{
        await candidate.init((received,total)=>progressStatus(`1/2 Geometry: loading MoGe ${Math.round(received/1e6)}${total?` / ${Math.round(total/1e6)}`:''} MB`));
        if(!candidate.useRealWeights)throw Error('MoGe real weights did not load; preview refuses stub inference');
        moge=candidate;
      }catch(error){await candidate.dispose();throw error;}
    }
    progressStatus('1/2 Geometry: inferring depth & normals');
    let phase=performance.now();
    const depth=retained?.depth??await moge.run(input,{scheduler:{mode:'cooperative',splitVitBlocks:true,splitDecoderResBlocks:true,pacing:'bounded-prefix'}});
    record.phases.geometryMs=performance.now()-phase;
    record.moge=retained?{...retained.record.moge,cached:true}:{weights:moge.weightsSource,width:depth.width,height:depth.height,route:depth.routeResult?.receipt??null};
    if(visible()&&!retainDisplay){results.publish(token,'geometry',depth);presentDepth(input,depth);provenance('Generating materials');}
    if(!retained)await cache.put(geometryKey(key),{depth:retainedGeometry(depth),record:{moge:record.moge}});
    await new Promise(requestAnimationFrame);
    if(!materials){
      if(visible()&&!retainDisplay)viewer.setMaterialStatus('Loading materials');
      weightRoute??=await session.registerRoute({routeId:`${SUPERMAT_ROUTE_ID}.material-photo-weights`});
      materials=await createSuperMatAdapter({route:weightRoute,weightsUrl:params.get('weights')??'/scratch/supermat-weights/f16/',
        ...superMatProductProfile(gpu.device),onProgress:event=>{
          if(event.phase==='weights')progressStatus(`2/2 Materials: loading SuperMat ${event.resourceIndex+1}/${event.resourceCount} resources`);
        }});
    }
    const route=await session.registerRoute({routeId:SUPERMAT_ROUTE_ID});
    const control=createWebGpuInferenceControl({queue:gpu.device.queue});
    phase=performance.now();
    let output;
    try{
      if(visible()&&!retainDisplay)viewer.setMaterialStatus('Inferring materials');
      const job=route.enqueue({jobId:crypto.randomUUID(),execute:invocation=>materials.run({image:input,size,
        schedule:{runtime:route.runtime,invocation,control},onRunProgress:progress=>{
          const names={preprocess:'Preparing image',encode:'Image encoder',unet:'Material inference','decode-albedo':'Albedo decoder','decode-orm':'Finish decoder','pack-maps':'Material maps'};
          progressStatus(`2/2 Materials: ${names[progress.phase]??progress.phase} (${progress.phaseIndex+1}/${progress.phaseCount})`);
          if(progress.totalFlops)$('progress').value=progress.completedFlops/progress.totalFlops;else $('progress').removeAttribute('value');
        }})});
      const completion=await job.completion;
      if(completion.status!=='succeeded')throw Error(completion.failure?.message??`SuperMat ${completion.status}`);
      output=completion.output;
    }finally{await control.close();await route.drain();session.unregisterRoute(route.routeId);}
    record.phases.materialsMs=performance.now()-phase;
    if(output.width!==size||output.height!==size)throw Error('Material output resolution differs from selected resolution');
    record.supermat={identity:materials.identity,size,timings:output.timings,dutyCount:output.dutyCount};
    record.wallMs=performance.now()-started;record.status='done';
    const surface=visible()&&!retainDisplay?viewer.surface:buildPhotoSurface(depth,input.width/input.height);
    record.output={surfaceVertices:surface.position.length/3,triangles:surface.indices.length/3,materialSize:[output.width,output.height]};
    record.cached=await cache.put(materialKey(key,size),{output,record});
    completed={input,key,blob,sample,size,depth,output,record};
    state.job={source:record.source,size,status:'done'};
    $('job-status').textContent=`${record.source} | Generation complete`;$('progress').value=1;
    if(visible())presentCompleted();else $('view-result').hidden=false;
  }catch(error){
    record.status='error';record.error=String(error.stack??error);state.job={source:record.source,size,status:'error',error:error.message};
    $('job-status').textContent=`${record.source} | ${error.message}`;
    if(visible()){if(viewer?.surface&&!viewer.maps)viewer.setMaterialStatus('Materials unavailable');if(retainDisplay)provenance('Previous result | Generation failed');state.status='error';state.error=error.message;status(error.message,true);}
    $('progress').removeAttribute('value');
  }
  finally{clearInterval(clock);record.elapsedMs=performance.now()-started;state.runs.push(record);active=false;
    runButton();
  }
}
function presentCompleted(){
  const {input,depth,output,record}=completed;
  results.publish(selection,'geometry',depth);presentDepth(input,depth);
  results.publish(selection,'materials',output);viewer.setMaterials(output);
  document.querySelector('[data-view=materials]').disabled=false;compare();
  state.status='done';state.result=record.output;state.identity.supermat=record.supermat.identity;
  provenance('Newly generated');$('identity').textContent='MoGe-2 + SuperMat | same GPUDevice';
  $('timings').textContent=`Depth ${(record.phases.geometryMs/1000).toFixed(2)} s | Materials ${output.width} x ${output.height}: ${(record.phases.materialsMs/1000).toFixed(2)} s`;
  status(record.cached?'Depth & materials complete':'Depth & materials complete; browser could not retain this result');
  $('view-result').hidden=true;
}
async function viewResult(){
  if(!completed)return;
  const result=completed;
  $('material-size').value=String(result.size);
  const ticket=++imageTicket;
  await load(result.blob,result.record.source,result.sample,ticket);
  if(ticket===imageTicket&&completed===result)presentCompleted();
}
$('view-result').onclick=()=>viewResult().catch(fail);
for(const button of document.querySelectorAll('[data-sample]'))button.onclick=()=>sample(button.dataset.sample).catch(fail);
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>view(button.dataset.view);
function cycleView(delta){
  const available=viewOrder.filter(mode=>!document.querySelector(`[data-view=${mode}]`).disabled);
  const index=available.indexOf(viewer?.mode??'original');
  view(available[(index+delta+available.length)%available.length]);
}
$('view-prev').onclick=()=>cycleView(-1);$('view-next').onclick=()=>cycleView(1);
$('compare').onclick=compare;
for(const button of document.querySelectorAll('[data-focus]'))button.onclick=()=>view(button.dataset.focus);
$('file').onchange=()=>{const file=$('file').files[0];if(file)load(file,file.name).catch(fail);};
$('run').onclick=infer;
$('material-size').onchange=async()=>{if(state.status==='loading-image')return;try{$('run').disabled=true;await restoreCached();}catch(error){fail(error);}finally{runButton();}};
$('map').onchange=()=>{if(viewer){const map=$('map').value;view('materials');viewer.map=map;$('map').value=map;}};
$('gi').onchange=()=>{viewer.useGI=$('gi').checked;};
$('glow').onchange=()=>{viewer.glow=$('glow').checked;};
$('bloom').onchange=()=>{viewer.setEffects({bloom:$('bloom').checked});syncControls();};
for(const id of effectFields)$(id).oninput=()=>{
  try{viewer.setEffects({[id]:Number($(id).value)});$('preset-error').textContent='';}
  catch(error){$('preset-error').textContent=error.message;}
  syncControls();
};
$('gi-view').onchange=()=>{
  const diagnostic=$('gi-view').value;
  if(!viewer.comparison&&!['relit','materials'].includes(viewer.mode))view(viewer.maps?'materials':'relit');
  viewer.map='surface';$('map').value='surface';viewer.setDiagnostic(diagnostic);viewer.useGI=true;$('gi').checked=true;
  syncControls();
};
function setMaterialContrast(value){viewer.setMaterialContrast(value);syncControls();return viewer.primary.presentation().contrast;}
$('contrast-mode').onchange=()=>setMaterialContrast({mode:$('contrast-mode').value});
for(const name of ['roughness','metallic'])$(`${name}-strength`).oninput=()=>setMaterialContrast({[name]:Number($(`${name}-strength`).value)});
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
function setLightHandle(x,y){viewer.setLightHandle(x,y);syncSun();}
function dragSun(event){
  const bounds=$('light-ring').getBoundingClientRect();
  setLightPosition((event.clientX-bounds.left)/bounds.width,(event.clientY-bounds.top)/bounds.height);
}
$('sun').onpointerdown=event=>{
  if(event.button!==0||sunPointer!==null)return;
  event.preventDefault();event.stopPropagation();sunPointer=event.pointerId;
  viewer.target.set(0,0);$('sun').setPointerCapture(event.pointerId);dragSun(event);
};
$('light-ring').onpointerdown=event=>{if(!$('sun').hidden)$('sun').onpointerdown(event);};
$('sun').onpointermove=event=>{if(event.pointerId===sunPointer){event.preventDefault();event.stopPropagation();dragSun(event);}};
function releaseSun(event){if(event.pointerId===sunPointer){sunPointer=null;if($('sun').hasPointerCapture(event.pointerId))$('sun').releasePointerCapture(event.pointerId);}}
$('sun').onpointerup=$('sun').onpointercancel=$('sun').onlostpointercapture=releaseSun;
$('sun').onkeydown=event=>{
  const delta={ArrowLeft:[-.04,0],ArrowRight:[.04,0],ArrowUp:[0,.04],ArrowDown:[0,-.04]}[event.key];
  if(delta){event.preventDefault();event.stopPropagation();const light=viewer.getLightHandle();viewer.setLightHandle(light.x+delta[0],light.y+delta[1]);syncSun();}
  else if(event.key==='Home'){event.preventDefault();viewer.setLight();syncSun();}
};
function exportPreset(){if(!viewer?.surface)throw Error('Preset requires a depth surface');return viewer.exportPreset();}
async function importPreset(json){
  try{if(!viewer?.surface)throw Error('Preset requires a depth surface');await viewer.applyPreset(typeof json==='string'?JSON.parse(json):json);syncControls();$('preset-error').textContent='';return true;}
  catch(error){$('preset-error').textContent=error.message;$('advanced').open=true;showControls(true);return false;}
}
$('preset-export').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(exportPreset(),null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='material-photograph-preset.json';link.click();URL.revokeObjectURL(url);
};
$('preset-import').onclick=()=>$('preset-file').click();
$('preset-file').onchange=async()=>{
  const file=$('preset-file').files[0];
  try{if(file)await importPreset(await file.text());}catch(error){$('preset-error').textContent=error.message;}
  $('preset-file').value='';
};
function fail(error){state.status='error';state.error=error.message;status(error.message,true);runButton();}
async function changeEnvironment(name){
  if(!viewer)return false;
  const ticket=++environmentTicket;
  $('environment-status').textContent='Loading HDR';
  try{
    const applied=await viewer.loadEnvironment(name);
    if(ticket===environmentTicket){$('environment-status').textContent='';syncControls();}
    return applied;
  }catch(error){if(ticket===environmentTicket){$('environment-status').textContent=error.message;syncControls();}return false;}
}
$('environment').onchange=()=>changeEnvironment($('environment').value);
for(const [id,key]of [['environment-rotation','rotation'],['environment-intensity','intensity'],['direct-intensity','direct']])$(id).oninput=()=>{
  try{viewer.setLighting({[key]:Number($(id).value)});$('preset-error').textContent='';}catch(error){$('preset-error').textContent=error.message;}
};
window.__materialPhotoActions={infer,sample,view,compare,changeEnvironment,exportPreset,importPreset,setLightPosition,setLightHandle,setMaterialContrast,restoreCached,viewResult,
  exampleEvidence:()=>({imageKey,source:state.source,sample:sampleKey,...results.snapshot(),record:state.runs.at(-1),identity:state.identity}),
  setEffects:value=>{viewer.setEffects(value);syncControls();return viewer.getEffects();},
  materialEvidence:()=>({image,output:results.snapshot().materials}),presentation:()=>viewer?.presentation()??null,async pixels(presentedFrame){
  // Inspect the browser's presented canvas screenshot, not a discarded WebGPU drawing buffer.
  const response=await fetch(presentedFrame),bitmap=await createImageBitmap(await response.blob());
  const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d');
  context.drawImage(bitmap,0,0);bitmap.close();
  return pixelSummary(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
}};
try{await sample(params.get('sample') in photos?params.get('sample'):'orb');if(params.get('autorun')==='1')await infer();}catch(error){fail(error);}
