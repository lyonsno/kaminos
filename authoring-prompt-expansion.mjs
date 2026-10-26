import {assetSource,assetWithheld} from './authoring-assets.mjs';

export function authoringPromptWeightRoot(config){
 if(config?.pup?.mounted===true&&typeof config.pup.modelUrl==='string'&&config.pup.modelUrl)return config.pup.modelUrl;
 throw Error('Prompt expansion is unavailable on this server.');
}

const referenceSource=reference=>reference?.kind==='image'?(reference.source||assetSource(reference.root,reference.path)):null;
export function promptExpansionMatches(request,current){
 return request?.model===current?.model&&referenceSource(request?.reference)===referenceSource(current?.reference);
}

// Application operation, independent of the provider's runtime/device ownership.
// A provider expands {prompt,images,signal,onText} and disposes its own resources.
export function createAuthoringPromptExpansion({createHelper,changed=()=>{},blocked=()=>null,clock=()=>performance.now(),keepLoaded=false}){
 let active=false,abort=null,helper=null,started=null,state={status:'idle',draft:'',request:null,result:null,error:null};
 const set=patch=>{if(Object.entries(patch).every(([key,value])=>Object.is(state[key],value)))return;state={...state,...patch};changed();};
 return {
  busy:()=>active,
  read:()=>({...state,keepLoaded,resident:!!helper?.resident,elapsedMs:started===null?null:active?clock()-started:state.elapsedMs}),
  async setKeepLoaded(value){if(active)throw Error('Finish the prompt expansion before changing residency.');keepLoaded=!!value;if(!keepLoaded){await helper?.dispose();helper=null;}changed();},
  async unload(){if(active)throw Error('Finish the prompt expansion before unloading.');await helper?.dispose();helper=null;changed();},
  async dispose(){if(active)abort.abort(Error('Prompt page closed.'));await helper?.dispose();helper=null;},
  clear(){if(active)throw Error('Finish the prompt expansion first.');started=null;state={status:'idle',draft:'',request:null,result:null,error:null};changed();},
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
    helper??=await createHelper({keepLoaded,onProgress:event=>set({status:'loading',...(event.phase==='unconfigured'?{coordination:'Shared GPU coordination is unavailable on this server.'}:{}),progress:'Loading the prompt helper…'}),
     onWait:wait=>set({status:'waiting',progress:`Waiting for the shared GPU${wait.heldBy?.length?': '+wait.heldBy.join(', '):''}`})});
    const result=await helper.expand({prompt:request.prompt,images:reference?[referenceSource(reference)]:[],signal:abort.signal,
     onText:text=>set({status:'running',draft:text,progress:'Expanding your request…'})});
    if(typeof result?.text!=='string'||!result.text.trim())throw Error('The prompt helper returned an empty expansion');
    // Preserve the result before cleanup so a handback/disposal error cannot erase it.
    set({result,draft:result.text});if(!keepLoaded){await helper.dispose();helper=null;}
    set({status:result.partial?'partial':'complete',progress:result.partial?'Partial expansion retained. Review it before use.':'Prompt expanded. You can edit it before generating.'});
    return result;
   }catch(error){
    try{await helper?.dispose();}catch(cleanup){error.cleanupError=String(cleanup.message||cleanup);}finally{helper=null;}
    const result=error.result||state.result;
    set({status:abort.signal.aborted?'stopped':'failed',error:String(error.message||error),...(result?{result,draft:result.text}:{}),greenroomHandback:error.greenroomHandback});
    if(!abort.signal.aborted)throw error;
    return null;
   }finally{
    try{if(!keepLoaded||state.status==='failed'||state.status==='stopped')await helper?.dispose();}catch(error){set({status:'failed',error:`Prompt cleanup failed: ${error.message}`});}
    if(!keepLoaded||state.status==='failed'||state.status==='stopped')helper=null;active=false;abort=null;set({elapsedMs:clock()-started});
   }
  },
 };
}

export function installAuthoringPromptExpansion({document,controller,assets,imageController,changed=()=>{},reference=()=>assets.read().selected}){
 const byId=id=>document.getElementById(id),prompt=byId('asset-prompt');
 const root=document.createElement('div');root.className='asset-prompt-help';
 root.innerHTML=`<div class="asset-prompt-help-actions"><button type="button" id="asset-prompt-expand" title="BFL’s FLUX.3 prompt helper">Expand prompt</button><button type="button" id="asset-prompt-cancel" hidden>Cancel expansion</button><button type="button" id="asset-prompt-undo" hidden>Undo expansion</button></div><div id="asset-prompt-help-status" role="status" aria-live="polite"></div><textarea id="asset-prompt-draft" aria-label="Expanded prompt draft" rows="5" hidden></textarea><button type="button" id="asset-prompt-use" hidden>Use expanded prompt</button>`;
 prompt.insertAdjacentElement('afterend',root);
 const residentControls=document.createElement('div');residentControls.className='asset-prompt-residency';residentControls.innerHTML=`<label title="Retain prompt-helper weights between edits. Each expansion still waits for and releases the shared GPU. Closing the tab unloads them."><input type="checkbox" id="asset-prompt-keep-loaded"> Keep prompt helper loaded</label><button type="button" id="asset-prompt-unload" hidden>Unload</button><span id="asset-prompt-residency-status"></span>`;root.append(residentControls);
 const preference='kaminos.prompt-helper-residency.v1';let explicitPreference=false,residencyError='';
 const chooseResidency=async value=>{try{await controller.setKeepLoaded(value);render();}catch(error){residencyError=error.message;render();}};
 try{const saved=document.defaultView.localStorage.getItem(preference);if(saved!==null){const value=JSON.parse(saved);if(typeof value.keepLoaded==='boolean'){explicitPreference=true;chooseResidency(value.keepLoaded);}}}catch(error){residencyError=`Preference unavailable: ${error.message}`;}
 byId('asset-prompt-keep-loaded').onchange=async()=>{explicitPreference=true;const keepLoaded=byId('asset-prompt-keep-loaded').checked;await chooseResidency(keepLoaded);try{document.defaultView.localStorage.setItem(preference,JSON.stringify({keepLoaded}));}catch(error){residencyError=`Preference not saved: ${error.message}`;render();}};
 byId('asset-prompt-unload').onclick=()=>controller.unload().catch(error=>{residencyError=error.message;render();});
 let applied=null,timer=null,painted=null;
 const current=()=>({model:byId('asset-image-model').value,reference:byId('asset-use-reference').checked?reference():null});
 const use=()=>{
  const state=controller.read();if(!promptExpansionMatches(state.request,current()))return false;
  const text=byId('asset-prompt-draft').value;if(!text.trim())return false;
  applied={request:state.request,result:state.result,text};prompt.value=text;prompt.dispatchEvent(new Event('input',{bubbles:true}));render();return true;
 };
 function render(){
  const state=controller.read(),busy=controller.busy(),unavailable=imageController.busy()||!!imageController.read().pending;
  byId('asset-prompt-keep-loaded').checked=state.keepLoaded;byId('asset-prompt-keep-loaded').disabled=busy;byId('asset-prompt-unload').hidden=!state.resident;byId('asset-prompt-unload').disabled=busy;byId('asset-prompt-residency-status').textContent=residencyError||(state.resident?'Loaded in this tab':state.keepLoaded?'Retains weights after the first expansion':'Unloads after each expansion');
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
 document.defaultView.addEventListener('pagehide',()=>controller.dispose().catch(()=>{}));
 render();
 return {render,expand,configureDefault:value=>{if(!explicitPreference)return chooseResidency(value===true);},reset(){applied=null;painted=null;controller.clear();},recall(provenance){applied=provenance?.promptExpansion?{request:provenance.promptExpansion.request,result:provenance.promptExpansion.result,text:provenance.promptExpansion.expandedPrompt}:null;painted=null;controller.clear();},provenance:()=>applied&&promptExpansionMatches(applied.request,current())?{schema:'kaminos.prompt-expansion.v1',request:applied.request,expandedPrompt:applied.text,result:applied.result}:null};
}
