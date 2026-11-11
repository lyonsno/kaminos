import {createSceneWorkerPage,captureSceneWorkerCamera,applySceneWorkerSurfaces,mergeSceneWorkerUi} from './scene-worker-page.mjs';
import {mountSceneWorkerEditor} from './scene-worker-editor-page.mjs';
import {createSceneWorkerImageController} from './scene-worker-image-controller.mjs';
import {checkedCameraView} from './scene-camera-views.mjs';
import {resolveSceneWorkerStartupInput} from './scene-worker-startup-input.mjs';

export function assertSceneWorkerStartup(reply,{admission,preferences,ui=reply.output?.ui}){
 const applied=ui?.initialization;
 if(admission?.data!=null&&applied?.sceneApplied!==true)throw Error('Worker has not confirmed applying the saved scene');
 if(preferences!=null&&applied?.preferencesApplied!==true)throw Error('Worker has not confirmed applying startup preferences');
}

// Page presentation only. The actual worker entry supplies the domain graph,
// saved-scene application, registry commands and their plain status projection.
// The normal page route continues using its existing boot and editor setup.
export function mountSceneWorkerPage({document,window,THREE,createControls,installNavigation,frameBox,
 admission,preferences,readFlameControls,entryUrl='/scene-worker.entry.bundle.mjs',createWorker,
 report=()=>{},onProgress=()=>{},createPage=createSceneWorkerPage}={}){
 const viewport=document.getElementById('viewport');
 const canvases={};let controls,navigation,editor;
 try {
 for(const id of ['kaminos-host-renderer-canvas','kaminos-volume-canvas'])if(document.getElementById(id))throw Error(`Worker page canvas already mounted: ${id}`);
 for(const [name,id] of [['scene','kaminos-host-renderer-canvas'],['volume','kaminos-volume-canvas']]){
  if(document.getElementById(id))throw Error(`Worker page canvas already mounted: ${id}`);
  const canvas=document.createElement('canvas');canvas.id=id;canvas.dataset.sceneWorkerSurface=name;
  if(name==='scene'){canvas.style.width='100%';canvas.style.height='100%';canvas.style.display='block';}
  viewport.appendChild(canvas);canvases[name]=canvas;
 }
 const readViewport=()=>({width:viewport.clientWidth,height:viewport.clientHeight,pixelRatio:Math.min(window.devicePixelRatio||1,2)});
 const size=readViewport(),camera=new THREE.PerspectiveCamera(40,size.width/size.height,.01,100);camera.position.set(0,.6,3);
 controls=createControls(camera,canvases.scene);
 Object.assign(controls,{enableDamping:true,dampingFactor:.06,rotateSpeed:-.72,panSpeed:.45,zoomSpeed:.85,screenSpacePanning:true,minDistance:.5,maxDistance:Infinity});
 controls.mouseButtons={LEFT:null,MIDDLE:null,RIGHT:null};controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};controls.target.set(0,0,0);
 const saved=resolveSceneWorkerStartupInput({preferences,location:window.location,admission}).camera;
 if(saved){
  for(const key of ['position','up'])if(Array.isArray(saved[key])&&saved[key].length===3)camera[key].fromArray(saved[key]);
  if(Array.isArray(saved.target)&&saved.target.length===3)controls.target.fromArray(saved.target);
  for(const key of ['near','far','fov'])if(Number.isFinite(saved[key]))camera[key]=saved[key];
 }
 camera.updateProjectionMatrix();controls.update();
 const navigationInput=document.getElementById('navigation-input-mode');
 let savedInput;try{savedInput=window.localStorage.getItem('kaminos.navigationInput');}catch{}
 navigationInput.value=preferences?.navigationInput??(['trackpad','mouse'].includes(savedInput)?savedInput:/Mac/i.test(window.navigator.userAgentData?.platform||window.navigator.platform)?'trackpad':'mouse');
 const navigationHint=document.getElementById('navigation-hint');
 const hint=text=>{navigationHint.textContent=text||'Worker scene · navigation uses the current camera pivot; mesh-surface picking is not connected yet';navigationHint.dataset.active=String(!!text);};hint('');
 let ui=null,closed=false;
 function boundsFrame(value){
  if(!value){report('Scene bounds have not been reported by the worker');return false;}
  if(![value.min,value.max].every(row=>Array.isArray(row)&&row.length===3&&row.every(Number.isFinite)))throw Error('Worker scene bounds are malformed');
  return frameBox(new THREE.Box3(new THREE.Vector3(...value.min),new THREE.Vector3(...value.max)),camera,controls);
 }
 navigation=installNavigation({canvas:canvases.scene,viewport,camera,controls,roots:()=>[],
  frameAll:()=>boundsFrame(ui?.bounds),frameSelected:()=>boundsFrame(ui?.selectionBounds),inputMode:()=>navigationInput.value,status:hint,document,window});
 const navigationChanged=()=>{try{window.localStorage.setItem('kaminos.navigationInput',navigationInput.value);}catch{}hint('');navigationInput.blur();};
 navigationInput.addEventListener('change',navigationChanged);
 const page=createPage({entryUrl,...(createWorker?{createWorker}:{}),sceneCanvas:canvases.scene,volumeCanvas:canvases.volume,
  readViewport,readCamera:()=>captureSceneWorkerCamera(camera,controls.target),readFlameControls,
  initializePayload:{camera:captureSceneWorkerCamera(camera,controls.target),admission,preferences,location:{href:window.location.href,search:window.location.search,hash:window.location.hash}},
  validateInitialization:(reply,ui)=>assertSceneWorkerStartup(reply,{admission,preferences,ui}),
  beforeFrame(){const size=readViewport();if(camera.aspect!==size.width/size.height){camera.aspect=size.width/size.height;camera.updateProjectionMatrix();}controls.update();},
  applyUi(value){
   const restored=value.camera==null?null:checkedCameraView(value.camera);
   const next=mergeSceneWorkerUi(ui,value);if(next.surfaces)applySceneWorkerSurfaces(canvases,next.surfaces);
   if(restored){
    // A document changes the page input owner too. Consume only this explicit
    // reply, never the merged cache on later surface/status updates.
    const damping=controls.enableDamping;controls.enableDamping=false;
    try{controls.update();camera.position.fromArray(restored.position);camera.up.fromArray(restored.up);controls.target.fromArray(restored.target);
     for(const key of ['fov','near','far'])camera[key]=restored[key];camera.updateProjectionMatrix();controls.update();}
    finally{controls.enableDamping=damping;}
   }
   if(value.environmentLoading){const state=value.environmentLoading,label=document.getElementById('env-loading');if(label){label.style.display=state.quality==='full'?'none':'block';label.textContent=state.pending?`${state.name??'Environment'} · lighting loading…`:`${state.name??'Environment'} · ${state.quality==='preview'?'preview lighting':'neutral fallback'} · full map unavailable`;}}
   ui=next;if(Object.keys(value).some(key=>['objects','selection','groups','history','document'].includes(key)))editor?.render(ui);
  },
  onPhase(value){
   for(const canvas of Object.values(canvases))canvas.dataset.sceneWorkerState=value;
   if(value==='active')report('Scene loaded');
   if(['held','retiring','retired','closed'].includes(value)){ui=null;editor?.render(null);report(`Worker scene ${value}; previous scene metadata is unavailable`);}
  },
  onProgress,onError:error=>report(`Worker scene: ${error.message}`)});
 if(document.getElementById('scene-object-list'))editor=mountSceneWorkerEditor({document,window,page,readCamera:()=>captureSceneWorkerCamera(camera,controls.target),readUi:()=>ui,report});
 const image=createSceneWorkerImageController({page});
 function detach(){if(closed)return;closed=true;editor?.dispose();navigation.dispose();controls.dispose();navigationInput.removeEventListener('change',navigationChanged);}
 const pagehide=()=>{page.holdFrames('Page leaving; resource retirement requested');void page.retire().then(detach,error=>report(`Worker cleanup held: ${error.message}`));};
 window.addEventListener('pagehide',pagehide,{once:true});
 return Object.freeze({page,image,editor,frameSelected:()=>boundsFrame(ui?.selectionBounds),camera,controls,navigation,canvases,
  start:()=>page.start(),
  async retire(){const result=await page.retire();detach();window.removeEventListener('pagehide',pagehide);for(const canvas of Object.values(canvases))canvas.remove();return result;},
  read:()=>({worker:page.read(),ui,navigation:navigation.state()}),
 });
 }catch(error){editor?.dispose();navigation?.dispose();controls?.dispose();for(const canvas of Object.values(canvases))canvas.remove();throw error;}
}
