// The external evidence root is canonical. Browser storage is used only when
// that write fails, preserving the disputed source without routine duplication.
export async function openCaptureStore(retain) {
  let db=null;
  const putFallback=async value=>{
    if(!db){
      const request=indexedDB.open('kaminos-hand-input',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('captures',{keyPath:'captureId'});
      db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    }
    await new Promise((resolve,reject)=>{
      const transaction=db.transaction('captures','readwrite');transaction.objectStore('captures').put(value);
      transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error??Error('camera retention aborted'));transaction.onerror=()=>reject(transaction.error);
    });
  };
  return {
    async put(capture) {
      let receipt;
      try {
        receipt=await retain(capture);
        if(!receipt?.retained||receipt.captureId!==capture.captureId)throw Error('Hand source retention was not acknowledged');
        if(!capture.sourceFailure&&!receipt.source?.sha256)throw Error('Retained hand source identity is missing');
      } catch(error) {
        await putFallback({...capture,retentionFailure:String(error)});throw error;
      }
      const {image,...request}=capture.request??{};
      return {...capture,request,source:receipt.source};
    },
    close:()=>db?.close(),
  };
}
