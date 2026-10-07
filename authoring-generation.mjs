import { createSharedDeviceSf3dProducer, connectSf3dForeground, snapshotSf3dSharedDevice } from './sf3d-host-device.mjs';

// The current SF3D producer reports denominator-bearing percentages per stage.
// Unknown phases stay indeterminate; these are not estimated whole-run timings.
export function generationProgress(value) {
  const message=String(value);
  const match=message.match(/^(Loading weights|DINOv2 blocks|Two-stream duties|Post-processor (?:duties|planes)|Texture bake)\b.*?([\d.]+)%/);
  const percent=match?Number(match[2]):NaN;
  return {message,stage:match?match[1].replace(/ (blocks|duties|planes)$/,''):null,
    percent:Number.isFinite(percent)&&percent>=0&&percent<=100?percent:null};
}

const errorIdentity=value=>({name:typeof value?.name==='string'?value.name:'Error',message:typeof value?.message==='string'?value.message:String(value)});

export function createAuthoringGeneration({initialize,loadInput,persist,changed=()=>{}}) {
  let producer=null,active=false,abort=null;
  let state={status:'idle',progress:'Weights load when you generate.',stage:null,percent:null,canStop:false,error:null,terminal:null,results:[],pending:null};
  const publish=()=>changed(structuredClone(state));
  const progress=value=>{
    if(abort?.signal.aborted)return;
    const parsed=generationProgress(value);state.progress=parsed.message;state.stage=parsed.stage;state.percent=parsed.percent;publish();
  };
  const checkStop=()=>{if(abort?.signal.aborted)throw abort.signal.reason;};
  async function storePending() {
    state.status='saving';state.canStop=false;state.stage='Saving mesh';state.percent=null;state.progress='Saving generated mesh…';publish();
    const {glb,generation,label}=state.pending;
    const saved=await persist(glb,generation,label);
    state.results.push(saved);state.pending=null;state.status='complete';state.error=null;state.percent=100;state.stage='Complete';state.progress='Mesh saved. Add it to this scene when you want.';publish();return saved;
  }
  return {
    read:()=>structuredClone(state),
    stop() {
      if(!active||!state.canStop||abort.signal.aborted)return false;
      abort.abort(new DOMException('Generation stopped by operator','AbortError'));state.canStop=false;state.status='stopping';state.progress='Stopping… waiting for the current work to settle.';publish();return true;
    },
    async retryPersistence() {
      if(active)throw Error('Generation is already running');
      if(!state.pending)throw Error('No generated output needs saving');
      active=true;
      try{return await storePending();}
      catch(error){state.status='failed';state.error=`persistence: ${errorIdentity(error).message}`;publish();throw error;}
      finally{active=false;}
    },
    async run(input) {
      if(active)throw Error('Generation is already running');
      if(state.pending)throw Error('Save the retained generated output before another run');
      if(!input?.source)throw Error('Choose a source image');
      active=true;abort=new AbortController();state.error=null;state.terminal=null;state.pending=null;state.status='input';state.canStop=true;state.percent=null;state.stage=null;state.progress='Opening source image…';let phase='input';publish();
      try {
        const source=await loadInput(input,{signal:abort.signal});checkStop();
        phase='weights';state.status='loading';state.stage=null;state.percent=null;state.progress='Loading Stable Fast 3D…';publish();
        if(!producer)producer=await initialize(progress,{signal:abort.signal});checkStop();
        phase='inference';state.status='running';state.percent=null;state.stage=null;state.progress='Generating textured mesh…';publish();
        const runId=`authoring-sf3d-${crypto.randomUUID()}`;
        const result=await producer.run(source.image,{runId,signal:abort.signal,onProgress:value=>{
          // SF3D's cooperative progress callback is fail-fast and runs after
          // a completed duty. AbortError stops later duties; the producer's
          // existing finish boundary drains admitted foreground work.
          checkStop();progress(value);
        }});
        if(!(result.glb?.byteLength>0)||result.receiptValidation?.ok!==true)throw Error('SF3D returned missing mesh bytes or an invalid producer receipt');
        // Completed bytes win a stop race. Persistence retries reuse these bytes,
        // including when origin publication fails; they never rerun inference.
        const generation={schema:'kaminos.asset-generation.v1',runId,input:source.identity,route:'sf3d.image-to-mesh.webgpu-local.v0',
          identity:result.identity,receipt:result.receipt,receiptValidation:result.receiptValidation};
        state.pending={glb:result.glb,generation,label:input.label || input.name || 'Generated'};phase='persistence';
        return await storePending();
      }catch(error){
        const identity=errorIdentity(error),secondary=error?.cooperativeExecutionReport?.failure?.secondaryFailures || [];
        state.terminal={phase,run:error?.sf3dRun || null,cooperative:error?.cooperativeExecutionReport || null,error:identity};
        if(phase!=='persistence'&&abort.signal.aborted&&identity.name==='AbortError'&&secondary.length===0){state.status='stopped';state.error=null;state.percent=null;state.stage=null;state.progress='Generation stopped. Your scene is unchanged.';return null;}
        state.status='failed';
        const message=secondary.length?`${identity.message}; cancellation drain failed: ${secondary.map(failure=>errorIdentity(failure.error).message).join('; ')}`:identity.message;
        state.error=`${phase}: ${message}`;
        if(secondary.length)throw new AggregateError([error,...secondary.map(failure=>Error(errorIdentity(failure.error).message))],message,{cause:error});
        throw error;
      }finally{active=false;state.canStop=false;abort=null;publish();}
    },
  };
}

export function createSf3dAuthoringGeneration({context,request=fetch,changed=()=>{},blocked=()=>null}) {
  const hex=buffer=>crypto.subtle.digest('SHA-256',buffer).then(value=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join(''));
  const service=createAuthoringGeneration({changed,
    async loadInput(input,{signal}) {
      const reason=blocked();if(reason)throw Error(reason);
      const url=new URL(input.source,location.href);
      if(url.origin!==location.origin || url.pathname!=='/api/read' || !url.searchParams.get('root') || !url.searchParams.get('path'))throw Error('Generation source must be a mounted image asset');
      const response=await request(input.source,{signal});if(!response.ok)throw Error(`Source image HTTP ${response.status}`);
      const bytes=await response.arrayBuffer(),sha256=await hex(bytes),blob=new Blob([bytes],{type:response.headers.get('Content-Type')||'image/png'});
      const objectUrl=URL.createObjectURL(blob),image=new Image();
      try{image.src=objectUrl;await image.decode();}finally{URL.revokeObjectURL(objectUrl);}
      return{image,identity:{source:input.source,sha256,name:input.name||input.label,width:image.naturalWidth,height:image.naturalHeight}};
    },
    async initialize(progress) {
      const {sharedGpu,prototype,host}=context();
      snapshotSf3dSharedDevice(sharedGpu);
      if(!prototype?.foregroundGpuContext || !host)throw Error('SF3D currently requires the ordinary flame host');
      const {createSf3dProducer}=await import('./lib/sf3d/sf3d-producer.js');
      const producer=await createSharedDeviceSf3dProducer(createSf3dProducer,sharedGpu,{weightsUrl:'./lib/sf3d/weights.bin',
        onWeightsProgress:(received,total)=>progress(total?`Loading weights ${Math.round(received/total*100)}%`:`Loading weights ${received} bytes`)});
      connectSf3dForeground(producer,prototype,host);return producer;
    },
    async persist(glb,generation,label) {
      const sha256=await hex(glb),response=await request('/api/ingest-mesh',{method:'POST',headers:{'Content-Type':'model/gltf-binary'},body:glb});
      const saved=await response.json();
      if(!response.ok||saved.schema!=='kaminos.generated-mesh.v0'||saved.sha256!==sha256||saved.bytes!==glb.byteLength||saved.source!==`/api/read?root=generated-meshes&path=${sha256}.glb`)throw Error(saved.error||'Generated mesh storage returned a different artifact');
      const result={source:saved.source,sha256,name:`${label.replace(/\.[^.]+$/,'')} · SF3D.glb`,generation:{...generation,sha256,bytes:glb.byteLength}};
      const originResponse=await request('/api/mesh-generation-origin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
      const origin=await originResponse.json();
      if(!originResponse.ok||origin.schema!=='kaminos.mesh-generation-origin.v1'||origin.result?.source!==result.source||origin.result?.sha256!==result.sha256||origin.result?.name!==result.name||origin.result?.generation?.runId!==generation.runId||origin.result?.generation?.input?.sha256!==generation.input.sha256||origin.result?.generation?.route!==generation.route||origin.result?.generation?.bytes!==glb.byteLength)throw Error(origin.error||'Generation origin storage returned a different result');
      return result;
    },
  });
  return {...service,read(){
    const state=service.read();
    if(state.status==='idle'){
      const current=context();let reason=blocked();
      if(!reason&&!current.prototype?.foregroundGpuContext)reason='Load a Fire & smoke scene to use the current SF3D host.';
      if(!reason){try{snapshotSf3dSharedDevice(current.sharedGpu);}catch(error){reason=error.message;}}
      if(reason)return {...state,status:'unavailable',error:reason};
    }
    return state;
  }};
}
