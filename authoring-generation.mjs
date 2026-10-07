import { createSharedDeviceSf3dProducer, connectSf3dForeground, snapshotSf3dSharedDevice } from './sf3d-host-device.mjs';

export function createAuthoringGeneration({initialize,loadInput,persist,changed=()=>{}}) {
  let producer=null,active=false;
  let state={status:'idle',progress:'Weights load when you generate.',error:null,results:[],pending:null};
  const publish=()=>changed(structuredClone(state));
  async function storePending() {
    const {glb,generation,label}=state.pending;
    const saved=await persist(glb,generation,label);
    state.results.push(saved);state.pending=null;state.status='complete';state.error=null;state.progress='Mesh saved. Add it to this scene when you want.';publish();return saved;
  }
  return {
    read:()=>structuredClone(state),
    async retryPersistence() {
      if(active)throw Error('Generation is already running');
      if(!state.pending)throw Error('No generated output needs saving');
      active=true;
      try{return await storePending();}
      catch(error){state.status='failed';state.error=`persistence: ${error.message}`;publish();throw error;}
      finally{active=false;}
    },
    async run(input) {
      if(active)throw Error('Generation is already running');
      if(state.pending)throw Error('Save the retained generated output before another run');
      if(!input?.source)throw Error('Choose a source image');
      active=true;state.error=null;state.pending=null;let phase='input';publish();
      try {
        const source=await loadInput(input);
        phase='weights';state.status='loading';state.progress='Loading Stable Fast 3D…';publish();
        if(!producer)producer=await initialize(message=>{state.progress=String(message);publish();});
        phase='inference';state.status='running';state.progress='Generating textured mesh…';publish();
        const runId=`authoring-sf3d-${crypto.randomUUID()}`;
        const result=await producer.run(source.image,{runId,onProgress:message=>{state.progress=String(message);publish();}});
        if(!(result.glb?.byteLength>0)||result.receiptValidation?.ok!==true)throw Error('SF3D returned missing mesh bytes or an invalid producer receipt');
        // Preserve the result even when durable storage fails. A retry stores
        // these bytes; it never silently reruns inference or substitutes a demo.
        const generation={schema:'kaminos.asset-generation.v1',runId,input:source.identity,route:'sf3d.image-to-mesh.webgpu-local.v0',
          identity:result.identity,receipt:result.receipt,receiptValidation:result.receiptValidation};
        state.pending={glb:result.glb,generation,label:input.label || input.name || 'Generated'};phase='persistence';publish();
        return await storePending();
      }catch(error){state.status='failed';state.error=`${phase}: ${error.message}`;publish();throw error;}
      finally{active=false;}
    },
  };
}

export function createSf3dAuthoringGeneration({context,request=fetch,changed=()=>{},blocked=()=>null}) {
  const hex=buffer=>crypto.subtle.digest('SHA-256',buffer).then(value=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join(''));
  const service=createAuthoringGeneration({changed,
    async loadInput(input) {
      const reason=blocked();if(reason)throw Error(reason);
      const url=new URL(input.source,location.href);
      if(url.origin!==location.origin || url.pathname!=='/api/read' || !url.searchParams.get('root') || !url.searchParams.get('path'))throw Error('Generation source must be a mounted image asset');
      const response=await request(input.source);if(!response.ok)throw Error(`Source image HTTP ${response.status}`);
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
      return{source:saved.source,sha256,name:`${label.replace(/\.[^.]+$/,'')} · SF3D.glb`,generation:{...generation,sha256,bytes:glb.byteLength}};
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
