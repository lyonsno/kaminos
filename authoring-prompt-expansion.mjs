import {assetSource,assetWithheld} from './authoring-assets.mjs';

const referenceSource=reference=>reference?.kind==='image'?(reference.source||assetSource(reference.root,reference.path)):null;
export function promptExpansionMatches(request,current){
 return request?.model===current?.model&&referenceSource(request?.reference)===referenceSource(current?.reference);
}

// Application operation, independent of the provider's runtime/device ownership.
// A provider expands {prompt,images,signal,onText} and disposes its own resources.
export function createAuthoringPromptExpansion({createHelper,changed=()=>{},blocked=()=>null,clock=()=>performance.now()}){
 let active=false,abort=null,helper=null,started=null,state={status:'idle',draft:'',request:null,result:null,error:null};
 const set=patch=>{state={...state,...patch};changed();};
 return {
  busy:()=>active,
  read:()=>({...state,elapsedMs:started===null?null:active?clock()-started:state.elapsedMs}),
  stop(){if(!active)return false;abort.abort(Error('Prompt expansion cancelled.'));set({status:'stopping'});return true;},
  async expand({prompt,model='flux3',reference=null}){
   if(active)throw Error('Prompt expansion is already running');
   const reason=blocked();if(reason)throw Error(reason);
   if(!String(prompt||'').trim())throw Error('Describe the image before expanding its prompt');
   if(reference&&(reference.kind!=='image'||assetWithheld(reference)))throw Error('Choose an available reference image');
   const request={prompt:String(prompt),model,reference:reference?structuredClone(reference):null};
   active=true;abort=new AbortController();started=clock();
   set({status:'loading',request,draft:'',result:null,error:null,elapsedMs:null,progress:'Loading the prompt helper…'});
   try{
    helper=await createHelper({onProgress:event=>set({status:'loading',...(event.phase==='unconfigured'?{coordination:'Shared GPU coordination is unavailable on this server.'}:{}),progress:'Loading the prompt helper…'}),
     onWait:wait=>set({status:'waiting',progress:`Waiting for the shared GPU${wait.heldBy?.length?': '+wait.heldBy.join(', '):''}`})});
    const result=await helper.expand({prompt:request.prompt,images:reference?[referenceSource(reference)]:[],signal:abort.signal,
     onText:text=>set({status:'running',draft:text,progress:'Expanding your request…'})});
    if(typeof result?.text!=='string'||!result.text.trim())throw Error('The prompt helper returned an empty expansion');
    // Preserve the result before cleanup so a handback/disposal error cannot erase it.
    set({result,draft:result.text});await helper.dispose();helper=null;
    set({status:result.partial?'partial':'complete',progress:result.partial?'Partial expansion retained. Review it before use.':'Prompt expanded. You can edit it before generating.'});
    return result;
   }catch(error){
    const result=error.result||state.result;
    set({status:abort.signal.aborted?'stopped':'failed',error:String(error.message||error),...(result?{result,draft:result.text}:{}),greenroomHandback:error.greenroomHandback});
    if(!abort.signal.aborted)throw error;
    return null;
   }finally{
    try{await helper?.dispose();}catch(error){set({status:'failed',error:`Prompt cleanup failed: ${error.message}`});}
    helper=null;active=false;abort=null;set({elapsedMs:clock()-started});
   }
  },
 };
}

export function installAuthoringPromptExpansion({document,controller,assets,imageController,changed=()=>{}}){
 const byId=id=>document.getElementById(id),prompt=byId('asset-prompt');
 const root=document.createElement('div');root.className='asset-prompt-help';
 root.innerHTML=`<div class="asset-prompt-help-actions"><button type="button" id="asset-prompt-expand" title="BFL’s FLUX.3 prompt helper">Expand prompt</button><button type="button" id="asset-prompt-cancel" hidden>Cancel expansion</button><button type="button" id="asset-prompt-undo" hidden>Undo expansion</button></div><div id="asset-prompt-help-status" role="status" aria-live="polite"></div><textarea id="asset-prompt-draft" aria-label="Expanded prompt draft" rows="5" hidden></textarea><button type="button" id="asset-prompt-use" hidden>Use expanded prompt</button>`;
 prompt.insertAdjacentElement('afterend',root);
 let applied=null,timer=null,painted=null;
 const current=()=>({model:byId('asset-image-model').value,reference:byId('asset-use-reference').checked?assets.read().selected:null});
 const use=()=>{
  const state=controller.read();if(!promptExpansionMatches(state.request,current()))return false;
  const text=byId('asset-prompt-draft').value;if(!text.trim())return false;
  applied={request:state.request,result:state.result,text};prompt.value=text;prompt.dispatchEvent(new Event('input',{bubbles:true}));render();return true;
 };
 function render(){
  const state=controller.read(),busy=controller.busy(),unavailable=imageController.busy()||!!imageController.read().pending;
  byId('asset-prompt-expand').disabled=busy||unavailable||!prompt.value.trim();
  byId('asset-prompt-cancel').hidden=!busy;byId('asset-prompt-cancel').disabled=state.status==='stopping';
  prompt.readOnly=busy;
  const matches=promptExpansionMatches(state.request,current()),wasApplied=applied?.request===state.request&&prompt.value===applied.text;
  const showDraft=!!state.draft&&!wasApplied;
  const draft=byId('asset-prompt-draft');draft.hidden=!showDraft;draft.readOnly=busy;
  if(state.draft!==painted){draft.value=state.draft;painted=state.draft;}
  byId('asset-prompt-use').hidden=!showDraft||busy;byId('asset-prompt-use').disabled=!matches;
  byId('asset-prompt-undo').hidden=!wasApplied||busy;
  let message=state.error||state.progress||'';
  if(showDraft&&!busy&&!matches)message='The selected image or model changed. Restore the original selection to use this expansion, or expand again.';
  if(state.coordination)message+=` · ${state.coordination}`;
  if(state.elapsedMs!==null)message+=` · ${(state.elapsedMs/1000).toFixed(1)} s${busy?' elapsed':''}`;
  byId('asset-prompt-help-status').textContent=message;
  byId('asset-prompt-help-status').classList.toggle('error',state.status==='failed');
  if(busy&&timer===null)timer=setTimeout(()=>{timer=null;render();},200);
  else if(!busy&&timer!==null){clearTimeout(timer);timer=null;}
 }
 const expand=async()=>{
  const selection=current();if(selection.reference?.kind!=='image'&&byId('asset-use-reference').checked){byId('asset-prompt-help-status').textContent='Choose a source image in Browse or Open file first.';return;}
  applied=null;
  try{const result=await controller.expand({...selection,prompt:prompt.value});if(result&&!result.partial&&promptExpansionMatches(controller.read().request,current()))use();}
  catch{/* the operation retains the full failure and any draft */}
  render();changed();
 };
 byId('asset-prompt-expand').onclick=expand;byId('asset-prompt-cancel').onclick=()=>controller.stop();byId('asset-prompt-use').onclick=use;
 byId('asset-prompt-undo').onclick=()=>{if(applied&&prompt.value===applied.text){prompt.value=applied.request.prompt;applied=null;prompt.dispatchEvent(new Event('input',{bubbles:true}));render();}};
 prompt.addEventListener('input',render);byId('asset-image-model').addEventListener('change',render);byId('asset-use-reference').addEventListener('change',render);
 window.addEventListener('pagehide',()=>controller.stop());
 render();
 return {render,expand,provenance:()=>applied&&promptExpansionMatches(applied.request,current())?{schema:'kaminos.prompt-expansion.v1',request:applied.request,expandedPrompt:applied.text,result:applied.result}:null};
}
