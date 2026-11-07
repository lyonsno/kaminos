import {ClippingGroup,Mesh,MeshStandardMaterial,BufferGeometry} from './lib/three.webgpu.js';
import {createKilnPromptStrip} from './kiln-prompt-strip.mjs';
import {installKilnPromptEditor,KILN_PROMPT_WINDOW_HEIGHT} from './kiln-prompt-editor.mjs';
import {createKilnPromptPreparation} from './kiln-prompt-preparation.mjs';
import {createKilnBurnWindow} from './kiln-burn-window.mjs';
import {mountedWaterPresentation} from './mounted-workshop-water.mjs';
import {promptReliefMetadata} from './inference-kiln-record.mjs';

// The mounted workshop owns membership and the app owns camera/rendering. This
// consumer owns only native editing and the admitted solid-text preparation.
export async function createMountedGenerationPrompt({document,workshop,camera,onFrame,input,signal,prompt='',request=null,controls=null,statusSlot=null,createBurnBody=null,createFire=null,clock=()=>performance.now(),changed=()=>{}}){
 const viewport=document.getElementById('viewport');
 // Initial authored pose in cold-stage's kiln opening; it remains a normal
 // editable workshop member after mounting. Text scrolls within this window.
 const root=new ClippingGroup();root.name='Generation prompt';root.position.set(1.2,2.46,-3.4);root.rotation.y=-.15;root.scale.setScalar(1.75);
 const material=new MeshStandardMaterial({color:0xb8b2a8,roughness:.8});material.userData.kaminosBurnAppearance='composed';
 const mesh=new Mesh(new BufferGeometry(),material);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
 // Match the relief's front face (.0175) to the native editor plane (.018),
 // including oblique views of the kiln rather than only front-on projection.
 mesh.position.z=.0005;
 const strip=createKilnPromptStrip({root,mesh,windowHeight:KILN_PROMPT_WINDOW_HEIGHT});
 let disposed=false,serial=0,timer=null,admitted=null,prepared=null,preparing=null,error=null,visible=false,admittedScroll=0;
 const editor=installKilnPromptEditor({document,viewport,input,camera,object:root,presentation:mesh,onChange:schedule,onScroll:alignSolid,onError:e=>{error=e.message;changed();}});
 const preparation=createKilnPromptPreparation({rasterize:editor.rasterize,Worker:document.defaultView.Worker});
 let handle=null,stop=()=>{},body=null,installation=Promise.resolve(),fire=null,firePreparation=null,burnWindow=null,active=false,startedRequest=null,finishResolve=null;
 const failure=e=>{if(!disposed){error=e.message;active=false;editor.setBurning(false);changed();}};
 function advance(){
  if(!burnWindow||!active)return;
  if(visible&&workshop.read().amount===1)burnWindow.resume();else burnWindow.pause();
  const state=burnWindow.read();fire?.setEmission(visible&&state.emitting);strip.advance(state.progress);
  if(state.done&&finishResolve)complete().catch(failure);
 }
 function presentation(){const parent=mountedWaterPresentation(root);return {translate:parent.translation,scale:parent.scale};}
 const layer=viewport.querySelector('.kiln-prompt-plane');layer.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5;';layer.hidden=true;input.style.pointerEvents='auto';
 // Keep the full solid at the native scrolling window origin. Admission freezes
 // that origin; later draft scrolling cannot move the submitted burn source.
 function alignSolid(){if(prepared)strip.scroll(admitted?admittedScroll:input.scrollTop);}
 function schedule(){clearTimeout(timer);timer=null;if(disposed||admitted)return;timer=setTimeout(()=>{timer=null;if(disposed||admitted)return;prepare({prompt:input.value}).catch(e=>{if(!disposed){error=e.message;changed();}});},250);}
 async function complete(){
  active=false;admitted=null;error=null;burnWindow=null;startedRequest=null;
  fire?.setEmission(false);
  try{await fire?.setActive(false);}finally{editor.setBurning(false);strip.release();finishResolve?.();finishResolve=null;schedule();}
 }
 async function prepare(next){
  clearTimeout(timer);timer=null;const token=++serial;admittedScroll=input.scrollTop;const previousId=admitted?.id;admitted=next.request?structuredClone(next.request):null;error=null;
  if(admitted?.id!==previousId){burnWindow=admitted?createKilnBurnWindow({seconds:mesh.userData.kaminosPromptRelief?.burnerSeconds??5,flares:mesh.userData.kaminosPromptRelief?.burnerFlares??3,pauseSeconds:mesh.userData.kaminosPromptRelief?.burnerPauseSeconds??1,clock}):null;startedRequest=null;}
  const work=next.prompt.trim()?preparation.prepare(next.prompt):Promise.resolve(null);preparing=work;
  try{const result=await work;if(disposed||token!==serial)return;
   // Serial installation keeps an obsolete async body from restoring its old
   // material over a newer draft. Geometry and thermal state share one lifetime.
   const install=installation.catch(()=>{}).then(async()=>{
    if(disposed||token!==serial)return;
    if(prepared!==result){
     body?.dispose();body=null;
     const old=mesh.geometry;mesh.geometry=result?result.geometry.clone():new BufferGeometry();old.dispose();
     if(result)mesh.userData.kaminosPromptRelief={...mesh.userData.kaminosPromptRelief,...promptReliefMetadata(result.text,'composed')};
     prepared=result;
    }
    if(!result){mesh.visible=false;return;}
    strip.prepare(result.height,admitted?admittedScroll:input.scrollTop);
    if(createBurnBody&&handle&&!body){
     const candidate=await createBurnBody({entry:{id:handle.id,object:root,burnable:{enabled:true,appearance:{profile:'composed',glow:1},structure:false,fracture:false}},surfaceMask:result.surfaceMask,surfacePresentation:strip.attachSurface});
     if(disposed){candidate.dispose();return;}
     // A later admission of this draft can retain the construction in flight.
     // A different queued draft disposes it before replacing any geometry.
     body=candidate;body.setMounted(false);
    }
   });installation=install;await install;
  }finally{if(preparing===work)preparing=null;changed();}
 }
 async function dispose(){if(disposed)return;disposed=true;serial++;clearTimeout(timer);stop();finishResolve?.();finishResolve=null;await fire?.dispose();preparation.dispose();editor.dispose();body?.dispose();body=null;root.visible=false;}
 try {
 await prepare({prompt,request});signal.throwIfAborted();
 handle=await workshop.attach(root,{type:'pbr',label:'Generation prompt',source:null,waterCollision:false});
 await prepare({prompt,request});signal.throwIfAborted();
 if(createFire){fire=await createFire({root,body:()=>body,burning:()=>active&&visible,signal});firePreparation=fire.prepare();firePreparation.catch(failure);}
 stop=onFrame(()=>{
  const mounted=workshop.read().amount>0&&root.parent!==null&&root.visible&&workshop.handles().some(h=>h.id===handle.id);
  visible=mounted;if(fire)fire.present(mounted&&workshop.read().amount===1,presentation()).catch(failure);advance();if(statusSlot)statusSlot.hidden=workshop.read().amount===0;if(controls)controls.hidden=!mounted;layer.hidden=!mounted;layer.style.opacity=String(workshop.read().amount);
  // Editor follows the shared camera and the native transform, including Undo.
  if(mounted){strip.sync();editor.position();}
  body?.setMounted(mounted&&active);
 });
 }catch(error){await dispose();throw error;}
 return {prepare,get thermalBody(){return body;},syncEditor(){editor.sync();input.style.pointerEvents='auto';},
  async setActive(value){
   if(value){
    if(!fire)throw Error('Mounted combustion is not connected yet.');
    await firePreparation;await installation;if(disposed)return;
    if(!admitted||!body||!burnWindow)throw Error('No prepared admitted text to burn');
    if(startedRequest!==admitted.id){body.reset();strip.admit();burnWindow.start();burnWindow.pause();startedRequest=admitted.id;}
    active=true;editor.setBurning(true);advance();await fire.setActive(visible);
   }else{active=false;burnWindow?.pause();fire?.setEmission(false);try{await fire?.setActive(false);}finally{editor.setBurning(false);finishResolve?.();finishResolve=null;}}
  },
  finish(){if(!burnWindow)return Promise.resolve();const done=new Promise(resolve=>{finishResolve=resolve;});advance();return done;},
  complete,
  async cancel(){return this.complete();},
  debugState:()=>({route:'mounted-app-viewport',visible,prompt:prepared?.text??null,request:admitted?.id??null,preparing:!!preparing,error,physicalCombustion:!!fire&&active,burner:burnWindow?.read()??null,field:fire?.read()??null,thermal:body?.read()??null,preparation:preparation.read()}),
  dispose,
 };
}
