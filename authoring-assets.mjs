export const assetKind = name => /\.glb$/i.test(name) ? 'mesh' : /\.(png|jpe?g|webp)$/i.test(name) ? 'image' : null;
const copy = value => structuredClone(value);
export function assetSource(root, path) {
  return `/api/read?${new URLSearchParams({root, path})}`;
}
export function createAuthoringAssets({request, addMesh, uploadImage, generator, nameForSource=()=>null, changed = () => {}}) {
  let state = {roots:[], root:'generated-meshes', path:'', entries:[], selected:null, loading:false, adding:false, error:null, results:[]};
  let navigation = 0;
  const publish = () => changed(copy(state));
  const get = async url => {const value = await request(url); if(value.error)throw Error(value.error);return value;};
  async function browse(root = state.root, path = '') {
    const ticket = ++navigation;
    state = {...state, root, path, selected:null, loading:true, error:null};publish();
    try {
      const result = await get(`/api/browse?${new URLSearchParams({root,path})}`);
      if(ticket !== navigation)return false;
      if(result.type !== 'dir' || result.root !== root || result.path !== path || !Array.isArray(result.entries))throw Error('Asset folder response does not match the requested folder');
      state.entries = result.entries.filter(entry => entry.type === 'dir' || assetKind(entry.name)).map(entry => ({...entry,
        root, path:[path,entry.name].filter(Boolean).join('/'), kind:entry.type==='dir'?'folder':assetKind(entry.name),
        label:nameForSource(assetSource(root,[path,entry.name].filter(Boolean).join('/'))) || entry.metadata?.name || (/^[a-f0-9]{64}\.glb$/i.test(entry.name)?`Saved mesh · ${entry.name.slice(0,8)}`:entry.display?.title || entry.name)}));
    } catch(error) {if(ticket===navigation){state.entries=[];state.error=error.message;}}
    finally {if(ticket===navigation){state.loading=false;publish();}}
    return !state.error;
  }
  return {
    read:()=>copy(state), browse,
    async refresh() {
      try {
        const roots = await get('/api/roots');
        state.roots = Object.entries(roots).filter(([,value])=>value.exists).map(([id,value])=>({id,...value}));
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
    async recover() {const result=await generator().retryPersistence();state.results.push({...result,kind:'mesh',label:result.name});publish();return result;},
    async generate() {
      if(state.selected?.kind!=='image')throw Error('Choose a source image first');
      const service=generator();if(!service)throw Error('Generation host is unavailable');
      const result=await service.run({...copy(state.selected),source:state.selected.source || assetSource(state.selected.root,state.selected.path)});
      state.results.push({...result,kind:'mesh',name:result.name,label:result.name});publish();return result;
    },
  };
}

export function installAuthoringAssets({document,controller,edits}) {
  const panel=document.createElement('aside');panel.id='authoring-assets';panel.hidden=true;panel.setAttribute('aria-label','Asset browser and generation');
  panel.innerHTML=`<header><strong>Assets</strong><button type="button" id="asset-close" aria-label="Close assets">×</button></header>
    <nav><button type="button" data-assets-mode="browse">Browse</button><button type="button" data-assets-mode="generate">Generate</button></nav>
    <div id="asset-browse"><div class="asset-folder-controls"><button type="button" id="asset-up" aria-label="Parent folder">↑</button><select id="asset-root" aria-label="Asset location"></select><button type="button" id="asset-refresh" aria-label="Refresh assets">↻</button></div><div id="asset-path"></div><input id="asset-filter" type="search" placeholder="Filter this folder…" aria-label="Filter this asset folder"><div id="asset-entries"></div></div>
    <div id="asset-generate" hidden><p>Image → textured mesh · Stable Fast 3D</p><p class="asset-help">Choose an image from Browse or open a local image. Generation keeps your scene in place; add the result when you want it.</p><button type="button" id="asset-run">Generate mesh</button><button type="button" id="asset-recover" hidden>Retry saving result</button><div id="asset-generation-status" role="status"></div><div id="asset-results"></div></div>
    <div id="asset-detail" hidden><img id="asset-image" alt="Selected source image" hidden><strong id="asset-name"></strong><div id="asset-source"></div><button type="button" id="asset-add">Add to scene</button><button type="button" id="asset-use-image">Use for generation</button></div>
    <div id="asset-status" role="status"></div><footer><button type="button" id="asset-file-open">Open file…</button><input id="asset-file" type="file" accept=".glb,.png,.jpg,.jpeg,.webp" hidden></footer>`;
  document.body.append(panel);const byId=id=>document.getElementById(id);let mode='browse';
  const labels={'generated-meshes':'Saved meshes',trellis2mlx:'Trellis outputs',pixal3d:'Pixal outputs','image-inbox':'Source images',greenroom:'Generator outputs',assets:'Assets',scratch:'Scratch'};
  const action=fn=>Promise.resolve().then(fn).catch(error=>{byId('asset-status').textContent=error.message;});
  function setMode(next){mode=next;byId('asset-browse').hidden=mode!=='browse';byId('asset-generate').hidden=mode!=='generate';panel.querySelectorAll('[data-assets-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.assetsMode===mode)));render(controller.read());}
  function render(state) {
    const roots=byId('asset-root');roots.replaceChildren(...state.roots.map(root=>{const o=document.createElement('option');o.value=root.id;o.textContent=labels[root.id]||root.id;return o;}));roots.value=state.root;
    byId('asset-path').textContent=state.path || 'Top folder';byId('asset-up').disabled=!state.path;
    const query=byId('asset-filter').value.toLowerCase(),entries=state.entries.filter(e=>`${e.name} ${e.label}`.toLowerCase().includes(query));
    byId('asset-entries').replaceChildren(...entries.map(entry=>{
      const button=document.createElement('button');button.type='button';button.className='asset-entry';button.dataset.assetPath=entry.path;button.title=entry.path;
      if(entry.kind==='image'){const img=document.createElement('img');img.loading='lazy';img.src=assetSource(entry.root,entry.path);img.alt='';button.append(img);}
      const title=document.createElement('span');title.textContent=(entry.kind==='folder'?'▸ ':entry.kind==='mesh'?'◇ ':'')+entry.label;button.append(title);
      button.setAttribute('aria-pressed',String(state.selected?.root===entry.root&&state.selected?.path===entry.path));
      button.onclick=()=>action(()=>entry.kind==='folder'?controller.browse(entry.root,entry.path):controller.select(entry));return button;
    }));
    byId('asset-status').textContent=state.loading?'Loading assets…':state.error || (entries.length?'':`No meshes, images or folders here`);
    const selected=state.selected;byId('asset-detail').hidden=!selected;byId('asset-add').hidden=selected?.kind!=='mesh';byId('asset-use-image').hidden=selected?.kind!=='image';byId('asset-add').disabled=state.adding;
    if(selected){byId('asset-name').textContent=selected.label || selected.name;byId('asset-source').textContent=selected.root?(labels[selected.root]||selected.root):selected.generation?'Generated in this session':'Local file';byId('asset-source').title=selected.source || selected.path || '';}
    byId('asset-image').hidden=selected?.kind!=='image';if(selected?.kind==='image')byId('asset-image').src=selected.source || assetSource(selected.root,selected.path);
    const generation=controller.generation();byId('asset-run').disabled=selected?.kind!=='image'||!!generation.pending||['loading','running','unavailable'].includes(generation.status);byId('asset-recover').hidden=!generation.pending;
    byId('asset-generation-status').textContent=generation.error || generation.progress || (selected?.kind==='image'?'Source selected; generate when you want.':'Choose a source image.');
    byId('asset-results').replaceChildren(...state.results.map(result=>{const button=document.createElement('button');button.type='button';button.className='asset-result';button.textContent=`Add ${result.name}`;button.disabled=state.adding;button.onclick=()=>action(()=>controller.add(result));return button;}));
  }
  panel.querySelectorAll('[data-assets-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.assetsMode));
  byId('asset-close').onclick=()=>panel.hidden=true;byId('asset-root').onchange=event=>action(()=>controller.browse(event.target.value));byId('asset-up').onclick=()=>action(()=>{const s=controller.read();return controller.browse(s.root,s.path.split('/').slice(0,-1).join('/'));});
  byId('asset-refresh').onclick=()=>action(()=>controller.refresh());byId('asset-filter').oninput=()=>render(controller.read());
  byId('asset-add').onclick=()=>action(async()=>{await controller.add();document.activeElement?.blur();});byId('asset-use-image').onclick=()=>setMode('generate');byId('asset-run').onclick=()=>action(()=>controller.generate());
  byId('asset-recover').onclick=()=>action(()=>controller.recover());
  byId('asset-file-open').onclick=()=>byId('asset-file').click();byId('asset-file').onchange=event=>action(async()=>{const file=event.target.files[0];if(file)await controller.upload(file);event.target.value='';});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden&&!edits.state().active){panel.hidden=true;event.preventDefault();}});
  return {render,close(){if(panel.contains(document.activeElement))document.activeElement.blur();panel.hidden=true;},open(next='browse'){panel.hidden=false;setMode(next);action(()=>controller.refresh());},state:()=>({open:!panel.hidden,mode})};
}
