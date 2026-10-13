// CPU outputs live in browser storage; only the selected image owns GPU textures.
export async function photoCacheKey(image) {
  const hash=await crypto.subtle.digest('SHA-256',image.data);
  return `${image.width}x${image.height}:${Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')}`;
}

export function createInferenceCache({indexedDB=globalThis.indexedDB,onError=()=>{}}={}) {
  let opening;
  const open=()=>opening??=(async()=>{
    if(!indexedDB)throw Error('Browser result storage unavailable');
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('kaminos.material-photo-results',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('outputs');
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(Error('Browser result storage blocked'));
    });
  })().catch(error=>{opening=null;throw error;});
  async function access(key,value,write) {
    try{
      const db=await open();
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction('outputs',write?'readwrite':'readonly'),store=tx.objectStore('outputs');
        const request=write?store.put(value,key):store.get(key);
        tx.oncomplete=()=>resolve(write?true:request.result??null);
        tx.onabort=()=>reject(tx.error??request.error??Error('Result storage aborted'));
        tx.onerror=()=>{};
      });
    }catch(error){onError(error);return write?false:null;}
  }
  return {get:key=>access(key,null,false),put:(key,value)=>access(key,value,true)};
}

export function retainedGeometry(depth) {
  return Object.fromEntries(['width','height','depth','normals','points','colors','metricScale','fovX','fovY','mask']
    .filter(key=>depth[key]!==undefined).map(key=>[key,depth[key]]));
}
