import {assetSource,assetWithheld} from './authoring-assets.mjs';
const sourceOf=e=>e?.source||(e?.root&&e?.path?assetSource(e.root,e.path):null);
const copy=x=>structuredClone(x);
export const IMAGE_HISTORY_KEY='kaminos.generate-image-history.v1';

// Image bytes stay in the asset store. This browser-local journal retains the
// iteration, its instructions and independent viewing/conditioning choices.
export function createImageIterationHistory({storage,key=IMAGE_HISTORY_KEY,changed=()=>{}}={}){
 let state={entries:[],viewedSource:null,referenceSource:null,compareSource:null,error:null},blocked=!storage;if(!storage)state.error='Browser storage is unavailable; image history stays in this tab.';
 try{
  const raw=storage?.getItem(key);
  if(raw){const saved=JSON.parse(raw);if(saved.schema!=='kaminos.image-iteration-history.v1'||!Array.isArray(saved.entries)||saved.entries.some(e=>e.kind!=='image'||!sourceOf(e)))throw Error('Saved image history has an unsupported format');state={...state,...saved};}
 }catch(error){state.error=`Saved history could not be read: ${error.message}. New changes stay in this tab.`;blocked=true;}
 const find=source=>state.entries.find(e=>sourceOf(e)===source)||null;
 const persist=()=>{if(!blocked)try{storage?.setItem(key,JSON.stringify({...state,schema:'kaminos.image-iteration-history.v1',error:null}));state.error=null;}catch(error){state.error=`Image history could not be saved: ${error.message}`;}changed();};
 const requireEntry=source=>{const entry=find(source);if(!entry||assetWithheld(entry))throw Error('Choose an available history image');return entry;};
 const upsert=entry=>{
  if(entry?.kind!=='image'||!sourceOf(entry)||assetWithheld(entry))throw Error('Choose an available image; withheld images cannot enter history');
  const source=sourceOf(entry),prior=find(source),next={...prior,...copy(entry),source,createdAt:prior?.createdAt??Date.now()};
  if(prior)state.entries[state.entries.indexOf(prior)]=next;else state.entries.push(next);return next;
 };
 const result={
  read(){return copy({...state,viewed:find(state.viewedSource)});},
  reference(){const e=find(state.referenceSource);return e&&!assetWithheld(e)?copy(e):null;},
  comparison(){
   const viewed=find(state.viewedSource),source=state.compareSource||viewed?.provenance?.reference?.source;
   if(!source)return null;const known=find(source);if(known)return assetWithheld(known)?null:copy(known);
   return {kind:'image',source,name:'Input from saved image metadata',unverified:true};
  },
  observe(entry){
   if(entry?.kind!=='image')return null;
   if(assetWithheld(entry)){const prior=find(sourceOf(entry));if(prior){Object.assign(prior,{visibility:copy(entry.visibility)});if(state.viewedSource===sourceOf(entry))state.viewedSource=null;if(state.referenceSource===sourceOf(entry))state.referenceSource=null;persist();}return null;}
   if(state.viewedSource===sourceOf(entry)&&find(state.viewedSource))return copy(find(state.viewedSource));
   const next=upsert(entry);state.viewedSource=next.source;state.compareSource=null;
   if(!state.referenceSource)state.referenceSource=next.source;persist();return copy(next);
  },
  record(entry){const next=upsert(entry);state.viewedSource=next.source;state.compareSource=null;persist();return copy(next);},
  annotate(source,patch){const prior=find(source);if(!prior)return;upsert({...prior,...copy(patch)});persist();},
  view(source){const e=requireEntry(source);if(state.viewedSource!==source){state.viewedSource=source;state.compareSource=null;persist();}return copy(e);},
  useReference(source=state.viewedSource){const e=requireEntry(source);state.referenceSource=source;persist();return copy(e);},
  compare(source){requireEntry(source);state.compareSource=source;persist();},
 };
 return result;
}

export function installImageIterationHistory({document,history,assets,layout,onEdit=()=>{},onRecall=()=>{},busy=()=>false}){
 const pane=document.getElementById('asset-generate'),host=document.createElement('section');host.id='asset-image-history';
 host.innerHTML=`<div class="asset-history-heading"><strong>Image history</strong><span id="asset-history-count"></span></div><div id="asset-history-strip" role="group" aria-label="Image history"></div><div class="asset-history-actions"><button type="button" id="asset-history-reference">Use as reference</button><button type="button" id="asset-history-edit">Edit this image</button><button type="button" id="asset-history-compare">Compare with input</button><button type="button" id="asset-history-recall">Reuse instructions</button></div><div id="asset-history-reference-label"></div><div id="asset-history-status" role="status"></div><details id="asset-history-instructions"><summary>Instructions for this image</summary><dl id="asset-history-provenance"></dl></details>`;
 pane.append(host);const by=id=>document.getElementById(id);let painted=null,detailKey=null;
 const show=source=>{const e=history.view(source);assets.select(e);render();};
 by('asset-history-reference').onclick=()=>{history.useReference();const checkbox=by('asset-use-reference');checkbox.checked=true;checkbox.dispatchEvent(new document.defaultView.Event('change'));render();};
 by('asset-history-edit').onclick=()=>{if(busy())return;const entry=history.useReference();onEdit(entry);layout.compare(true);render();};
 by('asset-history-recall').onclick=()=>{if(busy())return;const e=history.read().viewed;if(e)onRecall(e);render();};
 by('asset-history-compare').onclick=()=>{layout.compare(!layout.comparing());render();};
 function render(){
  const state=history.read(),reference=history.reference(),viewed=state.viewed,key=JSON.stringify(state.entries.map(e=>[e.source,e.name,e.provenance?.seed,!!e.provenance?.reference,e.visibility?.status]));
  by('asset-history-count').textContent=String(state.entries.length);
  if(key!==painted){painted=key;by('asset-history-strip').replaceChildren(...state.entries.map((e,i)=>{
   const button=document.createElement('button');button.type='button';button.dataset.historySource=e.source;button.title=`${i+1} · ${e.name||'Image'}`;
   const img=document.createElement('img');if(!assetWithheld(e))img.src=e.source;img.alt=assetWithheld(e)?'Withheld image':'';img.loading='lazy';button.disabled=assetWithheld(e);const label=document.createElement('span');label.textContent=`${i+1}${e.provenance?.reference?' · edit':''}`;button.append(img,label);button.onclick=()=>show(e.source);return button;
  }));}
  for(const button of by('asset-history-strip').children)button.setAttribute('aria-pressed',String(button.dataset.historySource===state.viewedSource));
  by('asset-history-reference-label').textContent=reference?`Next edit reference: ${reference.name||'Image'} · history ${state.entries.findIndex(e=>e.source===reference.source)+1}`:'Choose an image to use as a reference.';
  by('asset-history-status').textContent=state.error||'';
  for(const id of ['asset-history-reference','asset-history-edit'])by(id).disabled=busy()||!viewed;
  by('asset-history-recall').disabled=busy()||!viewed?.provenance?.prompt;
  by('asset-history-compare').disabled=!viewed;by('asset-history-compare').setAttribute('aria-pressed',String(layout.comparing()));
  const p=viewed?.provenance,details=by('asset-history-instructions');details.hidden=!p;
  const nextDetail=JSON.stringify(p);if(nextDetail!==detailKey){detailKey=nextDetail;const values=p?[
   ['Your request',p.promptExpansion?.request?.prompt||p.prompt],['Expanded prompt',p.promptExpansion?.expandedPrompt],['Submitted prompt',p.prompt],['Model / seed / size',[p.model,p.seed,`${p.width} × ${p.height}`].join(' · ')],['Input image',p.reference?.name||p.reference?.source],
  ]:[];by('asset-history-provenance').replaceChildren(...values.filter(([,v])=>v!==undefined&&v!==null).flatMap(([label,value])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);return[dt,dd];}));}
 }
 render();return{render,show};
}
