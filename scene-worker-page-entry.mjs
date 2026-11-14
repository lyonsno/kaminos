import * as THREE from './lib/three.webgpu.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {installSceneWorkerAssetsDrawer} from './scene-worker-assets-page.mjs';
import {mountSceneWorkerPage} from './scene-worker-page-bootstrap.mjs';
import {installSceneNavigation} from './scene-navigation.mjs';
import {frameBox} from './scene-frame-selected.mjs';
import {installAuthoringWorkspace} from './authoring-workspace.mjs';
import {createUserPreferences} from './user-preferences.mjs';
import {planSceneRestore} from './scene-persistence-core.js';
import {settleStartupVeil} from './startup-veil.mjs';
import {initializeVolumeCockpitLayout} from './volume-cockpit-layout.mjs';
import {readVolumeRuntimeControlValues,volumeAperturePatternValue,createInitialVolumeRuntimeRoute} from './volume-runtime-control-values.mjs';
import {ADAPTIVE_MATERIAL_FIELDS,readAdaptiveMaterialControls} from './volume-adaptive-material-controls.mjs';
import {resolveFlameLightingRoute} from './scene-authoring.mjs';
import {chooseSavedSceneFromLibrary} from './scene-library-client.mjs';
import {pickSavedScene} from './scene-load-picker.mjs';

// Plain current input values only; geometry, simulation, loading and canonical
// scene application remain with the existing worker owners.
export function readSceneWorkerPageControls({document=globalThis.document,location=globalThis.location}={}){
 const lightFieldParams=new URLSearchParams(location.search);
 for(const [key,value]of new URLSearchParams(location.hash.replace(/^#/,'')))if(key.startsWith('volume_light_field'))lightFieldParams.set(key,value);
 const readControl=id=>{const el=document.getElementById(id);if(!el)return undefined;
  return {value:id==='volume-emitter-aperture-pattern'?volumeAperturePatternValue(el):el.value,checked:el.checked,requestedValue:id==='volume-scene'?el.dataset.volumeSceneRequest:undefined};};
 const descriptors=Object.fromEntries(ADAPTIVE_MATERIAL_FIELDS.map(field=>{const el=document.getElementById(field.id);return[field.id,{value:el?.type==='checkbox'?!!el.checked:el?.value}];}));
 const adaptive=readAdaptiveMaterialControls(descriptors);
 return readVolumeRuntimeControlValues({readControl,params:new URLSearchParams(location.search),lightFieldParams:resolveFlameLightingRoute(lightFieldParams),route:createInitialVolumeRuntimeRoute(),adaptiveMaterial:adaptive.enabled?adaptive.options:null});
}

export async function startSceneWorkerPage({document=globalThis.document,window=globalThis.window}={}){
 const report=message=>{document.getElementById('info-bar').textContent=message;},location=window.location;
 const initialization=(async()=>{
  document.body.classList.add('scene-worker-page');
  const sceneFile=new URLSearchParams(location.hash.slice(1)).get('scene');
  window.kaminosStartup?.phase(sceneFile?'Reading saved scene':'Preparing workspace');
  // Preserve the current startup admission contract while the worker's scene
  // owner retains actual recipe/application and applied-state certification.
  const sceneData=(async()=>{
   if(!sceneFile)return null;
   const early=window.__kaminosEarlySceneText;window.__kaminosEarlySceneText=null;
   const text=early?.filename===sceneFile?await early.text:await fetch('/api/read?root=scenes&path='+encodeURIComponent(sceneFile)+'&raw=1',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error('Scene unavailable: '+sceneFile);return response.text();});
   return JSON.parse(text);
  })();
  const preferencesLoaded=createUserPreferences().load().catch(error=>{console.warn('User preferences unavailable:',error.message);return null;});
  const [data,preferences]=await Promise.all([sceneData,preferencesLoaded]);
  const admission={data,plan:data?planSceneRestore(data):null,sceneFile};
  window.kaminosStartup?.phase('Starting scene worker');
  const owner=mountSceneWorkerPage({document,window,THREE,createControls:(camera,canvas)=>new OrbitControls(camera,canvas),installNavigation:installSceneNavigation,frameBox,
   admission,preferences,readFlameControls:()=>readSceneWorkerPageControls({document,location}),report,
   onProgress:event=>{const phase=event.value?.phase;if(typeof phase==='string')window.kaminosStartup?.phase(phase);}});
  window.kaminosSceneWorker=owner;
  window.kaminosAssets=installSceneWorkerAssetsDrawer({document,owner,report});
  const layout=await initializeVolumeCockpitLayout({documentRef:document});window.__kaminosVolumeCockpitLayoutReceipt=layout;
  const setActiveTab=tab=>{document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab));document.querySelectorAll('.tab-content').forEach(el=>el.classList.toggle('active',el.id==='tab-'+tab));};
  const workspace=installAuthoringWorkspace({document,edits:owner.editor.edits,availableControlsOnly:true,
   initialMode:new URLSearchParams(location.hash.slice(1)).get('workspace')==='authoring'?'authoring':'workbench',openWorkbenchTab:setActiveTab});
  window.kaminosWorkspace=workspace;workspace.setWorkbenchInspector(true);window.kaminosFrameSelected=owner.frameSelected;
  window.selectSceneField=id=>owner.editor.select([id]).catch(error=>report(error.message));
  for(const tab of document.querySelectorAll('.tab'))tab.addEventListener('click',()=>tab.dataset.tab==='generate'?window.kaminosAssets.open('generate'):setActiveTab(tab.dataset.tab));
  for(const selector of ['#authoring-box','#authoring-duplicate','#authoring-delete','#authoring-group-selection','#authoring-presets button','#authoring-gizmo-slot button','#selection-orientation','#selection-pivot','#viewport-studio-look-select','#authoring-viewport-settings input','#authoring-object-tools button','#authoring-transform-slot button','#scene-add-menu button','#composition-capture','button[onclick="exportGLB()"]'])for(const control of document.querySelectorAll(selector)){control.disabled=true;control.title='Unavailable in this preview';}
  window.openSavedScene=async()=>{if(document.querySelector('.scene-load-picker'))return;
   try{const choice=await chooseSavedSceneFromLibrary({pickSavedScene,request:fetch,resolveDocument:false});if(choice==='browse'){document.getElementById('scene-file-input').click();return;}if(choice)await owner.editor.openSaved(choice);}catch(error){report(error.message);}};
  const fileInput=document.getElementById('scene-file-input');fileInput.addEventListener('change',()=>{const file=fileInput.files[0];fileInput.value='';if(file)void owner.editor.load(file).catch(error=>report('Scene load failed: '+error.message));});
  window.addEventListener('keydown',event=>{if(event.target?.closest?.('input,textarea,select,[contenteditable="true"]')||!(event.metaKey||event.ctrlKey))return;
   if(event.key.toLowerCase()==='s'){event.preventDefault();void(event.shiftKey?owner.editor.save({saveAs:true,promptName:true}):owner.editor.save());}
   if(event.key.toLowerCase()==='o'){event.preventDefault();void window.openSavedScene();}});
  await owner.start();void owner.image.refresh().catch(error=>report('Image status unavailable: '+error.message));return owner;
 })();
 try{return await settleStartupVeil(document,initialization);}catch(error){report('Scene worker startup failed: '+error.message);throw error;}
}
