import {blendSettings,descriptor} from './flame-blend.mjs';
import {compileScore,migrateScore,validateScore,validateRecipe} from './inference-flame-score.mjs';
const clone=structuredClone;
const smooth=x=>{x=Math.min(1,Math.max(0,x));return x*x*(3-2*x);};
export const INFERENCE_STAGES=['weights','text','denoise','decode','saving','complete'];
export function validateRecording(value){
 if(value?.schema!=='kaminos.inference-recording.v1'||!value.source||typeof value.runId!=='string'||!Array.isArray(value.events)||!value.events.length)throw Error('Choose a complete inference recording');
 let last=-1;
 for(const e of value.events){
  if(!Number.isFinite(e.atMs)||e.atMs<0||e.atMs<last||typeof e.type!=='string')throw Error('Recording events must have ordered, finite times');last=e.atMs;
  if(e.type==='progress'&&(!Number.isFinite(e.completed)||(e.total!==null&&(!Number.isFinite(e.total)||e.total<=0||e.completed>e.total))||e.completed<0))throw Error('Invalid observed progress');
  if(e.type==='preview'&&(!Number.isInteger(e.width)||!Number.isInteger(e.height)||e.width<=0||e.height<=0||!Array.isArray(e.rgba)||e.rgba.length!==e.width*e.height*4||e.rgba.some(v=>!Number.isInteger(v)||v<0||v>255)))throw Error('Incomplete preview pixels');
 }
 if(!Number.isFinite(value.durationMs)||value.durationMs<last)throw Error('Recording duration must include every event');
 return clone(value);
}
export function evaluateInferenceFlame(recording,time,score,baseline){
 if(!Number.isFinite(time)||time<0)throw Error('Replay position must be finite and nonnegative');
 return compileScore(recording,score,baseline).evaluate(time);
}
export function createInferenceFlame({flame,source,onFrame,changed=()=>{}}){
 let recording=null,score={stages:{},transitionMs:400,flare:null},position=0,playing=false,live=false,transaction=null,baseline=null,disposed=false,error=null,startedAt=null,lastView=null;
 let unsubscribe=()=>{},plan=null,scoreRevision=0,lastApplied=null;
 const invalidate=()=>{plan=null;};
 const getPlan=()=>plan??(plan=compileScore(recording,score,baseline??flame.settings()));
 const signature=settings=>JSON.stringify(getPlan().fields.map(id=>descriptor(settings,id)?.value));
 const editScore=change=>{const next=clone(score);change(next);validateScore(next,flame.settings());stop();score=next;scoreRevision++;baseline=null;lastApplied=null;invalidate();notify();return read();};
 const newId=()=>crypto.randomUUID();
 const notify=()=>{if(!disposed)changed();};
 const now=()=>performance.now();
 function stop(cancel=false){unsubscribe();unsubscribe=()=>{};playing=false;live=false;startedAt=null;if(transaction){const tx=transaction;transaction=null;cancel?tx.cancel():tx.commit();}notify();}
 function begin(){
  if(disposed)throw Error('Inference flame is closed');
  if(!flame.read().active)throw Error('Add or enable a flame first');
  if(!transaction){
   const current=flame.settings();
   const fields=[...new Set([...Object.values(score.stages).flatMap(recipe=>recipe.fields),...(score.objects??[]).flatMap(o=>o.recipe.fields),...(score.flare?.fields??[])])];
   baseline=baseline&&fields.length?blendSettings({a:baseline,b:baseline,current,fields,amount:0}):current;
   invalidate();lastApplied=null;transaction=flame.beginPreview('Inference flame response');
  }
 }
 function apply(){
  if(!recording||!transaction)return;
  if(!transaction.active()){stop();throw Error('Flame edit was interrupted; replay paused');}
  try{lastView=getPlan().evaluate(position);const next=signature(lastView.settings);if(next!==lastApplied){transaction.update(lastView.settings);lastApplied=next;}error=null;}
  catch(e){error=e.message;stop(true);throw e;}
 }
 const playbackEnd=()=>recording?getPlan().end:0;
 const unframe=onFrame(({deltaSeconds})=>{
  if((!playing&&!live)||(live&&startedAt===null))return;
  try{
   position=live?Math.max(position,now()-startedAt):Math.min(playbackEnd(),position+deltaSeconds*1000);
   apply();
   if(playing&&position>=playbackEnd())stop();
   notify();
  }catch(e){error=e.message;notify();}
 });
 const receive=({runId,event})=>{
  if(!live)return;
  try{
   if(event.type==='start'){
    if(transaction){transaction.commit();transaction=null;}
    recording=source.read(runId);invalidate();baseline=null;position=0;startedAt=now();begin();
   }
   if(recording?.runId!==runId)return;
   if(event.type!=='start'){recording.events.push(clone(event));recording.durationMs=event.atMs;if(['complete','failed','stopped'].includes(event.type))recording.status=event.type;}invalidate();position=Math.max(position,event.atMs);
   apply();notify();
   if(['complete','failed','stopped'].includes(event.type)){unsubscribe();unsubscribe=()=>{};live=false;startedAt=null;playing=event.type==='complete'&&position<playbackEnd();if(!playing)stop();notify();}
  }catch(e){error=e.message;stop(true);}
 };
 const read=({includeScore=true}={})=>({scoreRevision,recording:recording?{runId:recording.runId,source:clone(recording.source),status:recording.status,terminal:clone(recording.events.findLast(e=>['complete','failed','stopped'].includes(e.type))??null),durationMs:recording.durationMs}:null,...(includeScore?{score:clone(score)}:{}),position,playbackDurationMs:playbackEnd(),playing,live,previewing:!!transaction,error,stage:lastView?.stage??null,progress:lastView?.progress??null,preview:lastView?.preview??null,flareWeight:lastView?.flareWeight??0});
 return {read,operations:{
  load(value){stop();recording=validateRecording(value);invalidate();baseline=null;position=0;lastView=null;notify();return read();},
  latest(){const value=source.read();if(!value)throw Error('No observed ImageGen run yet');return this.load(value);},
  assign({stage,recipe}){if(!INFERENCE_STAGES.includes(stage))throw Error('Unknown inference stage');return editScore(s=>{validateRecipe(recipe,flame.settings());s.stages[stage]=clone(recipe);delete s.stacks?.[stage];});},
  clearStage(stage){return editScore(s=>{delete s.stages[stage];delete s.stacks?.[stage];});},
  saveObject({id=newId(),label,kind='ramp',recipe}){return editScore(s=>{s.objects??=[];if(s.objects.some(o=>o.id===id))throw Error('Object already exists');s.objects.push({id,label:label?.trim()||`${kind} ${id.slice(0,6)}`,kind,recipe:clone(recipe)});});},
  updateObject({id,...patch}){return editScore(s=>{const o=s.objects?.find(o=>o.id===id);if(!o)throw Error('Unknown saved object');for(const key of ['label','kind','recipe'])if(Object.hasOwn(patch,key))o[key]=clone(patch[key]);});},
  renameObject({id,label}){return this.updateObject({id,label});},
  deleteObject(id){return editScore(s=>{if(Object.values(s.stacks??{}).some(layers=>layers.some(l=>l.objectId===id)))throw Error('Object is used by a phase layer');if(!s.objects?.some(o=>o.id===id))throw Error('Unknown saved object');s.objects=s.objects.filter(o=>o.id!==id);});},
  addLayer({stage,objectId,timing='phase',scale=1}){if(!INFERENCE_STAGES.includes(stage))throw Error('Unknown inference stage');return editScore(s=>{s.stacks??={};(s.stacks[stage]??=[]).push({id:newId(),objectId,timing,scale,enabled:true});});},
  updateLayer({stage,id,...patch}){return editScore(s=>{const l=s.stacks?.[stage]?.find(l=>l.id===id);if(!l)throw Error('Unknown phase layer');for(const key of ['timing','scale','enabled'])if(Object.hasOwn(patch,key))l[key]=patch[key];});},
  moveLayer({stage,id,direction}){return editScore(s=>{const layers=s.stacks?.[stage],i=layers?.findIndex(l=>l.id===id);if(!(i>=0)||![-1,1].includes(direction))throw Error('Unknown layer or move');const j=i+direction;if(j>=0&&j<layers.length)[layers[i],layers[j]]=[layers[j],layers[i]];});},
  removeLayer({stage,id}){return editScore(s=>{if(!s.stacks?.[stage]?.some(l=>l.id===id))throw Error('Unknown phase layer');s.stacks[stage]=s.stacks[stage].filter(l=>l.id!==id);});},
  timeScale(value){return editScore(s=>{s.timeScale=value;});},
  captureFlare({fields,attackMs=120,settleMs=900}){return editScore(s=>{s.flare={settings:flame.settings(),fields:[...fields],attackMs,settleMs};});},
  clearFlare(){return editScore(s=>{s.flare=null;});},
  play(){if(!recording)throw Error('Load a recording first');stop();if(position>=playbackEnd())position=0;begin();playing=true;apply();notify();return read();},
  seek(value){if(!recording)throw Error('Load a recording first');if(!Number.isFinite(value)||value<0||value>playbackEnd())throw Error('Choose a position inside the recording');if(live)stop();begin();playing=false;position=value;apply();notify();return read();},
  pause(){stop();return read();},cancel(){stop(true);return read();},
  follow(){stop();live=true;recording=null;invalidate();baseline=null;position=0;lastView=null;unsubscribe=source.subscribe(receive,{previews:true});notify();return read();},
  export(){return {schema:'kaminos.inference-flame.v2',recording:recording&&clone(recording),score:clone(score)};},
  restore(value){
   if(!['kaminos.inference-flame.v1','kaminos.inference-flame.v2'].includes(value?.schema)||!value.score?.stages)throw Error('Choose an inference flame arrangement');
   const next=value.recording?validateRecording(value.recording):null;
   const nextScore=value.score.objects?clone(value.score):migrateScore(value.score);
   validateScore(nextScore,flame.settings());stop();baseline=null;score=nextScore;scoreRevision++;invalidate();recording=next;position=0;lastView=null;notify();return read();
  },
 },dispose(){stop(true);disposed=true;unframe();unsubscribe();}};
}
