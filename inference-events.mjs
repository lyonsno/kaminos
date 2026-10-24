// In-memory, uncapped observations of inference runs. Exported snapshots are JSON data;
// replay consumers can retain them independently of the page and its GPU resources.
export const INFERENCE_RECORDING_SCHEMA='kaminos.inference-recording.v1';
const jsonCopy=value=>JSON.parse(JSON.stringify(value,(_key,item)=>ArrayBuffer.isView(item)?Array.from(item):item));
const terminal=new Set(['complete','stopped','failed']);
export function createInferenceEvents({now=()=>performance.now(),makeRunId=()=>`inference:${crypto.randomUUID()}`}={}){
  const observers=new Set(),runs=new Map();let latest=null;
  const snapshot=record=>jsonCopy({...record.data,durationMs:record.open?Math.max(record.data.durationMs,now()-record.started):record.data.durationMs});
  function publish(record,event){
    for(const observer of [...observers]){
      // Give each consumer its own snapshot so a UI cannot mutate the recording or a peer.
      try{Promise.resolve(observer.listener({runId:record.data.runId,source:jsonCopy(record.data.source),event:jsonCopy(event)})).catch(()=>{});}catch{/* observation must never fail the inference producer */}
    }
  }
  return {
    subscribe(listener,{previews=false,requestPreviews=false}={}){
      if(typeof listener!=='function')throw TypeError('Inference observer must be a function');
      const observer={listener,previews:previews||requestPreviews};observers.add(observer);
      return ()=>observers.delete(observer);
    },
    hasPreviewObservers:()=>[...observers].some(observer=>observer.previews),
    recordings:()=>[...runs.values()].map(snapshot),
    read(runId=latest){const record=runs.get(runId);return record?snapshot(record):null;},
    export(runId=latest){const record=runs.get(runId);return record?snapshot(record):null;},
    begin(source,{runId=makeRunId()}={}){
      if(runs.has(runId))throw Error(`Inference run already exists: ${runId}`);
      const record={started:now(),open:true,data:{schema:INFERENCE_RECORDING_SCHEMA,runId,source:jsonCopy(source),status:'running',durationMs:0,events:[]}};
      runs.set(runId,record);latest=runId;
      function emit(event){
        if(!record.open)return false;
        const item={...jsonCopy(event),atMs:Math.max(record.data.durationMs,now()-record.started)};
        record.data.durationMs=item.atMs;record.data.events.push(item);publish(record,item);return true;
      }
      function finish(status,details={}){
        if(!record.open)return false;
        if(!terminal.has(status))throw Error(`Unknown inference terminal status: ${status}`);
        const item={...jsonCopy(details),type:status,atMs:Math.max(record.data.durationMs,now()-record.started)};
        // Close before notifying consumers: a reentrant observer cannot append a late preview.
        record.open=false;record.data.status=status;record.data.durationMs=item.atMs;record.data.events.push(item);publish(record,item);return true;
      }
      emit({type:'start'});
      return {runId,emit,finish};
    },
  };
}
export const inferenceEvents=createInferenceEvents();
