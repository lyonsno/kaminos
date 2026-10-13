// Image -> textured mesh with TRELLIS 2 in the Authoring Assets drawer. This consumes the
// server's queued TRELLIS route (pipelines/asset-pipelines.json, scripts/run-trellis-
// greenroom-adapter.mjs): the model runs in the GPU queue's own browser, not on the kiln's
// device, and the adapter admits only a fresh GLB for the selected image. The service has
// the same read/stop/run/retryPersistence shape as the SF3D one so the drawer can use either.

export const TRELLIS_PIPELINE_ID='trellis-image-to-mesh-webgpu-v0';
export const TRELLIS_ROUTE_ID='trellis2.image-generation.webgpu.v0';
const PHASES={queued:'Waiting for the GPU queue',running:'Generating',complete:'Finishing'};

// The server's run result says only that the adapter exited; the adapter's last stdout
// line carries its phase and reason.
export function failureReason(result){
  const parts=[];const direct=result?.error?.message||result?.error||result?.report?.document?.error;
  if(direct)parts.push(String(direct));
  const lines=String(result?.stdoutTail||'').trim().split(/\r?\n/).reverse();
  for(const line of lines){let row;try{row=JSON.parse(line);}catch{continue;}
    if(row&&row.ok===false&&row.error){parts.push(`${row.phase?row.phase+': ':''}${row.error.message||row.error}`);break;}}
  return parts.join(' · ')||'no result';
}

const clock=seconds=>{const s=Math.max(0,Math.round(seconds||0));return s<60?`${s}s`:`${Math.floor(s/60)}m ${String(s%60).padStart(2,'0')}s`;};
// One line from Greenroom's own dispatch order: jobs ahead and time waited, or time running.
export function queueLine(report){
  if(!report)return '';
  if(report.status==='pending'){
    const ahead=report.jobsAhead,lane=report.serviceClass==='quick'?' (quick lane)':'';
    const running=report.running?.seconds!=null?` · current job running ${clock(report.running.seconds)}`:'';
    return `${ahead===0?'Next up':`${ahead} job${ahead===1?'':'s'} ahead`}${lane} · waiting ${clock(report.waitedSeconds)}${running}`;
  }
  if(report.status==='running')return `Running ${clock(report.runningSeconds)} · waited ${clock(report.waitedSeconds)} in the queue`;
  return '';
}

export function createTrellisAuthoringGeneration({availability,runPipeline,meshUrl,fetchBytes,persist,express=()=>false,queuePosition=null,pollMs=3000,changed=()=>{},blocked=()=>null}){
  let active=false,poll=null;
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
        const reason=unavailable(),extra={expressEligible:availability()?.express?.eligible===true,expressReason:availability()?.express?.reason||null};
        return reason?{...structuredClone(state),...extra,status:'unavailable',error:reason}:{...structuredClone(state),...extra,status:'idle'};
      }
      return {...structuredClone(state),expressEligible:availability()?.express?.eligible===true,expressReason:availability()?.express?.reason||null};
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
      const quick=express()===true;
      if(quick&&availability()?.express?.eligible!==true)throw Error(`Express is unavailable: ${availability()?.express?.reason||'the GPU queue does not admit TRELLIS to its quick lane'}`);
      active=true;let phase='inference';
      set({status:'running',error:null,terminal:null,stage:'Submitting',percent:null,canStop:false,progress:'Submitting to the GPU queue…'});
      try{
        const clientRunId=`authoring-trellis-${crypto.randomUUID()}`;
        const watch=jobId=>{
          if(!queuePosition||poll)return;
          const tick=async()=>{
            try{const report=await queuePosition(jobId);if(report&&poll)set({queue:report,queueLine:queueLine(report)});}catch{/* telemetry only */}
            if(poll)poll=setTimeout(tick,pollMs);
          };
          poll=setTimeout(tick,0);
        };
        const result=await runPipeline({pipelineId:TRELLIS_PIPELINE_ID,source:input.source,streamProgress:true,clientRunId,serviceClass:quick?'quick':'normal'},{onProgress:event=>{
          if(event?.schema!=='kaminos.pipeline-progress.v0')return;
          if(event.jobId)watch(event.jobId);
          set({stage:PHASES[event.phase]||state.stage||'Generating',progress:event.message||state.progress});
        }});
        if(!result?.ok)throw Error(`TRELLIS generation failed: ${failureReason(result)}`);
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
      }finally{clearTimeout(poll);poll=null;state.queue=null;state.queueLine='';active=false;publish();}
    },
  };
}

// Mesh model picker in the Generate tab. The choice holds while either model is running.
export const MESH_MODELS={sf3d:{label:'Stable Fast 3D',detail:'Image → textured mesh · Stable Fast 3D (fast, beside the kiln)'},
  trellis:{label:'TRELLIS 2',detail:'Image → textured mesh · TRELLIS 2 (better, minutes, GPU queue)'}};
export function installMeshModelChoice({document,initial='sf3d',busy=()=>false,changed=()=>{},trellisState=()=>null,storage=globalThis.localStorage}){
  const run=document.getElementById('asset-run');if(!run)throw Error('Generate mesh button is missing');
  const label=document.createElement('label');label.id='asset-mesh-model-row';
  label.innerHTML=`Mesh model <select id="asset-mesh-model" aria-label="Mesh model">${Object.entries(MESH_MODELS).map(([id,m])=>`<option value="${id}">${m.label}</option>`).join('')}</select>`;
  const heading=()=>[...document.getElementById('asset-generate').querySelectorAll(':scope > p')].find(p=>p.textContent.startsWith('Image → textured mesh'));
  // Directly under the mesh heading: the Generate mesh button sits below the drawer's fold.
  (heading()||run).after(label);if(!heading())run.before(label);
  const select=label.querySelector('select');select.value=initial;
  // Express: TRELLIS asks for the GPU queue's quick lane. On by default, remembered.
  const express=document.createElement('label');express.id='asset-express-row';
  express.innerHTML='<input type="checkbox" id="asset-express"> Express <small>quick lane in the GPU queue</small>';
  label.after(express);const box=express.querySelector('input');
  let stored=null;try{stored=storage?.getItem('kaminos.trellis.express');}catch{}
  box.checked=stored!=='off';
  box.onchange=()=>{try{storage?.setItem('kaminos.trellis.express',box.checked?'on':'off');}catch{}changed(select.value);};
  function render(){
    select.disabled=busy();const p=heading();if(p)p.textContent=MESH_MODELS[select.value].detail;
    const t=trellisState();express.hidden=select.value!=='trellis';
    const eligible=t?.expressEligible===true;box.disabled=busy()||!eligible;
    express.title=eligible?'Submit to the GPU queue quick lane':(t?.expressReason||'Express availability is loading');
    express.querySelector('small').textContent=eligible?'quick lane in the GPU queue':`unavailable: ${t?.expressReason||'loading'}`;
  }
  select.onchange=()=>{render();changed(select.value);};
  render();
  return {value:()=>select.value,express:()=>box.checked&&!box.disabled,render};
}
