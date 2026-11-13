export const HAND_MODELS = Object.freeze({spiralconv:'SpiralConv',dsconv:'DSConv',wilor:'WiLoR'});

// One owner across workspace/experiment changes. The injected camera schedules
// one fresh sample after each completed inference; model admission owns capture.
export function createHandInput({openCamera,loadModel,present,clear,record,now=()=>performance.now()}) {
  let enabled=false,model='spiralconv',effectiveModel=null,phase='off',error=null;
  let auto={left:true,right:true},camera=null,backend=null,flight=null,tail=Promise.resolve();
  let generation=0,disposed=false,abort=null,last=null,sequence=0;
  const subscribers=new Set();
  const read=()=>({enabled,model,effectiveModel,auto:{...auto},phase,error,identity:backend?.identity??null,
    last,lastAgeMs:last?now()-last.presentedAt:null});
  const notify=()=>{const value=read();for(const fn of subscribers)fn(value);};
  const hide=()=>{last=null;clear();};
  const invalidate=()=>{generation++;abort?.abort();backend?.stop?.();hide();};
  function schedule() {
    if(enabled&&camera&&backend&&!disposed)camera.schedule(sample);
  }
  async function sample() {
    if(!enabled||!backend||flight||disposed)return;
    const ticket=generation,current=backend,sides=Object.keys(auto).filter(side=>auto[side]);
    if(!sides.length){phase='waiting';hide();notify();schedule();return;}
    let capture,modelResult;
    flight=(async()=>{
      try {
        const result=modelResult=await current.infer({sides,getFrame:async()=>{
          if(ticket!==generation)throw new DOMException('Hand input changed','AbortError');
          capture=await camera.frame();
          capture.frameId=++sequence;capture.capturedAt=now();
          await record?.begin?.(capture,{model,auto:{...auto},identity:current.identity});
          return capture;
        }});
        if(ticket!==generation||!enabled||disposed){await record?.finish?.(capture,{state:'superseded',result});return;}
        if(!Array.isArray(result.hands))throw Error('Hand route did not return per-side observations');
        if(result.hands.some(h=>!sides.includes(h.handedness)))throw Error('Hand route returned a disabled side');
        phase=result.hands.length?'tracking':'waiting';
        last={...result,captureId:capture?.captureId,capturedAt:capture?.capturedAt,frameId:capture?.frameId,presentedAt:now()};
        present(last);error=null;
        await record?.finish?.(capture,{state:'presented',result});
      } catch(cause) {
        if(capture)await record?.finish?.(capture,{state:'failed',error:String(cause),result:modelResult}).catch(()=>{});
        if(ticket!==generation||disposed)return;
        error=String(cause?.message??cause);phase='error';hide();
        camera?.stop();camera=null;
      } finally {capture?.close?.();}
    })();
    try{await flight;}finally{
      flight=null;
      if(phase==='error'){await releaseBackend();await record?.close?.().catch(()=>{});}
      notify();if(phase!=='error')schedule();
    }
  }
  async function releaseBackend(){const old=backend;backend=null;effectiveModel=null;if(old)await old.destroy();}
  function reconcile() {
    const task=tail.catch(()=>{}).then(async()=>{
      if(disposed||!enabled){
        camera?.stop();camera=null;
        if(flight)await flight;
        await releaseBackend();await record?.close?.();phase='off';notify();return read();
      }
      const ticket=generation;
      try {
        phase='loading';error=null;notify();
        if(flight)await flight;
        if(backend&&effectiveModel!==model)await releaseBackend();
        if(!enabled||disposed||ticket!==generation)return read();
        if(!camera){
          const acquired=await openCamera();
          if(!enabled||disposed||ticket!==generation){acquired.stop();return read();}
          camera=acquired;
        }
        if(!backend){
          abort=new AbortController();const wanted=model;
          const loaded=await loadModel(wanted,{signal:abort.signal,onProgress:()=>notify()});
          if(!enabled||disposed||ticket!==generation){await loaded.destroy();return read();}
          backend=loaded;effectiveModel=wanted;abort=null;
        }
        phase='waiting';notify();schedule();return read();
      }catch(cause){
        if(ticket!==generation||disposed)return read();
        camera?.stop();camera=null;await releaseBackend();
        error=String(cause?.message??cause);phase='error';hide();notify();throw cause;
      }
    });
    tail=task;return task;
  }
  return {
    read,subscribe(fn){subscribers.add(fn);fn(read());return()=>subscribers.delete(fn);},
    async setEnabled(value){
      if(disposed)throw Error('hand input disposed');
      if(typeof value!=='boolean')throw TypeError('enabled must be boolean');
      enabled=value;invalidate();
      if(!enabled){camera?.stop();camera=null;phase='off';}
      notify();return reconcile();
    },
    async setModel(value){
      if(!Object.hasOwn(HAND_MODELS,value))throw Error('unknown hand model');
      if(disposed)throw Error('hand input disposed');
      if(value===model)return read();model=value;invalidate();notify();return reconcile();
    },
    async setAuto(side,value){
      if(!Object.hasOwn(auto,side)||typeof value!=='boolean')throw Error('invalid hand auto setting');
      if(disposed)throw Error('hand input disposed');
      auto={...auto,[side]:value};invalidate();notify();return reconcile();
    },
    async fail(cause){
      try{await this.setEnabled(false);}finally{error=String(cause?.message??cause);phase='error';notify();}
    },
    async dispose(){if(disposed)return;disposed=true;enabled=false;invalidate();camera?.stop();camera=null;await reconcile();await record?.close?.();subscribers.clear();},
  };
}
