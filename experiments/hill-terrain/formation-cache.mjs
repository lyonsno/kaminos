import {FORMATION_VERSION,formationConfig,formationKey,formationRecipeKey,decodeFormation} from './formation.mjs';
const memory=new Map();
async function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('kaminos-hill-formation',1);r.onupgradeneeded=()=>r.result.createObjectStore('formed');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function stored(key,buffer){const db=await database();try{return await new Promise((resolve,reject)=>{const t=db.transaction('formed',buffer?'readwrite':'readonly'),r=buffer?t.objectStore('formed').put(buffer,key):t.objectStore('formed').get(key);t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error??Error('Cache transaction aborted'));});}finally{db.close();}}
export function requestFormation(input,{initial=null,onProgress=()=>{}}={}){
 const config=formationConfig(input),key=formationKey(config);let worker=null,cancelled=false,rejectWorker;
 const seed=initial&&initial.version===FORMATION_VERSION&&formationRecipeKey(initial.config)===formationRecipeKey(config)&&Number.isSafeInteger(initial.steps)&&initial.steps>0&&initial.steps<=config.iterations&&initial.state instanceof Float32Array?{version:initial.version,config:initial.config,steps:initial.steps,state:Float32Array.from(initial.state),metrics:initial.metrics}:null;
 const promise=(async()=>{
  let buffer=memory.get(key),cache='memory',warning=null;
  if(!buffer){try{buffer=await stored(key);cache='browser';}catch(e){warning='Persistent cache unavailable: '+e.message;}}
  if(!buffer&&key===formationKey({})){const response=await fetch(new URL('./cache/default.hill',import.meta.url));if(!response.ok)throw Error('Bundled formation cache unavailable: '+response.status);buffer=await response.arrayBuffer();cache='bundled';}
  if(cancelled)throw Error('Formation cancelled');
  if(!buffer){cache='generated';buffer=await new Promise((resolve,reject)=>{rejectWorker=reject;worker=new Worker(new URL('./formation-worker.mjs',import.meta.url),{type:'module'});worker.onerror=e=>reject(Error(e.message));worker.onmessage=({data})=>{if(data.error)reject(Error(data.error));else if(data.buffer)resolve(data.buffer);else onProgress(data);};worker.postMessage(seed?{config,initial:seed}:config);}).finally(()=>{worker?.terminate();worker=null;});}
  if(cancelled)throw Error('Formation cancelled');const result=decodeFormation(buffer,config);memory.set(key,buffer);
  if(cache==='generated'||cache==='bundled')try{await stored(key,buffer);}catch(e){warning='Persistent cache unavailable: '+e.message;}
  return{...result,cache,warning,bytes:buffer.byteLength};
 })();return{promise,cancel(){cancelled=true;worker?.terminate();worker=null;rejectWorker?.(Error('Formation cancelled'));}};
}
