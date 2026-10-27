export const AO_DEFAULTS=Object.freeze({enabled:true,radius:10,intensity:1,scale:.75,thickness:1.45,falloff:.48});
export const AO_CONTROL_FIELDS=Object.freeze({enabled:'ao-toggle',radius:'ao-radius',intensity:'ao-intensity',scale:'ao-scale',thickness:'ao-thickness',falloff:'ao-falloff'});
const own=(value,key)=>Object.hasOwn(value,key);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function createSceneAOState(){
 let value=AO_DEFAULTS;const listeners=new Set();
 function check(patch){
  if(!object(patch))throw Error('Invalid ambient occlusion settings');
  for(const key of Object.keys(patch))if(!own(AO_DEFAULTS,key))throw Error(`Unknown AO parameter ${key}`);
  const next={...value,...patch};
  if(typeof next.enabled!=='boolean')throw Error('Invalid AO enabled state');
  for(const key of Object.keys(AO_DEFAULTS).filter(key=>key!=='enabled'))if(typeof next[key]!=='number'||!Number.isFinite(next[key])||next[key]<0)throw Error(`Invalid AO ${key}`);
  return next;
 }
 function patch(next){value=Object.freeze(check(next));for(const listener of listeners)listener(value);return value;}
 return Object.freeze({read:()=>value,check,patch,
  document:()=>({...value,farBlend:value.falloff}),
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  restoreDocument(saved){
   if(!object(saved))throw Error('Invalid saved ambient occlusion settings');
   const next={enabled:saved.enabled??true};
   for(const key of Object.keys(AO_DEFAULTS).filter(key=>key!=='enabled'))if(own(saved,key))next[key]=saved[key];
   if(saved.intensity===undefined&&saved.scale!==undefined)next.intensity=saved.scale;
   if(saved.falloff===undefined&&saved.farBlend!==undefined)next.falloff=saved.farBlend;
   return patch(next);
  },
  restoreLegacy(saved){
   if(!object(saved))throw Error('Invalid browser AO settings');const next={};
   for(const [key,id] of Object.entries(AO_CONTROL_FIELDS))if(own(saved,id)){
    const raw=saved[id];if(key!=='enabled'&&typeof raw==='string'&&!raw.trim())throw Error(`Invalid AO ${key}`);
    next[key]=key==='enabled'?raw:Number(raw);
   }
   return patch(next);
  },
  legacySettings:()=>Object.fromEntries(Object.entries(AO_CONTROL_FIELDS).map(([key,id])=>[id,key==='enabled'?value[key]:String(value[key])])),
 });
}

// Editor text is local; only admitted values reach rendering and persistence.
export function bindSceneAOControls({state,document,onAccepted=()=>{},onError=()=>{}}){
 const fields=Object.fromEntries(Object.entries(AO_CONTROL_FIELDS).map(([key,id])=>[key,document.getElementById(id)]));
 const decimals={radius:2,intensity:1,scale:2,thickness:2,falloff:2},stops=[];
 function sync({force=false}={}){
  const value=state.read();
  for(const [key,input] of Object.entries(fields)){
   if(!input)continue;
   if(key==='enabled')input.checked=value[key];
   else{
    input.min=String(Math.min(Number(input.min||0),value[key]));input.max=String(Math.max(Number(input.max||value[key]),value[key]));input.step='any';
    if(force||document.activeElement!==input)input.value=String(value[key]);
    const output=document.getElementById(AO_CONTROL_FIELDS[key]+'-val');if(output)output.textContent=value[key].toFixed(decimals[key]);
   }
  }
  const panel=document.getElementById('ao-controls');if(panel)panel.style.display=value.enabled?'':'none';
 }
 for(const [key,input] of Object.entries(fields)){
  if(!input)continue;
  const accept=()=>{
   if(key!=='enabled'&&!input.value.trim())return;
   try{state.patch({[key]:key==='enabled'?input.checked:Number(input.value)});onAccepted();}catch(error){onError(error);}
  };
  const finish=()=>sync({force:true}),type=key==='enabled'?'change':'input';
  input.addEventListener(type,accept);input.addEventListener('change',finish);input.addEventListener('blur',finish);
  stops.push(()=>{input.removeEventListener(type,accept);input.removeEventListener('change',finish);input.removeEventListener('blur',finish);});
 }
 const stop=state.subscribe(()=>sync());sync();return {sync,dispose(){stop();for(const stop of stops)stop();}};
}
