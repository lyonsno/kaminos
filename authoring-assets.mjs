export const assetKind = name => /\.glb$/i.test(name) ? 'mesh' : /\.(png|jpe?g|webp)$/i.test(name) ? 'image' : null;
const copy = value => structuredClone(value);
const collections=new Set(['generated-meshes','image-inbox','greenroom','trellis2mlx','pixal3d']);
export function assetSource(root, path) {
  return `/api/read?${new URLSearchParams({root, path})}`;
}
export function createAuthoringAssets({request, addMesh, uploadImage, generator, nameForSource=()=>null, changed = () => {}}) {
  let state = {roots:[], root:'generated-meshes', path:'', entries:[], selected:null, loading:false, adding:false, error:null, results:[]};
  let navigation = 0,revision=0;
  const publish = () => changed(copy(state));
  const get = async url => {const value = await request(url); if(value.error)throw Error(value.error);return value;};
  async function browse(root = state.root, path = '') {
    const ticket = ++navigation;
    state = {...state, root, path:collections.has(root)?'':path, catalog:collections.has(root), selected:null, entries:[],warnings:[],listRevision:++revision,loading:true,error:null};publish();
    try {
      const result = await get(collections.has(root)?`/api/authoring-assets?${new URLSearchParams({collection:root})}`:`/api/browse?${new URLSearchParams({root,path})}`);
      if(ticket !== navigation)return false;
      if(collections.has(root)){
        if(result.schema!=='kaminos.authoring-assets.v1'||result.collection!==root||!Array.isArray(result.entries))throw Error('Asset catalog does not match the requested collection');
        if(result.entries.some(entry=>!['image','mesh'].includes(entry.kind)||typeof entry.source!=='string'||!/^\/api\/(read|job-output)\?/.test(entry.source)))throw Error('Asset catalog contains an invalid asset source');
        state.entries=result.entries.map(entry=>({...entry,label:nameForSource(entry.source)||entry.label||entry.name}));state.warnings=result.warnings||[];state.unavailableCount=result.unavailableCount||0;
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
    read:()=>copy(state), browse,
    async refresh() {
      try {
        const roots = await get('/api/roots');
        state.roots = Object.entries(roots).filter(([id,value])=>collections.has(id)&&value.exists).map(([id,value])=>({id,...value}));
        if(!state.roots.some(root=>root.id===state.root))state.root=state.roots[0]?.id || 'generated-meshes';
        return browse(state.root,state.path);
      }catch(error){state.error=error.message;publish();return false;}
    },
    select(entry) {if(!entry || !['mesh','image'].includes(entry.kind))throw Error('Choose a mesh or source image');state.selected=copy(entry);state.error=null;publish();},
    async add(entry = state.selected) {
      if(state.adding)throw Error('An asset is already being added');
      if(entry?.kind !== 'mesh')throw Error('Choose a GLB mesh to add');
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
    generation:()=>generator()?.read() || {status:'unavailable',error:'Generation host is initializing'},
    stop:()=>generator()?.stop() || false,
    async recover() {const result=await generator().retryPersistence();state.results.push({...result,kind:'mesh',label:result.name});publish();return result;},
    async generate() {
      if(state.selected?.kind!=='image')throw Error('Choose a source image first');
      const service=generator();if(!service)throw Error('Generation host is unavailable');
      const result=await service.run({...copy(state.selected),source:state.selected.source || assetSource(state.selected.root,state.selected.path)});
      if(result)state.results.push({...result,kind:'mesh',name:result.name,label:result.name});publish();return result;
    },
  };
}

export function installAuthoringAssets({document,controller,edits}) {
  const panel=document.createElement('aside');panel.id='authoring-assets';panel.hidden=true;panel.setAttribute('aria-label','Asset browser and generation');
  panel.innerHTML=`<div id="asset-resize" role="separator" aria-label="Asset browser height" aria-orientation="horizontal" tabindex="0"></div><header><strong>Assets</strong><button type="button" id="asset-close" aria-label="Close assets">×</button></header>
    <nav><button type="button" data-assets-mode="browse">Browse</button><button type="button" data-assets-mode="generate">Generate</button></nav>
    <div class="asset-content"><div id="asset-browse"><div class="asset-folder-controls"><button type="button" id="asset-up" aria-label="Parent folder">↑</button><select id="asset-root" aria-label="Asset location"></select><button type="button" id="asset-refresh" aria-label="Refresh assets">↻</button></div><div id="asset-path"></div><input id="asset-filter" type="search" placeholder="Search assets…" aria-label="Search this asset collection"><div id="asset-entries"></div></div>
    <div id="asset-generate" hidden><p>Image → textured mesh · Stable Fast 3D</p><p class="asset-help">Choose an image from Browse or open a local image. Generation keeps your scene in place; add the result when you want it.</p><button type="button" id="asset-run">Generate mesh</button><button type="button" id="asset-recover" hidden>Retry saving result</button><div id="asset-results"></div></div>
    <div id="asset-detail" hidden><img id="asset-image" alt="Selected source image" hidden><strong id="asset-name"></strong><div id="asset-source"></div><button type="button" id="asset-add">Add to scene</button><button type="button" id="asset-use-image">Use for generation</button></div>
    </div><div id="asset-generation" hidden><div class="asset-generation-line"><span id="asset-generation-status" role="status"></span><span id="asset-percent"></span><button type="button" id="asset-stop">Stop</button></div><progress id="asset-progress" max="100" aria-label="Generation stage progress"></progress></div><div id="asset-status" role="status"></div><footer><button type="button" id="asset-file-open">Open file…</button><input id="asset-file" type="file" accept=".glb,.png,.jpg,.jpeg,.webp" hidden></footer>`;
  document.body.append(panel);installAssetPaneResize({document,panel});const byId=id=>document.getElementById(id);let mode='browse',listKey=null,rootsKey=null;
  const previews=new Map();let previewModule;const observer=new document.defaultView.IntersectionObserver(rows=>{for(const row of rows){if(!row.isIntersecting)continue;observer.unobserve(row.target);const entry=previews.get(row.target);previews.delete(row.target);if(!entry)continue;row.target.dataset.previewState='loading';(previewModule ||= import('./authoring-asset-previews.mjs')).then(module=>module.meshThumbnail(entry,()=>row.target.isConnected&&!panel.hidden&&mode==='browse')).then(source=>{if(!source||!row.target.isConnected)return;const img=document.createElement('img');img.src=source;img.alt=entry.label || entry.name;row.target.prepend(img);row.target.dataset.previewState='rendered';}).catch(()=>{if(row.target.isConnected){row.target.dataset.previewState='unavailable';row.target.title+=' · Mesh preview unavailable';}});}}, {root:panel});
  const labels={'generated-meshes':'Saved meshes',trellis2mlx:'Trellis outputs',pixal3d:'Pixal outputs','image-inbox':'Source images',greenroom:'Generator outputs',assets:'Assets',scratch:'Scratch'};
  const action=fn=>Promise.resolve().then(fn).catch(error=>{byId('asset-status').textContent=error.message;});
  function close(){if(panel.contains(document.activeElement))document.activeElement.blur();panel.hidden=true;document.body.classList.remove('has-assets-panel');}
  function setMode(next){mode=next;byId('asset-browse').hidden=mode!=='browse';byId('asset-generate').hidden=mode!=='generate';panel.querySelectorAll('[data-assets-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.assetsMode===mode)));render(controller.read());}
  function render(state) {
    const roots=byId('asset-root'),nextRoots=state.roots.map(root=>root.id).join('|');if(nextRoots!==rootsKey){roots.replaceChildren(...state.roots.map(root=>{const o=document.createElement('option');o.value=root.id;o.textContent=labels[root.id]||root.id;return o;}));rootsKey=nextRoots;}roots.value=state.root;
    byId('asset-path').textContent=state.catalog?`${state.entries.length} assets`:state.path || 'Top folder';byId('asset-up').hidden=!!state.catalog;byId('asset-up').disabled=!state.path;
    const query=byId('asset-filter').value.toLowerCase(),entries=state.entries.filter(e=>`${e.name} ${e.label}`.toLowerCase().includes(query));
    const nextList=JSON.stringify([state.root,state.path,state.listRevision,query]);
    if(nextList!==listKey){listKey=nextList;observer.disconnect();previews.clear();
    byId('asset-entries').replaceChildren(...entries.map(entry=>{
      const button=document.createElement('button');button.type='button';button.className='asset-entry';button.dataset.assetPath=entry.path;button.title=entry.path;
      if(entry.kind==='image'){const img=document.createElement('img');img.loading='lazy';img.src=entry.source || assetSource(entry.root,entry.path);img.alt='';button.append(img);}
      const title=document.createElement('span');title.textContent=(entry.kind==='folder'?'▸ ':entry.kind==='mesh'?'◇ ':'')+entry.label;button.append(title);const subtitle=document.createElement('small');subtitle.textContent=entry.kind==='mesh'?'Mesh · GLB':entry.kind==='image'?'Image':'';button.append(subtitle);
      button.setAttribute('aria-pressed',String(state.selected?.root===entry.root&&state.selected?.path===entry.path));
      button.onclick=()=>action(()=>entry.kind==='folder'?controller.browse(entry.root,entry.path):controller.select(entry));return button;
    }));
    for(const [index,button] of [...byId('asset-entries').children].entries())if(entries[index].kind==='mesh'){previews.set(button,entries[index]);observer.observe(button);}
    }
    for(const [index,button] of [...byId('asset-entries').children].entries())button.setAttribute('aria-pressed',String(state.selected?.source?state.selected.source===entries[index]?.source:state.selected?.root===entries[index]?.root&&state.selected?.path===entries[index]?.path));
    byId('asset-status').textContent=state.loading?'Loading assets…':state.error || (state.warnings?.length?`${state.warnings.length} output records could not be read.`:entries.length?'':`No assets in this collection`);
    const selected=state.selected;byId('asset-detail').hidden=!selected;byId('asset-add').hidden=selected?.kind!=='mesh';byId('asset-use-image').hidden=selected?.kind!=='image';byId('asset-add').disabled=state.adding;
    if(selected){byId('asset-name').textContent=selected.label || selected.name;byId('asset-source').textContent=selected.root?(labels[selected.root]||selected.root):selected.generation?'Generated in this session':'Local file';byId('asset-source').title=selected.source || selected.path || '';}
    byId('asset-image').hidden=selected?.kind!=='image';if(selected?.kind==='image'){const source=selected.source || assetSource(selected.root,selected.path);if(byId('asset-image').getAttribute('src')!==source)byId('asset-image').src=source;}
    const generation=controller.generation();byId('asset-run').disabled=selected?.kind!=='image'||!!generation.pending||['input','loading','running','stopping','saving','unavailable'].includes(generation.status);byId('asset-recover').hidden=!generation.pending;
    byId('asset-generation').hidden=mode!=='generate'&&!['input','loading','running','stopping','saving'].includes(generation.status);
    byId('asset-stop').hidden=!generation.canStop&&generation.status!=='stopping';byId('asset-stop').disabled=!generation.canStop;byId('asset-stop').textContent=generation.status==='stopping'?'Stopping…':'Stop';
    const bar=byId('asset-progress');if(Number.isFinite(generation.percent))bar.value=generation.percent;else bar.removeAttribute('value');
    bar.hidden=!['input','loading','running','stopping','saving','complete'].includes(generation.status);
    byId('asset-percent').textContent=Number.isFinite(generation.percent)?`${generation.stage || 'Stage'} · ${Math.round(generation.percent)}%`:'';
    byId('asset-generation-status').textContent=generation.error || generation.progress || (selected?.kind==='image'?'Source selected; generate when you want.':'Choose a source image.');
    byId('asset-results').replaceChildren(...state.results.map(result=>{const button=document.createElement('button');button.type='button';button.className='asset-result';button.textContent=`Add ${result.name}`;button.disabled=state.adding;button.onclick=()=>action(()=>controller.add(result));return button;}));
  }
  panel.querySelectorAll('[data-assets-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.assetsMode));
  byId('asset-close').onclick=close;byId('asset-root').onchange=event=>action(()=>controller.browse(event.target.value));byId('asset-up').onclick=()=>action(()=>{const s=controller.read();return controller.browse(s.root,s.path.split('/').slice(0,-1).join('/'));});
  byId('asset-refresh').onclick=()=>action(()=>controller.refresh());byId('asset-filter').oninput=()=>render(controller.read());
  byId('asset-add').onclick=()=>action(async()=>{await controller.add();document.activeElement?.blur();});byId('asset-use-image').onclick=()=>setMode('generate');byId('asset-run').onclick=()=>action(()=>controller.generate());
  byId('asset-stop').onclick=()=>controller.stop();
  byId('asset-recover').onclick=()=>action(()=>controller.recover());
  byId('asset-file-open').onclick=()=>byId('asset-file').click();byId('asset-file').onchange=event=>action(async()=>{const file=event.target.files[0];if(file)await controller.upload(file);event.target.value='';});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden&&!edits.state().active){close();event.preventDefault();}});
  return {render,close,open(next='browse'){panel.hidden=false;document.body.classList.add('has-assets-panel');setMode(next);action(()=>controller.refresh());},state:()=>({open:!panel.hidden,mode})};
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
