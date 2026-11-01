import {sessionMotions,checkMotion,skeletonMotionKey} from './motion-collection.mjs';
import {createGivenPaletteMotion} from './given-palette-motion.mjs';

// The native poser owns the clock; source palette conversion and presentation
// are shared with walking. Pausing leaves the actual displayed Bones editable.
export async function createPosedMotion({THREE,data,model,session,changed,canAdvance=()=>true}){
 const reference=data.motionReference??data.motion,key=skeletonMotionKey(reference);
 let assigned=null,displayed=null,adapter=null,frame=0,rate=1,playing=false,elapsed=0,stopFrames=null,disposed=false;
 let startingPose=model.snapshot();
 function prepare(row){
  if(!row||checkMotion(row.motion)!==key)throw Error('Motion belongs to another skeleton');
  const palette=createGivenPaletteMotion({THREE,motion:row.motion,rigFrame:data.frame});
  // Validate every source frame before selecting it, including quaternion norms.
  for(let i=0;i<palette.frames;i++)palette.frame(i);
  return {row,palette};
 }
 function active(){if(disposed)throw Error('Creature motion is disposed');}
 function admit(){active();if(!canAdvance())throw Error('Finish or cancel the native joint edit before changing motion');}
 function pause(){playing=false;stopFrames?.();stopFrames=null;return read();}
 function apply(index){
  active();if(!adapter)throw Error('Choose a generated motion first');
  const p=adapter.frame(index);model.setBase({actor:p.actorMatrix,bones:p.bones.map(b=>({name:b.name,matrix:b.localMatrix}))},'Animation frame '+(index+1));frame=index;changed();return read();
 }
 function select(row,assign){admit();const next=prepare(row);if(!displayed)startingPose=model.snapshot();pause();adapter=next.palette;displayed=next.row;if(assign)assigned=next.row;frame=0;elapsed=0;apply(0);return read();}
 function seek({frame:index,seconds}={}){admit();if(!adapter)throw Error('Choose a generated motion first');if(index===undefined){if(!Number.isFinite(seconds)||seconds<0)throw Error('Seek time must be finite and nonnegative');index=Math.round(seconds*adapter.fps);}if(!Number.isInteger(index)||index<0||index>=adapter.frames)throw Error('Motion frame is outside retained motion');pause();elapsed=index/adapter.fps;return apply(index);}
 function play(){admit();if(!adapter)throw Error('Choose a generated motion first');if(playing)return read();if(frame===adapter.frames-1)seek({frame:0});elapsed=frame/adapter.fps;playing=true;stopFrames=session.onFrame(({deltaSeconds})=>{
  if(!canAdvance()){pause();changed();return;}
  elapsed+=deltaSeconds*rate;const next=Math.min(adapter.frames-1,Math.floor(elapsed*adapter.fps+1e-6));if(next!==frame)apply(next);if(next===adapter.frames-1){pause();changed();}
 });changed();return read();}
 function read(){return {playing,frame:adapter?frame:null,time:adapter?frame/adapter.fps:0,duration:adapter?(adapter.frames-1)/adapter.fps:0,stepSeconds:adapter?1/adapter.fps:0,rate,canSeek:!!adapter,canStep:!!adapter,busy:!adapter,assigned:assigned?.id??null,displayed:displayed?.id??null};}
 function snapshot(){return {schema:'kaminos.posed-motion.v1',assigned:assigned?{id:assigned.id,motion:structuredClone(assigned.motion)}:null,displayed:displayed?{id:displayed.id,motion:structuredClone(displayed.motion)}:null,frame,rate,startingPose:structuredClone(startingPose)};}
 function check(value){
  if(value===undefined)return null; // Static poses remain compatible.
  if(value?.schema!=='kaminos.posed-motion.v1'||!Number.isFinite(value.rate)||value.rate<=0)throw Error('Invalid saved creature motion');
  model.check(value.startingPose);
  const a=value.assigned?prepare(value.assigned):null,d=value.displayed?prepare(value.displayed):null;
  if(!Number.isInteger(value.frame)||value.frame<0||(d?value.frame>=d.palette.frames:value.frame!==0))throw Error('Saved motion frame is outside retained motion');
  return {assigned:a?.row??null,displayed:d?.row??null,adapter:d?.palette??null,frame:value.frame,rate:value.rate,startingPose:structuredClone(value.startingPose)};
 }
 function restore(value){const next=check(value);pause();if(!next){assigned=displayed=adapter=null;frame=0;rate=1;}else{({assigned,displayed,adapter,frame,rate,startingPose}=next);}elapsed=adapter?frame/adapter.fps:0;}
 const operations={play,pause,replay(){seek({frame:0});return play();},seek,step({direction}){if(direction!==1&&direction!==-1)throw Error('Step direction must be -1 or 1');return seek({frame:Math.max(0,Math.min(adapter?.frames-1??0,frame+direction))});},rate({rate:value}){admit();if(!Number.isFinite(value)||value<=0)throw Error('Playback rate must be positive');rate=value;changed();return read();},previewMotion({id}){return select(sessionMotions.get(id),false);},assignMotion({id}){return select(sessionMotions.get(id),true);},restoreMotion(){admit();if(assigned)return select(assigned,false);pause();adapter=displayed=null;frame=0;model.restore(startingPose);changed();return read();}};
 if(data.motion){assigned=displayed=await sessionMotions.add(data.motion);adapter=prepare(displayed).palette;}
 return {reference,read,operations,snapshot,check,restore,pause,async retain(value){check(value);for(const row of [value?.assigned,value?.displayed])if(row){const kept=await sessionMotions.add(row.motion);if(kept.id!==row.id)throw Error('Saved motion digest mismatch');}},dispose(){pause();disposed=true;}};
}
