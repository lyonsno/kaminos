import {blendSettings,descriptor} from './flame-blend.mjs';
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const positive=(n,label)=>{if(!Number.isFinite(n)||n<=0)throw Error(label+' must be positive');return n;};
export function validateRecipe(recipe,baseline){
 positive(recipe?.duration,'Duration');
 blendSettings({a:recipe.a?.settings,b:recipe.b?.settings,current:baseline,fields:recipe.fields,amount:0});
}
export function validateScore(score,baseline){
 if(!score?.stages||typeof score.stages!=='object')throw Error('Choose an inference flame arrangement');
 if(!Number.isFinite(score.transitionMs??400)||(score.transitionMs??400)<0)throw Error('Transition must be nonnegative');
 positive(score.timeScale??1,'Time scale');
 for(const recipe of Object.values(score.stages))validateRecipe(recipe,baseline);
 const objects=score.objects??[];if(!Array.isArray(objects))throw Error('Saved objects must be a list');
 const ids=new Set();for(const o of objects){if(typeof o.id!=='string'||!o.id||ids.has(o.id)||typeof o.label!=='string'||!['state','ramp','pulse'].includes(o.kind))throw Error('Invalid saved flame object');ids.add(o.id);validateRecipe(o.recipe,baseline);}
 const layerIds=new Set();for(const [stage,layers] of Object.entries(score.stacks??{})){
  if(!['weights','text','denoise','decode','saving','complete'].includes(stage)||!Array.isArray(layers))throw Error('Invalid phase stack');
  for(const l of layers){if(typeof l.id!=='string'||layerIds.has(l.id)||!ids.has(l.objectId)||!['phase','seconds','progress'].includes(l.timing)||typeof l.enabled!=='boolean')throw Error('Invalid or missing layer object');layerIds.add(l.id);positive(l.scale,'Layer scale');}
 }
 if(score.flare){const f=score.flare;blendSettings({a:f.settings,b:f.settings,current:baseline,fields:f.fields,amount:0});if(!Number.isFinite(f.attackMs)||f.attackMs<0)throw Error('Flare attack must be nonnegative');positive(f.settleMs,'Flare settling time');}
}
export function migrateScore(value){
 const score=structuredClone(value);score.objects??=[];score.stacks??={};score.timeScale??=1;
 for(const [stage,recipe] of Object.entries(score.stages)){
  let id='import-'+stage;while(score.objects.some(o=>o.id===id))id+='-copy';
  score.objects.push({id,label:stage[0].toUpperCase()+stage.slice(1)+' · '+recipe.a.label+' → '+recipe.b.label,kind:'ramp',recipe});
  (score.stacks[stage]??=[]).unshift({id:id+'-layer',objectId:id,timing:stage==='complete'?'seconds':'phase',scale:1,enabled:true});
 }
 score.stages={};return score;
}
// Numeric plans are compiled at edits/event arrival, not by rereading and cloning
// every endpoint and every past event for each presented frame.
export function compileScore(recording,score,baseline){
 validateScore(score,baseline);
 const allFields=new Set([...Object.values(score.stages).flatMap(r=>r.fields),...(score.objects??[]).flatMap(o=>o.recipe.fields),...(score.flare?.fields??[])]);
 const values=s=>Object.fromEntries([...allFields].map(id=>[id,descriptor(s,id)?.value]));
 const initial=values(baseline),scale=score.timeScale??1,transition=score.transitionMs??400;
 const interpolate=(a,b,id,t)=>{if(t===0)return a;if(t===1)return b;return id==='volume-wind-angle'?((a+(((b-a+540)%360)-180)*t+540)%360)-180:a+(b-a)*t;};
 const mix=(out,a,b,fields,t)=>{for(const id of fields)out[id]=interpolate(a[id],b[id],id,t);};
 const objects=new Map((score.objects??[]).map(o=>[o.id,{...o,a:values(o.recipe.a.settings),b:values(o.recipe.b.settings)}]));
 const spans=[];let lastPreview=null,pulse=null;const previews=[];
 const flare=score.flare,flareValues=flare?values(flare.settings):null;
 const pulseAt=(p,t)=>{if(!p||!flare)return 0;const age=t-p.at;if(age<flare.attackMs)return p.from+(1-p.from)*smooth(age/flare.attackMs);return 1-smooth((age-flare.attackMs)/flare.settleMs);};
 let end=recording.durationMs;
 for(const event of recording.events){
  if(event.type==='preview'){lastPreview=event;if(flare){pulse={at:event.atMs,from:pulseAt(pulse,event.atMs)};end=Math.max(end,event.atMs+flare.attackMs+flare.settleMs);}previews.push({event,pulse});}
  if(!['stage','progress','complete'].includes(event.type))continue;
  const stage=event.type==='complete'?'complete':event.stage;
  let span=spans.at(-1);
  if(!span||span.stage!==stage){if(span)span.end=event.atMs;span={stage,start:event.atMs,end:Infinity,events:[],progress:null};spans.push(span);}
  span.events.push(event);
 }
 function layersFor(span){return (score.stacks?.[span.stage]??[]).filter(l=>l.enabled).map(l=>({...l,object:objects.get(l.objectId)}));}
 const duration=(span,l)=>{const authored=l.object.recipe.duration*1000;return (l.timing==='phase'&&Number.isFinite(span.end)?span.end-span.start:authored)*l.scale*scale;};
 const progressAt=(span,t)=>{let p=null;for(const e of span.events){if(e.atMs>t)break;if(e.type==='progress')p=e.total===null?null:e.completed/e.total;}return p;};
 function at(span,t){
  const out=span.carry?at(span.carry,t):{...span.before};
  // Keep the original direct stage assignment API's observed-progress easing.
  const recipe=score.stages[span.stage];
  if(recipe){
   const a=values(recipe.a.settings),b=values(recipe.b.settings);
   if(span.stage==='complete'){mix(out,a,b,recipe.fields,smooth((t-span.start)/(recipe.duration*1000*scale)));}
   else {let from={...out},to={...out},start=span.start;for(const e of span.events){if(e.atMs>t)break;mix(from,from,to,recipe.fields,transition===0?1:smooth((e.atMs-start)/transition));const p=e.type==='progress'&&e.total!==null?e.completed/e.total:0;mix(to,a,b,recipe.fields,p);start=e.atMs;}mix(out,from,to,recipe.fields,transition===0?1:smooth((t-start)/transition));}
  }
  for(const layer of span.layers){
   const o=layer.object,p=progressAt(span,t),d=duration(span,layer);
   const fraction=layer.timing==='progress'&&p!==null&&span.stage!=='complete'?clamp(p/(layer.scale*scale)):d===0?1:clamp((t-span.start)/d);
   if(o.kind==='state')mix(out,o.b,o.b,o.recipe.fields,1);
   else if(o.kind==='pulse'){const weight=smooth(fraction<=.5?fraction*2:(1-fraction)*2);mix(out,out,o.b,o.recipe.fields,weight);}
   else mix(out,o.a,o.b,o.recipe.fields,smooth(fraction));
  }
  return out;
 }
 let before=initial,carry=null;
 for(const span of spans){span.before={...before};span.layers=layersFor(span);
  const direct=score.stages[span.stage];span.carry=!direct&&!span.layers.length?carry:null;carry=direct?span:span.layers.length?null:carry;
  if(direct)end=Math.max(end,span.stage==='complete'?span.start+direct.duration*1000*scale:span.events.at(-1).atMs+transition);if(Number.isFinite(span.end))before=at(span,span.end);
  else {for(const l of span.layers)if(l.object.kind!=='state')end=Math.max(end,span.start+duration(span,l));const r=score.stages[span.stage];if(r)end=Math.max(end,span.stage==='complete'?span.start+r.duration*1000*scale:span.events.at(-1).atMs+transition);}
 }
 return {end,fields:[...allFields],evaluate(time){
  let span=null;for(const candidate of spans){if(candidate.start>time)break;span=candidate;}
  const out=span?at(span,time):{...initial};let preview=null,p=null;for(const item of previews){if(item.event.atMs>time)break;preview=item.event;p=item.pulse;}
  const flareWeight=pulseAt(p,time);if(flareWeight>0)mix(out,out,flareValues,flare.fields,flareWeight);
  const settings=structuredClone(baseline);for(const [id,value] of Object.entries(out)){const d=descriptor(settings,id);d.value=value;d.rawValue=String(value);}
  return {settings,stage:span?.stage??null,progress:span?progressAt(span,time):null,preview,flareWeight};
 }};
}
