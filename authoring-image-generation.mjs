// Page controls and legacy frame handoff. The operation is also imported directly by the worker host.
export * from "./authoring-image-operation.mjs";

// The volume prototype has one foreground requester. SF3D installs its own when it loads;
// klein borrows the kiln for its run and hands it back, so whichever model is running
// interleaves its duties with kiln frames.
export function createForegroundHandoff({prototype,host,waitFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())),settleMs=10000}){
  const requesters=new Map();let current=null;
  async function set(requester){
    const started=Date.now();
    for(;;){
      try{prototype.setForegroundOpportunityRequester(requester);return;}
      catch(error){
        // A kiln frame in flight refuses the swap; it settles within a frame or two.
        if(!/still pending/.test(error?.message)||Date.now()-started>settleMs)throw error;
        await waitFrame();
      }
    }
  }
  return {
    owner:()=>current,
    // A view of the prototype for a producer that installs its requester itself (SF3D).
    recording(owner){
      return new Proxy(prototype,{get(target,key){
        if(key==='setForegroundOpportunityRequester')return requester=>{target.setForegroundOpportunityRequester(requester);requesters.set(owner,requester);current=owner;};
        const value=target[key];return typeof value==='function'?value.bind(target):value;
      }});
    },
    install(owner,requester){requesters.set(owner,requester);},
    has:owner=>requesters.has(owner),
    async activate(owner){
      if(!requesters.has(owner))throw Error(`no foreground requester for ${owner}`);
      if(current===owner)return;
      await set(requesters.get(owner));current=owner;host.setForegroundServiceActive(true);
    },
    // Back to the kiln's private animation loop, as before any model loaded, so a producer
    // that installs its own requester (SF3D) does not meet another model's pending frame.
    async release(){
      if(current===null)return;
      await set(null);current=null;host.setForegroundServiceActive(false);
    },
  };
}

// A mesh run takes the kiln's foreground requester only once its own admission would
// pass, so a refused request cannot strand a running image without kiln frames.
export async function runWithKilnHandoff({service,input,handoff,owner,blocked=()=>null}){
  // The cross-model check comes first: a model's own read() reports refusals only
  // while idle, and a finished, failed or stopped state would otherwise pass here.
  const refusal=blocked();if(refusal)throw Error(refusal);
  const state=service.read();
  if(state.status==='unavailable')throw Error(state.error||'Generation is unavailable');
  if(['input','loading','queued','running','stopping','saving'].includes(state.status))throw Error('Generation is already running');
  if(state.pending)throw Error('Save the retained generated output before another run');
  if(!input?.source)throw Error('Choose a source image');
  if(handoff?.has(owner))await handoff.activate(owner);else await handoff?.release();
  return service.run(input);
}

export function imageGenerationTimeLabel(timing,status){
  if(!timing)return '';
  const seconds=ms=>`${(Math.max(0,ms)/1000).toFixed(1)} s`;
  const load=timing.loadMs>=1000?` · model load ${seconds(timing.loadMs)}`:'';
  if(timing.generationMs===null&&timing.queuedMs!==null&&timing.queuedMs!==undefined){
    const label=status==='stopped'?'Stopped before generation · queue wait':status==='failed'?'Generation not started · queue wait':'Waiting for shared GPU ·';
    return `${label} ${seconds(timing.queuedMs)}${load}`;
  }
  if(timing.generationMs===null)return `Loading model · ${seconds(timing.loadMs)}`;
  const label=['running','stopping'].includes(status)?'Generating':status==='stopped'?'Stopped after':status==='failed'?'Generation elapsed':'Generated in';
  return `${label} ${seconds(timing.generationMs)}${timing.loadMs>=1000?` · model load ${seconds(timing.loadMs)}`:''}`;
}

export function installKleinCallerOutputs({document,root,controller,assets}){
  const host=document.createElement('section');host.className='asset-caller-outputs';host.hidden=true;
  const heading=document.createElement('strong');heading.textContent='Generated outputs';host.append(heading);root.append(host);
  const rows=new Map();
  function render(){
    const outputs=controller.read().outputs||[];host.hidden=outputs.length===0;
    for(const output of outputs){
      let row=rows.get(output.id);
      if(!row){
        const node=document.createElement('div');node.className='asset-caller-output';
        const title=document.createElement('div'),canvas=document.createElement('canvas'),status=document.createElement('div');
        canvas.setAttribute('aria-label','Generated image');status.setAttribute('role','status');
        const retry=document.createElement('button'),view=document.createElement('button');
        retry.type=view.type='button';retry.textContent='Retry saving';view.textContent='View image';
        node.append(title,canvas,status,retry,view);host.append(node);
        row={node,title,canvas,status,retry,view,painted:null};rows.set(output.id,row);
      }
      row.title.textContent=output.prompt;
      row.status.textContent=output.error||({generating:'Generating',saving:'Saving',complete:'Saved',stopped:'Stopped',failed:'Failed'}[output.status]||output.status);
      row.retry.hidden=!output.pending||output.status==='saving';
      row.retry.onclick=()=>controller.retryOutput(output.id).catch(()=>{});
      row.view.disabled=!output.entry?.source;
      row.view.onclick=()=>{if(output.entry?.source)assets.select({...output.entry,kind:'image',provenance:output.provenance});};
      const preview=output.preview;row.canvas.hidden=!preview;
      const key=preview?`${preview.runId}:${preview.kind}:${preview.step??'final'}`:null;
      if(preview&&row.painted!==key){
        row.canvas.width=preview.width;row.canvas.height=preview.height;
        const ctx=row.canvas.getContext('2d'),pixels=ctx.createImageData(preview.width,preview.height);
        pixels.data.set(preview.rgba);ctx.putImageData(pixels,0,0);row.painted=key;
      }
    }
  }
  return{render};
}

export function installKleinImageGeneration({document,controller,assets,meshBusy:meshBusyOption=null,promptExpansion=null,promptProvenance=()=>null,reference=()=>assets.read({selectionOnly:true}).selected}){
  const container=document.getElementById('asset-generate');if(!container)throw Error('Generate panel is missing');
  const section=document.createElement('section');section.id='asset-text-image';
  section.innerHTML=`<p>Text → image · Klein</p><label>Model <select id="asset-image-model" aria-label="Image model"><option value="flux2">FLUX.2 Klein 4B</option><option value="flux3">FLUX.3 Image Klein (local)</option></select></label><textarea id="asset-prompt" rows="2" spellcheck="true" placeholder="One object, e.g. a weathered bronze lantern" aria-label="Image prompt"></textarea>
    <label id="asset-reference-control" hidden><input type="checkbox" id="asset-use-reference"> Use reference image <span id="asset-reference-name"></span></label>
    <div class="asset-text-image-actions"><button type="button" id="asset-text-run">Generate image</button><label>Size <select id="asset-image-size" aria-label="Image size"><option value="256">256 (fastest)</option><option value="384">384</option><option value="512" selected>512</option><option value="768">768 (slower)</option><option value="1024">1024 (slowest)</option></select></label><label>Shape <select id="asset-image-aspect" aria-label="Image shape"><option value="square" selected>Square</option><option value="landscape">Landscape 16:9</option><option value="portrait">Portrait 9:16</option></select></label><label>Weights <select id="asset-image-level" aria-label="Transformer weights"><option value="4-bit" selected>4-bit (full)</option><option value="3-bit">3-bit</option><option value="2-bit">2-bit (jankiest)</option></select></label><label>Seed <input id="asset-seed" type="number" min="0" step="1" aria-label="Seed"></label><button type="button" id="asset-reseed" title="New seed" aria-label="New seed">⟳</button><button type="button" id="asset-text-decode" hidden>Decode now</button><button type="button" id="asset-text-stop" hidden>Stop</button><button type="button" id="asset-text-retry" hidden>Retry saving image</button></div>
    <div id="asset-image-timing" hidden></div><div id="asset-text-status" role="status"></div><progress id="asset-text-progress" max="100" aria-label="Image generation progress" hidden></progress>`;
  container.prepend(section);
  const callerOutputs=installKleinCallerOutputs({document,root:section,controller,assets});
  // Looked up in the document: the Generate layout may move these controls out of this section.
  const byId=id=>document.getElementById(id),seedInput=byId('asset-seed');
  const reseed=()=>{seedInput.value=String(Math.floor(Math.random()*1e9));};reseed();
  const meshBusy=meshBusyOption||(()=>['preparing','input','loading','running','stopping','saving'].includes(assets.generation()?.status));
  let timer=null,timingStatus='idle';
  function renderTime(){
    const node=byId('asset-image-timing'),value=controller.timing();
    node.textContent=imageGenerationTimeLabel(value,timingStatus);node.hidden=!value;
    if(controller.busy()&&timer===null)timer=setTimeout(()=>{timer=null;renderTime();},200);
    else if(!controller.busy()&&timer!==null){clearTimeout(timer);timer=null;}
  }
  function render(){
    callerOutputs.render();
    const state=controller.read(),active=['loading','queued','running','stopping','saving'].includes(state.status)||!!promptExpansion?.busy();
    timingStatus=state.status;renderTime();
    byId('asset-image-model').disabled=active||!!state.pending;
    const selected=reference(),referenceControl=byId('asset-use-reference');
    byId('asset-reference-control').hidden=false;referenceControl.disabled=active||!!state.pending;
    byId('asset-reference-name').textContent=referenceControl.checked?`· ${selected?.kind==='image'?(selected.label||selected.name):'Choose an image in Browse or Open file'}`:'';
    byId('asset-text-run').disabled=active||state.status==='unavailable'||meshBusy()||!!state.pending;
    byId('asset-text-retry').hidden=!state.pending||active;
    byId('asset-text-stop').hidden=!state.canStop&&state.status!=='stopping';byId('asset-text-stop').disabled=!state.canStop;
    byId('asset-text-decode').hidden=!state.canDecode;
    byId('asset-text-stop').textContent=state.status==='stopping'?'Stopping…':'Stop';
    byId('asset-text-status').textContent=state.error||(state.status==='idle'?'':`${state.progress}${Number.isFinite(state.percent)&&state.status!=='complete'?` · ${Math.round(state.percent)}%`:''}`);
    const bar=byId('asset-text-progress');bar.hidden=!active;if(Number.isFinite(state.percent))bar.value=state.percent;else bar.removeAttribute('value');
  }
  byId('asset-reseed').onclick=reseed;
  byId('asset-image-model').onchange=()=>{
    const flux3=byId('asset-image-model').value==='flux3',levels=byId('asset-image-level');
    for(const option of levels.options)option.disabled=flux3&&option.value!=='4-bit';
    if(flux3)levels.value='4-bit';
    render();
  };
  byId('asset-use-reference').onchange=render;
  byId('asset-text-decode').onclick=()=>controller.decodeNow();
  byId('asset-text-stop').onclick=()=>controller.stop();
  byId('asset-text-retry').onclick=()=>controller.retryPersistence().catch(error=>{byId('asset-text-status').textContent=error.message;});
  const run=()=>{
    const seed=Math.max(0,Math.floor(Number(seedInput.value)||0));
    const useReference=byId('asset-use-reference').checked;
    const selected=reference();
    if(useReference&&selected?.kind!=='image'){byId('asset-text-status').textContent='Choose a source image in Browse or Open file first.';return;}
    controller.run({promptExpansion:promptProvenance(),reference:useReference?selected:null,model:byId('asset-image-model').value,prompt:byId('asset-prompt').value,seed,size:Number(byId('asset-image-size').value),level:byId('asset-image-level').value,aspect:byId('asset-image-aspect').value}).then(entry=>{if(entry)reseed();}).catch(error=>{byId('asset-text-status').textContent=error.message;});
  };
  byId('asset-text-run').onclick=run;
  byId('asset-prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();if(!byId('asset-text-run').disabled)run();}});
  return {render};
}
