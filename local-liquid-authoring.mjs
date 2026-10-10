import {normalizeLocalLiquidEmitter} from './local-liquid-setup.mjs';

// Stable per-object history targets survive selection changes and membership replay.
// The caller resolves the current scene record, rather than retaining an old mesh.
export function createLocalLiquidEmitterAuthoring({edits,readRecord,writeSettings}) {
 const registered=new Set();
 function record(id) {
  const value=readRecord(id);
  if(!value?.localLiquidEmitter)throw Error(`Water emitter "${id}" is not in the scene`);
  return value;
 }
 function target(id) {
  const key=`@water-emitter:${id}`;
  record(id);
  if(!registered.has(key)) {
   const check=value=>normalizeLocalLiquidEmitter(value,record(id).transform);
   edits.register(key,{read:()=>structuredClone(record(id).localLiquidEmitter),check,
    write:value=>{
     const next=check(value),before=structuredClone(record(id).localLiquidEmitter);
     try {writeSettings(id,next);}
     catch(error) {writeSettings(id,before);throw error;}
    }});
   registered.add(key);
  }
  return key;
 }
 return {target,read:id=>structuredClone(record(id).localLiquidEmitter),
  apply:(id,patch)=>edits.apply(target(id),patch,'Edit water emission')};
}

// A derived draw choice, not a mutation of authored environment visibility.
// Only the generic editor helper is suppressed; authored scene meshes still occlude.
export function withLocalLiquidHelperGround(ground,draw) {
 const visible=ground?.visible;
 try {if(ground)ground.visible=false;return draw();}
 finally {if(ground)ground.visible=visible;}
}
