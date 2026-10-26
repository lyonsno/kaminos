export const assetKind = name => /\.glb$/i.test(name) ? 'mesh' : /\.(png|jpe?g|webp)$/i.test(name) ? 'image' : null;
export const assetWithheld = entry => entry?.visibility?.status==='withheld';
const requireVisible = entry => {if(assetWithheld(entry))throw Error(entry.visibility.reason || 'Asset awaiting further review.');};
const copy = value => structuredClone(value);
const collections=new Set(['generated-meshes','image-inbox','greenroom','trellis2mlx','pixal3d','agent-work']);
export function assetSource(root, path) {
  return `/api/read?${new URLSearchParams({root, path})}`;
}
export function createAuthoringAssets({request, addMesh, uploadImage, prepareImage, generator, nameForSource=()=>null, changed = () => {}}) {
  let state = {roots:[], root:'generated-meshes', path:'', entries:[], selected:null, preparation:null, loading:false, adding:false, error:null, results:[]};
  let preparationTicket=0,preparationAbort=null,preparationPromise=null;
  let navigation = 0,revision=0;
  const publish = () => changed(copy(state));
  const get = async url => {const value = await request(url); if(value.error)throw Error(value.error);return value;};
  function clearPreparation(){preparationTicket++;preparationAbort?.abort(new DOMException('Image selection changed','AbortError'));preparationAbort=null;preparationPromise=null;state.preparation=null;}
  async function prepare(){
    if(state.selected?.kind!=='image')throw Error('Choose a source image first');
    requireVisible(state.selected);
    if(state.preparation?.status==='complete')return state.preparation.value;
    if(preparationPromise)return preparationPromise;
    if(['input','loading','running','stopping','saving'].includes(generator?.()?.read()?.status))throw Error('Finish or stop the current generation before preparing another image');
    if(!prepareImage)throw Error('Image preparation is unavailable');
    const selected=copy(state.selected),input={...selected,source:selected.source||assetSource(selected.root,selected.path)},ticket=++preparationTicket,abort=new AbortController();preparationAbort=abort;
    state.preparation={status:'preparing',value:null,error:null};state.error=null;publish();
    preparationPromise=(async()=>{
      try{const value=await prepareImage(input,{signal:abort.signal});if(ticket!==preparationTicket||abort.signal.aborted)return null;state.preparation={status:'complete',value,error:null};return value;}
      catch(error){if(ticket!==preparationTicket)return null;if(abort.signal.aborted&&error.name==='AbortError'){state.preparation={status:'stopped',value:null,error:null};return null;}state.preparation={status:'failed',value:null,error:error.message};state.error=error.message;throw error;}
      finally{if(ticket===preparationTicket){preparationAbort=null;preparationPromise=null;publish();}}
    })();return preparationPromise;
  }
  async function browse(root = state.root, path = '') {
    const ticket = ++navigation;
    clearPreparation();state = {...state, root, path:collections.has(root)?'':path, catalog:collections.has(root), selected:null, entries:[],warnings:[],listRevision:++revision,loading:true,error:null};publish();
    try {
      const result = await get(collections.has(root)?`/api/authoring-assets?${new URLSearchParams({collection:root})}`:`/api/browse?${new URLSearchParams({root,path})}`);
      if(ticket !== navigation)return false;
      if(collections.has(root)){
        if(result.schema!=='kaminos.authoring-assets.v1'||result.collection!==root||!Array.isArray(result.entries))throw Error('Asset catalog does not match the requested collection');
        if(result.entries.some(entry=>!['image','mesh'].includes(entry.kind)||typeof entry.source!=='string'||!/^\/api\/(read|job-output)\?/.test(entry.source)))throw Error('Asset catalog contains an invalid asset source');
        state.entries=result.entries.map(entry=>({...entry,label:(assetWithheld(entry)?null:nameForSource(entry.source))||entry.label||entry.name}));state.warnings=result.warnings||[];state.unavailableCount=result.unavailableCount||0;
      }else{
      if(result.type !== 'dir' || result.root !== root || result.path !== path || !Array.isArray(result.entries))throw Error('Asset folder response does not match the requested folder');
      state.entries = result.entries.filter(entry => entry.type === 'dir' || assetKind(entry.name)).map(entry => ({...entry,
        root, path:[path,entry.name].filter(Boolean).join('/'), kind:entry.type==='dir'?'folder':assetKind(entry.name),
        label:nameForSource(assetSource(root,[path,entry.name].filter(Boolean).join('/'))) || entry.metadata?.name || (entry.generation?entry.display?.title:null) || (/^[a-f0-9]{64}\.glb$/i.test(entry.name)?`Saved mesh · ${entry.name.slice(0,8)}`:entry.display?.title || entry.name)}));
      }

      state.listRevision=++revision;
    } catch(error) {if(ticket===navigation){state.entries=[];state.listRevision=++revision;state.error=error.message;}}
    finally {if(ticket===navigation){state.loading=false;publish();}}
    return !state.error;
  }
  return {
    read:()=>copy(state), browse, prepare,
    async refresh() {
      try {
        const roots = await get('/api/roots');
        state.roots = Object.entries(roots).filter(([id,value])=>collections.has(id)&&value.exists).map(([id,value])=>({id,...value}));
        if(state.roots.some(root=>root.id==='greenroom'))state.roots.push({id:'agent-work',exists:true});
        if(!state.roots.some(root=>root.id===state.root))state.root=state.roots[0]?.id || 'generated-meshes';
        return browse(state.root,state.path);
      }catch(error){state.error=error.message;publish();return false;}
    },
    select(entry) {if(!entry || !['mesh','image'].includes(entry.kind))throw Error('Choose a mesh or source image');clearPreparation();state.selected=copy(entry);state.error=null;publish();},
    async add(entry = state.selected) {
      if(state.adding)throw Error('An asset is already being added');
      if(entry?.kind !== 'mesh')throw Error('Choose a GLB mesh to add');
      requireVisible(entry);
      state.adding=true;state.error=null;publish();
      try {return await addMesh({...copy(entry),source:entry.source || assetSource(entry.root,entry.path)});}
      catch(error){state.error=error.message;throw error;}
      finally{state.adding=false;publish();}
    },
    async upload(file) {
      const kind=assetKind(file?.name || '');if(!kind)throw Error('Choose a GLB, PNG, JPEG or WebP');
      if(kind==='mesh')return this.add({kind,name:file.name,label:file.name,file});
      const entry=await uploadImage(file);this.select({...entry,root:entry.root_id,kind:'image',label:entry.name});return entry;
    },
    preparesInput:()=>generator()?.preparesInput===true,
    generation:()=>state.preparation?.status==='preparing'?{status:'preparing',stage:'Preparing image',progress:'Removing background…',percent:null,canStop:true}:generator()?.read() || {status:'unavailable',error:'Generation host is initializing'},
    stop(){if(preparationAbort&&!preparationAbort.signal.aborted){preparationAbort.abort(new DOMException('Image preparation stopped','AbortError'));return true;}return generator()?.stop() || false;},
    async recover() {const result=await generator().retryPersistence();state.results.push({...result,kind:'mesh',label:result.name});publish();return result;},
    async generate() {
      if(state.selected?.kind!=='image')throw Error('Choose a source image first');
    requireVisible(state.selected);
      const service=generator();if(!service)throw Error('Generation host is unavailable');
      // A service that prepares its own input (TRELLIS on this page) runs on the selected original.
      const selected=copy(state.selected);let preparation=null;
      if(service.preparesInput!==true){const operation=prepare(),ticket=preparationTicket;preparation=await operation;if(!preparation||ticket!==preparationTicket)return null;}
      const result=await service.run({...selected,source:selected.source || assetSource(selected.root,selected.path),preparation});
      if(result)state.results.push({...result,kind:'mesh',name:result.name,label:result.name});publish();return result;
    },
  };
}

// A service's used-input preview names the image it was prepared from; the drawer shows it
// only while that image is the selection.
export function usedInputPreviewFor(preview,selectedSource){
  return preview&&typeof preview==='object'&&preview.input&&preview.input===selectedSource&&preview.source?preview.source:null;
}
// The status line for a self-preparing service: what it used for this selection, if known.
export function usedInputStatusFor(preview,selectedSource){
  const own=preview&&typeof preview==='object'&&preview.input===selectedSource?preview:null;
  if(own?.kind==='cutout')return 'This is the cutout generation is using, prepared in this page.';
  if(own?.kind==='original-alpha')return 'This image already has transparency; generation uses it as it is.';
  if(own?.kind==='cutout-unsaved')return `The cutout generation is using could not be saved (${own.error}); the original is shown.`;
  return 'This model prepares the image in this page; the cutout it uses appears here.';
}

export function installAuthoringAssets({document,controller,edits}) {
  const panel=document.createElement('aside');panel.id='authoring-assets';panel.hidden=true;panel.setAttribute('aria-label','Asset browser and generation');
  panel.innerHTML=`<div id="asset-resize" role="separator" aria-label="Asset browser height" aria-orientation="horizontal" tabindex="0"></div><header><strong>Assets</strong><button type="button" id="asset-close" aria-label="Close assets">×</button></header>
    <nav><button type="button" data-assets-mode="browse">Browse</button><button type="button" data-assets-mode="generate">Generate</button></nav>
    <div class="asset-content"><div id="asset-browse"><div class="asset-folder-controls"><button type="button" id="asset-up" aria-label="Parent folder">↑</button><select id="asset-root" aria-label="Asset location"></select><button type="button" id="asset-refresh" aria-label="Refresh assets">↻</button></div><div id="asset-path"></div><input id="asset-filter" type="search" placeholder="Search assets…" aria-label="Search this asset collection"><div id="asset-entries"></div></div>
    <div id="asset-generate" hidden><p>Image → textured mesh · Stable Fast 3D</p><p class="asset-help">Choose an image from Browse or open a local image. Its background is removed before generation; your scene stays in place.</p><div id="asset-preparation-status" role="status"></div><button type="button" id="asset-prepare" hidden>Prepare image</button><button type="button" id="asset-run">Generate mesh</button><button type="button" id="asset-recover" hidden>Retry saving result</button><div id="asset-results"></div></div>
    <div id="asset-detail" hidden><div id="asset-hold-notice" hidden><b aria-hidden="true">×</b><strong>TOP SECRET</strong><p>Hostile to eyesight.<br>Awaiting further review.</p></div><img id="asset-image" alt="Selected source image" hidden><strong id="asset-name"></strong><div id="asset-source"></div></div>
    </div><div id="asset-generation" hidden><div class="asset-generation-line"><span id="asset-generation-status" role="status"></span><span id="asset-percent"></span><button type="button" id="asset-stop">Stop</button></div><progress id="asset-progress" max="100" aria-label="Generation stage progress"></progress></div><div class="asset-browser-status"><span id="asset-loading" class="asset-loading-spinner" aria-hidden="true" hidden></span><div id="asset-status" role="status"></div></div><footer><button type="button" id="asset-file-open">Open file…</button><input id="asset-file" type="file" accept=".glb,.png,.jpg,.jpeg,.webp" hidden><div class="asset-selected-actions"><button type="button" id="asset-add" hidden>Add to scene</button><button type="button" id="asset-use-image" hidden>Use for generation</button></div></footer>`;
  document.body.append(panel);installAssetPaneResize({document,panel});const byId=id=>document.getElementById(id);let mode='browse',listKey=null,rootsKey=null;const expandedAgents=new Set();
  const runHeader=document.createElement('div');runHeader.id='authoring-generation-header';runHeader.hidden=true;runHeader.innerHTML='<button type="button" id="generation-header-show" title="Show generation"><span id="generation-header-status"></span></button><button type="button" id="generation-header-stop">Stop</button>';byId('authoring-header')?.append(runHeader);const runById=id=>runHeader.querySelector('#'+id);
  const previews=new Map();let previewModule;const observer=new document.defaultView.IntersectionObserver(rows=>{for(const row of rows){if(!row.isIntersecting)continue;observer.unobserve(row.target);const entry=previews.get(row.target);if(!entry)continue;row.target.dataset.previewState='loading';(previewModule ||= import('./authoring-asset-previews.mjs')).then(module=>module.meshThumbnail(entry,()=>row.target.isConnected&&!panel.hidden&&mode==='browse'&&document.body.dataset.workspace!=='workbench')).then(source=>{if(!row.target.isConnected)return;if(!source){row.target.dataset.previewState='skipped';armPreviews();return;}const img=document.createElement('img');img.src=source;img.alt=entry.label || entry.name;row.target.prepend(img);row.target.dataset.previewState='rendered';}).catch(()=>{if(row.target.isConnected){row.target.dataset.previewState='unavailable';row.target.title+=' · Mesh preview unavailable';}});}}, {root:panel});
  function armPreviews(){if(panel.hidden||mode!=='browse'||document.body.dataset.workspace==='workbench')return;for(const [button] of previews)if(!['loading','rendered','unavailable'].includes(button.dataset.previewState))observer.observe(button);}
  const labels={'generated-meshes':'Saved meshes',trellis2mlx:'Trellis outputs',pixal3d:'Pixal outputs','image-inbox':'Source images',greenroom:'Generator outputs','agent-work':'Agent work',assets:'Assets',scratch:'Scratch'};
  const action=fn=>Promise.resolve().then(fn).catch(error=>{byId('asset-status').textContent=error.message;});
  function close(){if(panel.contains(document.activeElement))document.activeElement.blur();panel.hidden=true;document.body.classList.remove('has-assets-panel');render(controller.read());}
  function setMode(next){mode=next;byId('asset-browse').hidden=mode!=='browse';byId('asset-generate').hidden=mode!=='generate';panel.querySelectorAll('[data-assets-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.assetsMode===mode)));render(controller.read());}
  function render(state) {
    if(!runHeader.isConnected)byId('authoring-header')?.append(runHeader);
    byId('asset-loading').hidden=!state.loading;panel.setAttribute('aria-busy',String(!!state.loading));
    const roots=byId('asset-root'),nextRoots=state.roots.map(root=>root.id).join('|');if(nextRoots!==rootsKey){roots.replaceChildren(...state.roots.map(root=>{const o=document.createElement('option');o.value=root.id;o.textContent=labels[root.id]||root.id;return o;}));rootsKey=nextRoots;}roots.value=state.root;
    byId('asset-path').textContent=state.catalog?`${state.entries.length} assets${state.root==='agent-work'?' · completed agent jobs':''}`:state.path || 'Top folder';byId('asset-up').hidden=!!state.catalog;byId('asset-up').disabled=!state.path;
    const agentWork=state.root==='agent-work';
    byId('asset-filter').placeholder=agentWork?'Find an agent…':'Search assets…';
    byId('asset-filter').setAttribute('aria-label',agentWork?'Filter agent work by agent name':'Search this asset collection');
    const query=byId('asset-filter').value.toLowerCase(),entries=state.entries.filter(e=>(agentWork?`${e.agent?.id||''} ${e.agent?.label||''}`:`${e.name} ${e.label}`).toLowerCase().includes(query));
    const nextList=JSON.stringify([state.root,state.path,state.listRevision,query]);
    if(nextList!==listKey){listKey=nextList;observer.disconnect();previews.clear();
    const makeButton=(entry,selected=state.selected)=>{
      const button=document.createElement('button');button.type='button';button.className='asset-entry';button.dataset.assetPath=entry.source||entry.path;button.title=entry.path;
      if(assetWithheld(entry)){button.dataset.visibility='withheld';const cover=document.createElement('div');cover.className='asset-hold-cover';const cross=document.createElement('b');cross.textContent='×';cross.setAttribute('aria-hidden','true');const stamp=document.createElement('strong');stamp.textContent='TOP SECRET';const notice=document.createElement('p');notice.textContent=entry.visibility.reason;cover.append(cross,stamp,notice);button.append(cover);}
      else if(entry.kind==='image'){const img=document.createElement('img');img.loading='lazy';img.src=entry.source || assetSource(entry.root,entry.path);img.alt='';button.append(img);}
      const title=document.createElement('span');title.textContent=(entry.kind==='folder'?'▸ ':entry.kind==='mesh'?'◇ ':'')+entry.label;button.append(title);const subtitle=document.createElement('small');subtitle.textContent=entry.kind==='mesh'?'Mesh · GLB':entry.kind==='image'?'Image':'';button.append(subtitle);
      button.setAttribute('aria-pressed',String(!!selected&&(selected.source||selected.path)===(entry.source||entry.path)));
      button.onclick=()=>action(()=>entry.kind==='folder'?controller.browse(entry.root,entry.path):controller.select(entry));
      if(entry.kind==='mesh'&&!assetWithheld(entry))previews.set(button,entry);
      return button;
    };
    const container=byId('asset-entries');container.classList.toggle('asset-agent-groups',agentWork);
    if(agentWork){
      const groups=new Map();
      for(const entry of entries){if(!groups.has(entry.agent.id))groups.set(entry.agent.id,[]);groups.get(entry.agent.id).push(entry);}
      container.replaceChildren(...[...groups].map(([id,items])=>{
        const first=items[0],detail=document.createElement('details');detail.className='asset-agent-group';detail.open=!!query||expandedAgents.has(id);
        const summary=document.createElement('summary');summary.textContent=`${first.agent.label} · ${items.length}`;
        const date=document.createElement('small');date.textContent=new Date((first.producedAt||first.mtime)*1000).toLocaleString();summary.append(date);
        const grid=document.createElement('div');grid.className='asset-agent-entries';detail.append(summary,grid);
        let populated=false;
        const populate=()=>{if(!detail.open||populated)return;populated=true;const selected=controller.read().selected;grid.replaceChildren(...items.map(entry=>{
          const button=makeButton(entry,selected),subtitle=button.querySelector('small');subtitle.textContent+=' · '+(entry.outputClass==='witness'?'Evidence':entry.outputClass==='generated'?'Generated':'Output');return button;
        }));armPreviews();};
        detail.addEventListener('toggle',()=>{if(detail.open)expandedAgents.add(id);else expandedAgents.delete(id);populate();});populate();return detail;
      }));
    }else container.replaceChildren(...entries.map(entry=>makeButton(entry)));
    }
    armPreviews();
    for(const button of byId('asset-entries').querySelectorAll('.asset-entry'))button.setAttribute('aria-pressed',String((state.selected?.source||state.selected?.path)===button.dataset.assetPath));
    byId('asset-status').textContent=state.loading?'Loading assets…':state.error || (state.warnings?.length?`${state.warnings.length} output records could not be read.`:entries.length?'':`No assets in this collection`);
    if(!state.loading&&!state.error&&state.unavailableCount)byId('asset-status').textContent+=(byId('asset-status').textContent?' · ':'')+`${state.unavailableCount} historical output records are unavailable.`;
    const selected=state.selected,withheld=assetWithheld(selected);byId('asset-hold-notice').hidden=!withheld;byId('asset-detail').hidden=!selected;byId('asset-add').hidden=withheld||selected?.kind!=='mesh';byId('asset-use-image').hidden=withheld||selected?.kind!=='image';byId('asset-add').disabled=state.adding;
    if(selected){byId('asset-name').textContent=selected.label || selected.name;byId('asset-name').title=selected.label || selected.name;byId('asset-source').textContent=selected.root?(labels[selected.root]||selected.root):selected.generation?'Generated in this session':'Local file';byId('asset-source').title=selected.source || selected.path || '';}
    const preparation=state.preparation;
    const usedInput=mode==='generate'&&controller.preparesInput?.()&&selected?.kind==='image'?usedInputPreviewFor(controller.generation().inputPreview,selected.source || assetSource(selected.root,selected.path)):null;
    const selfPreparing=mode==='generate'&&controller.preparesInput?.();
    byId('asset-image').hidden=withheld||selected?.kind!=='image';if(withheld||selected?.kind!=='image')byId('asset-image').removeAttribute('src');if(selected?.kind==='image'&&!withheld){const source=usedInput||(mode==='generate'&&!selfPreparing&&preparation?.status==='complete'?preparation.value.prepared.source:selected.source || assetSource(selected.root,selected.path));if(byId('asset-image').getAttribute('src')!==source)byId('asset-image').src=source;byId('asset-image').alt=usedInput?'The input this generation is using (prepared in this page)':mode==='generate'&&preparation?.status==='complete'?'Prepared generation input':'Original source image';}
    // A self-preparing model's own account of its input wins over any server preparation it does not use.
    byId('asset-preparation-status').textContent=(selfPreparing&&selected?.kind==='image')?usedInputStatusFor(controller.generation().inputPreview,selected.source || assetSource(selected.root,selected.path)):preparation?.error||(preparation?.status==='complete'?(preparation.value.route==='input-alpha'?'Existing transparency retained.':'Background removed.')+' This is the image generation will use.':preparation?.status==='preparing'?'Removing background…':preparation?.status==='stopped'?'Image preparation stopped.':selected?.kind==='image'?'Prepare this image to preview the generation input.':'');
    byId('asset-prepare').hidden=withheld||selected?.kind!=='image'||['preparing','complete'].includes(preparation?.status);
    const generation=controller.generation();
    byId('asset-use-image').disabled=byId('asset-prepare').disabled=['input','loading','running','stopping','saving'].includes(generation.status);
    const active=['preparing','input','loading','running','stopping','saving'].includes(generation.status);runHeader.hidden=!active||(document.body.dataset.workspace!=='workbench'&&!panel.hidden);
    runById('generation-header-status').textContent=generation.status==='stopping'?'Stopping…':`${generation.stage||'Generating'}${Number.isFinite(generation.percent)?' · '+Math.round(generation.percent)+'%':''}`;runById('generation-header-show').title=generation.error||generation.progress||'Show generation';
    runById('generation-header-stop').hidden=!generation.canStop&&generation.status!=='stopping';runById('generation-header-stop').disabled=!generation.canStop;
    byId('asset-run').disabled=withheld||selected?.kind!=='image'||(preparation?.status!=='complete'&&!controller.preparesInput?.())||!!generation.pending||['preparing','input','loading','running','stopping','saving','unavailable'].includes(generation.status);byId('asset-recover').hidden=!generation.pending;
    byId('asset-generation').hidden=mode!=='generate'&&!active;
    byId('asset-stop').hidden=!generation.canStop&&generation.status!=='stopping';byId('asset-stop').disabled=!generation.canStop;byId('asset-stop').textContent=generation.status==='stopping'?'Stopping…':'Stop';
    const bar=byId('asset-progress');if(Number.isFinite(generation.percent))bar.value=generation.percent;else bar.removeAttribute('value');
    bar.hidden=!['preparing','input','loading','running','stopping','saving','complete'].includes(generation.status);
    byId('asset-percent').textContent=Number.isFinite(generation.percent)?`${generation.stage || 'Stage'} · ${Math.round(generation.percent)}%`:'';
    byId('asset-generation-status').textContent=generation.error || generation.progress || (selected?.kind==='image'?'Source selected; generate when you want.':'Choose a source image.');
    byId('asset-results').replaceChildren(...state.results.map(result=>{const button=document.createElement('button');button.type='button';button.className='asset-result';button.textContent=`Add ${result.name}`;button.disabled=state.adding;button.onclick=()=>action(()=>controller.add(result));return button;}));
  }
  panel.querySelectorAll('[data-assets-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.assetsMode));
  byId('asset-close').onclick=close;byId('asset-root').onchange=event=>action(()=>controller.browse(event.target.value));byId('asset-up').onclick=()=>action(()=>{const s=controller.read();return controller.browse(s.root,s.path.split('/').slice(0,-1).join('/'));});
  byId('asset-refresh').onclick=()=>action(()=>controller.refresh());byId('asset-filter').oninput=()=>render(controller.read());
  byId('asset-add').onclick=()=>action(async()=>{await controller.add();document.activeElement?.blur();});byId('asset-use-image').onclick=()=>{setMode('generate');if(!controller.preparesInput?.())action(()=>controller.prepare());};byId('asset-prepare').onclick=()=>action(()=>controller.prepare());byId('asset-run').onclick=()=>action(()=>controller.generate());
  byId('asset-stop').onclick=()=>controller.stop();runById('generation-header-stop').onclick=()=>controller.stop();
  runById('generation-header-show').onclick=()=>{if(document.defaultView.kaminosWorkspace?.setMode('authoring')===false)return;panel.hidden=false;document.body.classList.add('has-assets-panel');setMode('generate');};
  document.addEventListener('kaminos-workspace-change',()=>render(controller.read()));
  byId('asset-recover').onclick=()=>action(()=>controller.recover());
  byId('asset-file-open').onclick=()=>byId('asset-file').click();byId('asset-file').onchange=event=>action(async()=>{const file=event.target.files[0];if(file)await controller.upload(file);event.target.value='';});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden&&!edits.state().active){close();event.preventDefault();}});
  return {render,close,open(next='browse'){panel.hidden=false;document.body.classList.add('has-assets-panel');setMode(next);return next==='generate'&&controller.read().selected?.kind==='image'?Promise.resolve(true):action(()=>controller.refresh());},state:()=>({open:!panel.hidden,mode})};
}

export function assetPaneHeight(value,height,narrow=false){return Math.max(160,Math.min(value,Math.max(160,height-42-180-(narrow?180:0))));}
export function installAssetPaneResize({document,panel}){
 const handle=panel.querySelector('#asset-resize'),view=document.defaultView;let preferred=null,drag=null;
 const apply=()=>{if(preferred===null)return;const height=assetPaneHeight(preferred,document.body.clientHeight,view.innerWidth<=800);document.body.style.setProperty('--authoring-assets-height',`${height}px`);handle.setAttribute('aria-valuenow',String(Math.round(height)));};
 const set=value=>{preferred=value;apply();};
 handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();drag={y:event.clientY,height:panel.getBoundingClientRect().height,before:preferred};handle.setPointerCapture(event.pointerId);});
 handle.addEventListener('pointermove',event=>{if(drag)set(drag.height+drag.y-event.clientY);});
 handle.addEventListener('pointerup',event=>{drag=null;if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);});
 handle.addEventListener('pointercancel',()=>{if(drag){preferred=drag.before;drag=null;if(preferred===null)document.body.style.removeProperty('--authoring-assets-height');else apply();}});
 handle.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();set(panel.getBoundingClientRect().height+(event.key==='ArrowUp'?20:-20));}});
 view.addEventListener('resize',apply);
 return {height:()=>panel.getBoundingClientRect().height};
}
