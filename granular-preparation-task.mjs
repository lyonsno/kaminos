// The worker owns physical time. Host frames only display completed states.
export async function createPreparationTask({recipe,snapshot,WorkerType=globalThis.Worker,onChange=()=>{}}={}){
 const worker=new WorkerType(new URL('./granular-preparation-worker.mjs',import.meta.url),{type:'module'}),pending=new Map();let serial=0,current,disposed=false,failure=null,running=false,paused=false;
 const fail=error=>{failure=error;worker.terminate();for(const p of pending.values())p.reject(error);pending.clear();};
 worker.onerror=e=>fail(Error(e.message||'Preparation worker failed'));worker.onmessageerror=()=>fail(Error('Unreadable preparation worker result'));
 worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;pending.delete(data.id);if(data.error)task.reject(Error(data.error));else{current=data;task.resolve(data.state);}};
 const request=message=>{if(disposed)return Promise.reject(Error('Preparation disposed'));if(failure)return Promise.reject(failure);return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});try{worker.postMessage({...message,id});}catch(e){pending.delete(id);reject(e);}});};
 const api={read:()=>({...structuredClone(current.state),running,paused,failure:failure?.message??null}),snapshot:()=>structuredClone(current.snapshot),
  async run(operation,options={}){if(running)throw Error('Preparation already running');running=true;paused=false;try{if(operation)await request({kind:'start',operation,options});if(!current.state.phase)throw Error('No preparation to continue');onChange(api.read());while(current.state.phase&&!paused&&!disposed){await request({kind:'advance',seconds:.025});if(!disposed)onChange(api.read());await new Promise(resolve=>setTimeout(resolve,0));}return api.read();}finally{running=false;if(!disposed)onChange(api.read());}},
  pause(){paused=true;return api.read();},
  dispose(){disposed=true;worker.terminate();for(const p of pending.values())p.reject(Error('Preparation disposed'));pending.clear();}
 };
 try{await request({kind:'init',recipe,snapshot});return api;}catch(e){api.dispose();throw e;}
}
