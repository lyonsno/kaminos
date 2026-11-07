import {ClippingGroup,Mesh,MeshStandardMaterial,BufferGeometry} from './lib/three.webgpu.js';
import {createKilnPromptStrip} from './kiln-prompt-strip.mjs';
import {installKilnPromptEditor,KILN_PROMPT_WINDOW_HEIGHT} from './kiln-prompt-editor.mjs';
import {createKilnPromptPreparation} from './kiln-prompt-preparation.mjs';
import {promptReliefMetadata} from './inference-kiln-record.mjs';

// The mounted workshop owns membership and the app owns camera/rendering. This
// consumer owns only native editing and the admitted solid-text preparation.
export async function createMountedGenerationPrompt({document,workshop,camera,onFrame,input,signal,prompt='',request=null,controls=null,statusSlot=null,createBurnBody=null,changed=()=>{}}){
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
 let handle=null,stop=()=>{},body=null,installation=Promise.resolve();
 const layer=viewport.querySelector('.kiln-prompt-plane');layer.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5;';layer.hidden=true;input.style.pointerEvents='auto';
 // Keep the full solid at the native scrolling window origin. Admission freezes
 // that origin; later draft scrolling cannot move the submitted burn source.
 function alignSolid(){if(prepared)strip.scroll(admitted?admittedScroll:input.scrollTop);}
 function schedule(){clearTimeout(timer);timer=null;if(disposed||admitted)return;timer=setTimeout(()=>{timer=null;if(disposed||admitted)return;prepare({prompt:input.value}).catch(e=>{if(!disposed){error=e.message;changed();}});},250);}
 async function prepare(next){
  clearTimeout(timer);timer=null;const token=++serial;admittedScroll=input.scrollTop;admitted=next.request?structuredClone(next.request):null;error=null;
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
 function dispose(){if(disposed)return;disposed=true;serial++;clearTimeout(timer);stop();preparation.dispose();editor.dispose();body?.dispose();body=null;root.visible=false;}
 try {
 await prepare({prompt,request});signal.throwIfAborted();
 handle=await workshop.attach(root,{type:'pbr',label:'Generation prompt',source:null,waterCollision:false});
 await prepare({prompt,request});signal.throwIfAborted();
 stop=onFrame(()=>{
  const mounted=workshop.read().amount>0&&root.parent!==null&&root.visible&&workshop.handles().some(h=>h.id===handle.id);
  visible=mounted;if(statusSlot)statusSlot.hidden=workshop.read().amount===0;if(controls)controls.hidden=!mounted;layer.hidden=!mounted;layer.style.opacity=String(workshop.read().amount);
  // Editor follows the shared camera and the native transform, including Undo.
  if(mounted){strip.sync();editor.position();}
  body?.setMounted(false);
 });
 }catch(error){dispose();throw error;}
 return {prepare,get thermalBody(){return body;},syncEditor(){editor.sync();input.style.pointerEvents='auto';},
  async setActive(active){
   // No substitute flame: the retained moving gas producer must be composed
   // before the request can truthfully claim physical combustion.
   if(active){error='Mounted combustion is not connected yet.';throw Error(error);}
   else {editor.setBurning(false);}
  },
  complete(){admitted=null;error=null;editor.setBurning(false);schedule();},
  cancel(){admitted=null;error=null;editor.setBurning(false);schedule();},
  debugState:()=>({route:'mounted-app-viewport',visible,prompt:prepared?.text??null,request:admitted?.id??null,preparing:!!preparing,error,physicalCombustion:false,thermal:body?.read()??null,preparation:preparation.read()}),
  dispose,
 };
}
