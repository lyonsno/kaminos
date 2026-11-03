import {AUTHORING_IMAGE_MODELS,KLEIN_IMAGE_SIZES,KLEIN_ASPECTS,kleinImageDimensions,readPngProvenance} from './authoring-image-generation.mjs';
import {assetSource,assetWithheld} from './authoring-assets.mjs';

const sourceOf=e=>e?.source||(e?.root&&e?.path?assetSource(e.root,e.path):null);
const clone=x=>structuredClone(x);

// Reuse the actual Generate controls. Refuse a recipe they cannot represent;
// do not make a default value masquerade as the original experiment.
export function imageGenerationRecipe(p){
 if(p?.schema!=='kaminos.image-generation.v1')throw Error('No supported generation recipe is recorded in this image.');
 const model=Object.keys(AUTHORING_IMAGE_MODELS).find(key=>p.model===key||p.model===AUTHORING_IMAGE_MODELS[key].name);
 if(!model)throw Error(`Unsupported recipe model: ${p.model??'not recorded'}`);
 if(typeof p.prompt!=='string'||!p.prompt.trim())throw Error('The recipe has no recorded prompt.');
 if(!Number.isSafeInteger(p.seed)||p.seed<0)throw Error('The recipe has no supported recorded seed.');
 const size=Math.max(p.width,p.height),aspect=p.aspect??KLEIN_ASPECTS.find(a=>{const d=kleinImageDimensions(size,a);return d.width===p.width&&d.height===p.height;});
 const d=kleinImageDimensions(size,aspect);
 if(!KLEIN_IMAGE_SIZES.includes(size)||!KLEIN_ASPECTS.includes(aspect)||d.width!==p.width||d.height!==p.height)throw Error(`Unsupported recipe dimensions: ${p.width} × ${p.height}`);
 if(!AUTHORING_IMAGE_MODELS[model].levels.includes(p.weightsLevel))throw Error(`Unsupported or missing recorded recipe weight precision: ${p.weightsLevel??'not recorded'}`);
 if(p.reference&&!sourceOf(p.reference))throw Error('The recipe reference image has no recorded source.');
 if(p.completion?.earlyDecoded||p.completion?.partial)throw Error('This recipe was decoded early; its partial stopping point cannot be replayed by these controls.');
 const textLength=model==='flux3'?'model':p.textLength??'fit16';
 if(model==='flux2'&&!['fit','fit16'].includes(textLength))throw Error(`Unsupported recipe prompt length: ${textLength}`);
 return {model,prompt:p.prompt,seed:p.seed,size,aspect,level:p.weightsLevel,reference:p.reference?{...clone(p.reference),source:sourceOf(p.reference),kind:'image'}:null,textLength};
}

export function imageRecipeChanges(before,after){
 const keys=['model','prompt','seed','size','aspect','level','reference'];
 return keys.flatMap(field=>{
  const value=r=>field==='reference'?sourceOf(r.reference):r[field];
  return value(before)===value(after)?[]:[{field,before:value(before)??null,after:value(after)??null}];
 });
}

// The same operation serves the history button, a saved-image link and agents.
// Reading another image never implicitly changes the active recipe parent.
export function createImageRecipeIteration({history,assets,readControls,applyControls,recallPrompt=()=>{},resetPrompt=()=>{},changed=()=>{},busy=()=>false,
 fetchBytes=async source=>{const r=await fetch(source);if(!r.ok)throw Error(`Image recipe HTTP ${r.status}`);return new Uint8Array(await r.arrayBuffer());}}){
 let parent=null,baseline=null,error=null,opening=false,ticket=0,experiment=null;
 const read=()=>({parent:parent?{source:parent.source,name:parent.name}:null,experiment:clone(experiment),error,opening,changes:baseline?imageRecipeChanges(baseline,readControls()):[]});
 const requireIdle=()=>{if(busy())throw Error('Finish the current generation before opening another recipe.');};
 function recall(entry){
  requireIdle();++ticket;opening=false;
  try{
   if(entry?.kind!=='image'||assetWithheld(entry)||!sourceOf(entry))throw Error('Choose an available image recipe.');
   const request=imageGenerationRecipe(entry.provenance);
   if(request.reference){
    const existing=history.read().entries.find(e=>e.source===request.reference.source);
    if(existing&&assetWithheld(existing))throw Error('The recorded recipe reference is withheld.');
    history.record(existing??request.reference);history.useReference(request.reference.source);
   }
   const saved=history.record({...entry,source:sourceOf(entry)});assets.select(saved);
   applyControls(request);recallPrompt(entry.provenance);
   parent=clone(saved);baseline=request;experiment=clone(entry.experiment??entry.provenance.experiment??null);error=null;changed();return read();
  }catch(e){error=e.message;changed();throw e;}
 }
 return {
  read,recall,
  clear(){requireIdle();resetPrompt();++ticket;opening=false;parent=null;baseline=null;experiment=null;error=null;changed();},
  joinExperiment(value,{preserveRecipe=false}={}){requireIdle();if(!value?.id||!value?.title)throw Error('Choose a saved experiment');if(!preserveRecipe||experiment?.id!==value.id)this.clear();experiment=clone(value);changed();},
  editImage(entry){const destination=entry?.experiment??entry?.provenance?.experiment??experiment;this.clear();if(destination)this.joinExperiment(destination);},
  async open(entry){
   requireIdle();const own=++ticket;opening=true;error=null;changed();
   try{
    if(entry?.kind!=='image'||assetWithheld(entry)||!sourceOf(entry))throw Error('Choose an available image recipe.');
    const bytes=await fetchBytes(sourceOf(entry));
    if(own!==ticket)throw Error('Image recipe opening was superseded.');
    const provenance=readPngProvenance(bytes);
    if(!provenance)throw Error('This image has no saved generation metadata. Its recipe has not been restored.');
    return recall({...entry,source:sourceOf(entry),provenance});
   }catch(e){if(own===ticket){opening=false;error=e.message;changed();}throw e;}
  },
  decorate(request){
   if(opening)throw Error('Wait for the image recipe to finish opening.');
   if(!parent)return experiment?{...request,experiment:clone(experiment)}:request;
   const p=parent.provenance,sameModel=request.model===baseline.model;
   const expectedModel=sameModel?Object.fromEntries(['source','sampling','lora'].filter(k=>p[k]!=null).map(k=>[k,clone(p[k])])):null;
   return {...request,...(experiment?{experiment:clone(experiment)}:{}),...(sameModel&&baseline.model==='flux2'?{textLength:baseline.textLength}:{}),
    ...(expectedModel&&Object.keys(expectedModel).length?{expectedModel}:{}),
    iteration:{parent:{source:parent.source,name:parent.name},changes:imageRecipeChanges(baseline,request)}};
  },
 };
}

export function installImageRecipeStatus({document,iteration,busy=()=>false}){
 const host=document.createElement('div');host.className='asset-help';host.id='asset-recipe';
 const status=document.createElement('div');status.id='asset-recipe-status';status.setAttribute('role','status');
 const reset=document.createElement('button');reset.type='button';reset.id='asset-recipe-clear';reset.textContent='Start a separate experiment';
 reset.onclick=()=>iteration.clear();host.append(status,reset);
 document.getElementById('asset-step-image').querySelector('h3').after(host);
 const labels={prompt:'prompt',seed:'seed',size:'size',aspect:'shape',level:'weight precision',model:'model',reference:'reference image'};
 function render(){
  const state=iteration.read();host.hidden=!state.parent&&!state.experiment&&!state.error&&!state.opening;
  document.getElementById('asset-generate').dataset.recipeActive=String(!!(state.parent||state.experiment));
  status.textContent=state.error|| (state.opening?'Opening saved recipe…':state.parent?`Recipe from ${state.parent.name||'selected image'} · ${state.changes.length?'Changed: '+state.changes.map(c=>labels[c.field]).join(', '):'Recorded settings restored. Seed stays fixed until you change it.'}`:state.experiment?`New results will join ${state.experiment.title}.`:'');
  reset.hidden=!state.parent&&!state.experiment;reset.disabled=busy()||state.opening;
  reset.textContent=state.experiment?'Leave experiment':'Clear recipe';
 }
 for(const id of ['asset-prompt','asset-seed','asset-image-size','asset-image-aspect','asset-image-level','asset-image-model','asset-use-reference']){
  document.getElementById(id).addEventListener('input',render);document.getElementById(id).addEventListener('change',render);
 }
 render();return {render};
}
