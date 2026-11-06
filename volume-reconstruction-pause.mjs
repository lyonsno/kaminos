// One list owns which edits can re-filter a held integral without new samples.
export const RECONSTRUCTION_FILTER_CONTROLS=Object.freeze({
 reconstructionSpatial:'volume-reconstruction-spatial',reconstructionRadius:'volume-reconstruction-radius',
 reconstructionWindow:'volume-reconstruction-window',reconstructionResponse:'volume-reconstruction-response',
 reconstructionEdge:'volume-reconstruction-edge',reconstructionEdges:'volume-reconstruction-edges',
});
export function reconstructionSourceChanges(before,after){
 return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>!Object.hasOwn(RECONSTRUCTION_FILTER_CONTROLS,k)&&JSON.stringify(before[k])!==JSON.stringify(after[k]));
}
export function createReconstructionControlLock(document){
 const saved=new Map(),allowed=new Set([...Object.values(RECONSTRUCTION_FILTER_CONTROLS),'volume-reconstruction-pause']);
 const selector='input[id^="volume-"],select[id^="volume-"],button[id^="volume-"],[data-authoring-alias],#emitter-assay-family,#shared-flame-domain-properties input,#shared-flame-domain-properties select,[data-volume-presentation-mode],[data-raymarch-smoke-presentation],#grid-tuning-open,#flame-basin-apply';
 const reason='Resume history comparison to change sampling, simulation or presentation.';
 return {
  sync(held){
   if(!held){for(const [e,prior] of saved){e.disabled=prior.disabled;e.title=prior.title;delete e.dataset.reconstructionLocked;e.closest?.('.slider-row')?.classList.remove('reconstruction-locked');}saved.clear();return;}
   for(const e of document.querySelectorAll(selector)){
    if(typeof e.disabled!=='boolean'||allowed.has(e.dataset.authoringAlias||e.id))continue;
    if(!saved.has(e))saved.set(e,{disabled:e.disabled,title:e.title});
    e.disabled=true;e.title=reason;e.dataset.reconstructionLocked='true';e.closest?.('.slider-row')?.classList.add('reconstruction-locked');
   }
  },
 };
}
