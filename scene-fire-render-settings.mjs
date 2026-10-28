// Display and transported-light settings belong to the ordinary scene document.
export const FIRE_RENDER_DEFAULTS=Object.freeze({'rendering-match-flame-camera':false,'rendering-surface-gain':0,'rendering-surface-scattering':true,'rendering-source-softness':0,'rendering-smoke-solver':'distributed','rendering-angular-samples':24,'rendering-angular-pattern':'fixed'});
export function checkedFireRendering(value={}){
 const next={...FIRE_RENDER_DEFAULTS,...value};
 for(const id of ['rendering-match-flame-camera','rendering-surface-scattering'])if(typeof next[id]!=='boolean')throw Error('Invalid flame rendering '+id);
 for(const id of ['rendering-surface-gain','rendering-source-softness','rendering-angular-samples'])if(!Number.isFinite(next[id]))throw Error('Invalid flame rendering '+id);
 if(next['rendering-source-softness']<0||!Number.isInteger(next['rendering-angular-samples'])||next['rendering-angular-samples']<=0)throw Error('Invalid flame light sampling');
 if(!['distributed','legacy'].includes(next['rendering-smoke-solver'])||!['fixed','spatial','source','guided'].includes(next['rendering-angular-pattern']))throw Error('Invalid flame rendering mode');
 return next;
}
export function readFireRendering(document){return checkedFireRendering(Object.fromEntries(Object.keys(FIRE_RENDER_DEFAULTS).map(id=>{const el=document.getElementById(id);return [id,typeof FIRE_RENDER_DEFAULTS[id]==='boolean'?el.checked:typeof FIRE_RENDER_DEFAULTS[id]==='number'?Number(el.value):el.value];})));}
export function restoreFireRendering(document,settings){
 const value=checkedFireRendering(settings);for(const [id,next]of Object.entries(value)){const el=document.getElementById(id);if(!el)continue;if(el.type==='checkbox')el.checked=next;else{if(el.type==='range'){el.min=String(Math.min(Number(el.min),next));el.max=String(Math.max(Number(el.max),next));el.step='any';}el.value=String(next);}el.dispatchEvent(new Event(el.type==='checkbox'||el.type==='select-one'?'change':'input',{bubbles:true}));}
 return value;
}
