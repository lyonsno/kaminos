// The camera sample survives even when the inference server never receives it.
export async function openCaptureStore() {
  const request=indexedDB.open('hand-live-diagnostic',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('captures',{keyPath:'captureId'});
  const db=await new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  return {
    async put(capture) {
      await new Promise((resolve,reject)=>{
        const transaction=db.transaction('captures','readwrite');
        transaction.objectStore('captures').put(capture);
        transaction.oncomplete=resolve;
        transaction.onabort=()=>reject(transaction.error ?? Error('camera retention aborted'));
        transaction.onerror=()=>reject(transaction.error);
      });
    },
    close:()=>db.close(),
  };
}
