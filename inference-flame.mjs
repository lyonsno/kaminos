import {blendSettings} from './flame-blend.mjs';
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
function mix(from,to,fields,amount){return fields.length?blendSettings({a:from,b:to,current:from,fields,amount}):clone(from);}
export function evaluateInferenceFlame(recording,time,score,baseline){
 if(!Number.isFinite(time)||time<0)throw Error('Replay position must be finite and nonnegative');
 const transition=score.transitionMs??400;
 if(!Number.isFinite(transition)||transition<0)throw Error('Transition must be nonnegative');
 let stage=null,progress=null,preview=null,start=0,from=clone(baseline),to=clone(baseline),moving=[],pulse=null;
 const baseAt=t=>mix(from,to,moving,transition===0?1:smooth((t-start)/transition));
 const flare=score.flare;
 const pulseAt=t=>{
  if(!pulse||!flare)return 0;
  const age=t-pulse.at;
  if(age<flare.attackMs)return pulse.from+(1-pulse.from)*smooth(age/flare.attackMs);
  return 1-smooth((age-flare.attackMs)/flare.settleMs);
 };
 if(flare&&(!Number.isFinite(flare.attackMs)||flare.attackMs<0||!Number.isFinite(flare.settleMs)||flare.settleMs<=0))throw Error('Flare attack must be nonnegative and settling time positive');
 for(const event of recording.events){
  if(event.atMs>time)break;
  if(event.type==='preview'){preview=event;if(flare)pulse={at:event.atMs,from:pulseAt(event.atMs)};}
  if(event.type==='stage'||event.type==='progress'||event.type==='complete'){
   const nextStage=event.type==='complete'?'complete':event.stage;
   if(nextStage!==stage)progress=null;
   stage=nextStage;
   if(event.type==='progress')progress=event.total===null?null:event.completed/event.total;
   const recipe=score.stages?.[stage];
   if(recipe){
    const current=baseAt(event.atMs);
    from=current;to=blendSettings({a:recipe.a.settings,b:recipe.b.settings,current,fields:recipe.fields,amount:progress??0});moving=recipe.fields;start=event.atMs;
   }
  }
 }
 let settings=baseAt(time);const flareWeight=pulseAt(time);
 if(flare&&flareWeight>0)settings=mix(settings,flare.settings,flare.fields,flareWeight);
 return {settings,stage,progress,preview,flareWeight};
}
export function createInferenceFlame({flame,source,onFrame,changed=()=>{}}){
 let recording=null,score={stages:{},transitionMs:400,flare:null},position=0,playing=false,live=false,transaction=null,baseline=null,disposed=false,error=null,startedAt=null,lastView=null;
 let unsubscribe=()=>{};
 const notify=()=>{if(!disposed)changed();};
 const now=()=>performance.now();
 function stop(cancel=false){unsubscribe();unsubscribe=()=>{};playing=false;live=false;startedAt=null;if(transaction){const tx=transaction;transaction=null;cancel?tx.cancel():tx.commit();}notify();}
 function begin(){
  if(disposed)throw Error('Inference flame is closed');
  if(!flame.read().active)throw Error('Add or enable a flame first');
  if(!transaction){
   const current=flame.settings();
   const fields=[...new Set([...Object.values(score.stages).flatMap(recipe=>recipe.fields),...(score.flare?.fields??[])])];
   baseline=baseline?blendSettings({a:baseline,b:baseline,current,fields,amount:0}):current;
   transaction=flame.beginPreview('Inference flame response');
  }
 }
 function apply(){
  if(!recording||!transaction)return;
  if(!transaction.active()){stop();throw Error('Flame edit was interrupted; replay paused');}
  try{lastView=evaluateInferenceFlame(recording,position,score,baseline);transaction.update(lastView.settings);error=null;}
  catch(e){error=e.message;stop(true);throw e;}
 }
 const playbackEnd=()=>{
  if(!recording)return 0;
  let end=recording.durationMs;
  for(const e of recording.events){
   if(e.type==='preview'&&score.flare)end=Math.max(end,e.atMs+score.flare.attackMs+score.flare.settleMs);
   if(['stage','progress','complete'].includes(e.type)&&score.stages[e.type==='complete'?'complete':e.stage])end=Math.max(end,e.atMs+score.transitionMs);
  }
  return end;
 };
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
    recording=source.read(runId);baseline=null;position=0;startedAt=now();begin();
   }
   if(recording?.runId!==runId)return;
   if(event.type!=='start'){recording.events.push(clone(event));recording.durationMs=event.atMs;if(['complete','failed','stopped'].includes(event.type))recording.status=event.type;}position=Math.max(position,event.atMs);
   apply();notify();
   if(['complete','failed','stopped'].includes(event.type)){unsubscribe();unsubscribe=()=>{};live=false;startedAt=null;playing=event.type==='complete'&&position<playbackEnd();if(!playing)stop();notify();}
  }catch(e){error=e.message;stop(true);}
 };
 const read=()=>({recording:recording?{runId:recording.runId,source:clone(recording.source),status:recording.status,terminal:clone(recording.events.findLast(e=>['complete','failed','stopped'].includes(e.type))??null),durationMs:recording.durationMs}:null,score:clone(score),position,playbackDurationMs:playbackEnd(),playing,live,previewing:!!transaction,error,stage:lastView?.stage??null,progress:lastView?.progress??null,preview:lastView?.preview??null,flareWeight:lastView?.flareWeight??0});
 return {read,operations:{
  load(value){stop();recording=validateRecording(value);baseline=null;position=0;lastView=null;notify();return read();},
  latest(){const value=source.read();if(!value)throw Error('No observed ImageGen run yet');return this.load(value);},
  assign({stage,recipe}){if(!INFERENCE_STAGES.includes(stage))throw Error('Unknown inference stage');stop();blendSettings({a:recipe.a.settings,b:recipe.b.settings,current:flame.settings(),fields:recipe.fields,amount:0});baseline=null;score.stages[stage]=clone(recipe);notify();return read();},
  clearStage(stage){stop();baseline=null;delete score.stages[stage];notify();return read();},
  captureFlare({fields,attackMs=120,settleMs=900}){stop();const settings=flame.settings();blendSettings({a:settings,b:settings,current:settings,fields,amount:0});if(!Number.isFinite(attackMs)||attackMs<0||!Number.isFinite(settleMs)||settleMs<=0)throw Error('Choose nonnegative attack and positive settling times');baseline=null;score.flare={settings,fields:[...fields],attackMs,settleMs};notify();return read();},
  clearFlare(){stop();baseline=null;score.flare=null;notify();return read();},
  play(){if(!recording)throw Error('Load a recording first');stop();if(position>=playbackEnd())position=0;begin();playing=true;apply();notify();return read();},
  seek(value){if(!recording)throw Error('Load a recording first');if(!Number.isFinite(value)||value<0||value>playbackEnd())throw Error('Choose a position inside the recording');if(live)stop();begin();playing=false;position=value;apply();notify();return read();},
  pause(){stop();return read();},cancel(){stop(true);return read();},
  follow(){stop();live=true;recording=null;baseline=null;position=0;lastView=null;unsubscribe=source.subscribe(receive,{previews:true});notify();return read();},
  export(){return {schema:'kaminos.inference-flame.v1',recording:recording&&clone(recording),score:clone(score)};},
  restore(value){
   if(value?.schema!=='kaminos.inference-flame.v1'||!value.score?.stages)throw Error('Choose an inference flame arrangement');
   const next=value.recording?validateRecording(value.recording):null;
   for(const recipe of Object.values(value.score.stages))blendSettings({a:recipe.a?.settings,b:recipe.b?.settings,current:flame.settings(),fields:recipe.fields,amount:0});
   if(value.score.flare){const f=value.score.flare;blendSettings({a:f.settings,b:f.settings,current:flame.settings(),fields:f.fields,amount:0});}
   evaluateInferenceFlame({events:[]},0,value.score,flame.settings());stop();baseline=null;score=clone(value.score);recording=next;position=0;lastView=null;notify();return read();
  },
 },dispose(){stop(true);disposed=true;unframe();unsubscribe();}};
}
