// Image -> textured mesh with TRELLIS 2 in the Authoring Assets drawer. This consumes the
// server's queued TRELLIS route (pipelines/asset-pipelines.json, scripts/run-trellis-
// greenroom-adapter.mjs): the model runs in the GPU queue's own browser, not on the kiln's
// device, and the adapter admits only a fresh GLB for the selected image. The service has
// the same read/stop/run/retryPersistence shape as the SF3D one so the drawer can use either.

export const TRELLIS_PIPELINE_ID='trellis-image-to-mesh-webgpu-v0';
export const TRELLIS_ROUTE_ID='trellis2.image-generation.webgpu.v0';
const PHASES={queued:'Waiting for the GPU queue',running:'Generating',complete:'Finishing'};

export function createTrellisAuthoringGeneration({availability,runPipeline,meshUrl,fetchBytes,persist,changed=()=>{},blocked=()=>null}){
  let active=false;
  let state={status:'idle',progress:'TRELLIS runs in the GPU queue; it can take several minutes.',stage:null,percent:null,canStop:false,error:null,terminal:null,results:[],pending:null};
  const publish=()=>changed(structuredClone(state));
  const set=values=>{Object.assign(state,values);publish();};
  function unavailable(){
    const reason=blocked();if(reason)return reason;
    const value=availability();
    if(!value)return 'TRELLIS availability is loading.';
    return value.status==='available'?null:(value.message||'TRELLIS is unavailable on this server');
  }
  async function storePending(){
    set({status:'saving',stage:'Saving mesh',percent:null,progress:'Saving generated mesh…'});
    const {glb,generation,label}=state.pending;
    const saved=await persist(glb,generation,label);
    state.results.push(saved);state.pending=null;
    set({status:'complete',error:null,percent:100,stage:'Complete',progress:'Mesh saved. Add it to this scene when you want.'});
    return saved;
  }
  return {
    read(){
      if(state.status==='idle'||state.status==='unavailable'){
        const reason=unavailable();
        return reason?{...structuredClone(state),status:'unavailable',error:reason}:{...structuredClone(state),status:'idle'};
      }
      return structuredClone(state);
    },
    // Queued jobs belong to the GPU queue; the page has no cancel route for them yet.
    stop:()=>false,
    async retryPersistence(){
      if(active)throw Error('Generation is already running');
      if(!state.pending)throw Error('No generated output needs saving');
      active=true;
      try{return await storePending();}
      catch(error){set({status:'failed',error:`persistence: ${error.message}`});throw error;}
      finally{active=false;}
    },
    async run(input){
      if(active)throw Error('Generation is already running');
      if(state.pending)throw Error('Save the retained generated output before another run');
      if(!input?.source)throw Error('Choose a source image');
      const reason=unavailable();if(reason)throw Error(reason);
      active=true;let phase='inference';
      set({status:'running',error:null,terminal:null,stage:'Submitting',percent:null,canStop:false,progress:'Submitting to the GPU queue…'});
      try{
        const clientRunId=`authoring-trellis-${crypto.randomUUID()}`;
        const result=await runPipeline({pipelineId:TRELLIS_PIPELINE_ID,source:input.source,streamProgress:true,clientRunId},{onProgress:event=>{
          if(event?.schema!=='kaminos.pipeline-progress.v0')return;
          set({stage:PHASES[event.phase]||state.stage||'Generating',progress:event.message||state.progress});
        }});
        if(!result?.ok)throw Error(`TRELLIS generation failed: ${result?.error?.message||result?.error||'no result'}`);
        const url=meshUrl(result);if(!url)throw Error('TRELLIS run returned no mesh');
        const glb=await fetchBytes(url);
        if(!(glb?.byteLength>=12)||new DataView(glb).getUint32(0,true)!==0x46546c67)throw Error('TRELLIS mesh bytes are missing or not a GLB');
        const generation={schema:'kaminos.asset-generation.v1',runId:result.runId||clientRunId,input:{source:input.source,sha256:input.preparation?.original?.sha256||null,name:input.name||input.label},
          route:TRELLIS_ROUTE_ID,pipelineId:TRELLIS_PIPELINE_ID,receiptValidation:{ok:true,by:'trellis-greenroom-adapter'}};
        state.pending={glb,generation,label:(input.label||input.name||'Generated').replace(/\.[^.]+$/,'')};phase='persistence';
        return await storePending();
      }catch(error){
        state.terminal={phase,error:{name:error?.name||'Error',message:error?.message||String(error)}};
        set({status:'failed',error:`${phase}: ${error?.message||error}`,stage:null,percent:null});throw error;
      }finally{active=false;publish();}
    },
  };
}

// Mesh model picker in the Generate tab. The choice holds while either model is running.
export const MESH_MODELS={sf3d:{label:'Stable Fast 3D',detail:'Image → textured mesh · Stable Fast 3D (fast, beside the kiln)'},
  trellis:{label:'TRELLIS 2',detail:'Image → textured mesh · TRELLIS 2 (better, minutes, GPU queue)'}};
export function installMeshModelChoice({document,initial='sf3d',busy=()=>false,changed=()=>{}}){
  const run=document.getElementById('asset-run');if(!run)throw Error('Generate mesh button is missing');
  const label=document.createElement('label');label.id='asset-mesh-model-row';
  label.innerHTML=`Mesh model <select id="asset-mesh-model" aria-label="Mesh model">${Object.entries(MESH_MODELS).map(([id,m])=>`<option value="${id}">${m.label}</option>`).join('')}</select>`;
  run.before(label);
  const select=label.querySelector('select');select.value=initial;
  const heading=()=>[...document.getElementById('asset-generate').querySelectorAll(':scope > p')].find(p=>p.textContent.startsWith('Image → textured mesh'));
  function render(){select.disabled=busy();const p=heading();if(p)p.textContent=MESH_MODELS[select.value].detail;}
  select.onchange=()=>{render();changed(select.value);};
  render();
  return {value:()=>select.value,render};
}
