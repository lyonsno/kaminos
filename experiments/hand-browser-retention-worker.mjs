import {openCaptureStore} from './hand-live-retention.mjs';

export function createCaptureWriter({store,encode,writeEvent}) {
  const captures=new Map();let tail=Promise.resolve(),failure=null;
  async function write(message) {
    if(message.type==='capture') {
      const {capture,bitmap}=message;
      let image;
      try {image=await encode(bitmap);}
      catch(error) {
        const value={...capture,sourceFailure:String(error),outcome:{state:'failed',phase:'source_encoding',error:String(error)}};
        captures.set(capture.captureId,value);
        await store.put(value);
        throw error;
      } finally {bitmap.close?.();}
      const value={...capture,request:{...capture.request,imageMime:'image/png',image},outcome:{state:'submitted'}};
      captures.set(capture.captureId,value);
      await store.put(value);
    } else if(message.type==='outcome') {
      const capture=captures.get(message.captureId);
      if(!capture)throw Error(`Unknown capture outcome: ${message.captureId}`);
      await store.put({...capture,outcome:message.outcome});
      captures.delete(message.captureId);
    } else if(message.type==='event') await writeEvent(message.value);
    else if(message.type==='flush') {if(failure)throw failure;}
    else throw Error(`Unknown retention operation: ${message.type}`);
  }
  return {
    enqueue(message) {
      const task=tail.then(()=>write(message));
      tail=task.catch(error=>{failure??=error;});
      return task;
    },
    read:()=>({pendingCaptures:captures.size,error:failure?String(failure):null}),
  };
}

async function encode(bitmap) {
  const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
  canvas.getContext('2d').drawImage(bitmap,0,0);
  const blob=await canvas.convertToBlob({type:'image/png'});
  const data=new FileReaderSync().readAsDataURL(blob);
  return data.slice(data.indexOf(',')+1);
}

if(typeof WorkerGlobalScope!=='undefined'&&globalThis instanceof WorkerGlobalScope) {
  const retain=async(kind,payload)=>{
    const response=await fetch('/api/hand-record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,payload})});
    if(!response.ok)throw Error(`Hand evidence retention failed: HTTP ${response.status}`);
  };
  openCaptureStore(capture=>retain('capture',capture)).then(store=>{
    const writer=createCaptureWriter({store,encode,writeEvent:value=>retain('event',value)});
    globalThis.onmessage=({data})=>{
      writer.enqueue(data).then(
        ()=>postMessage({type:'settled',sequence:data.sequence}),
        error=>postMessage({type:'settled',sequence:data.sequence,error:String(error)}));
    };
    postMessage({type:'loaded'});
  }).catch(error=>postMessage({type:'load_error',error:String(error)}));
}
