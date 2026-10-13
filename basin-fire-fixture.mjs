export const BASIN_FIRE_FIXTURE_IDENTITY='kaminos.basin-fire-fixture.v1';

// A consumer handle for the existing authored flame and singleton domain.
// Basin application, source registration, transforms and Undo remain host-owned.
export async function createBasinFireFixture({basins,source,runtime,presentation,record=()=>{}},{presetId,allowedGrids=null,pauseOnCreate=false,enabled=null}) {
  if(!presetId)throw Error('A basin identity is required');
  const previous=basins.read(),wasRegistered=source.read().registered,wasVisible=presentation.read();
  let id=null,registration=null,disposed=false,flow=null,ownedSettings=null,ownedVisibility=null,ownsRegistration=!wasRegistered;
  const setting=state=>state.domControls['volume-flow-rate'];
  const value=state=>Number(setting(state)?.rawValue??setting(state)?.value);
  const live=()=>{if(disposed)throw Error('Fire fixture disposed');};
  const listeners=new Set();
  const changed=()=>{for(const listener of listeners)listener();};
  async function admit(id){
    let expected=id;
    if(basins.inspect){
      const state=await basins.inspect(id),grid=Number(state.domControls['volume-resolution']?.rawValue??state.domControls['volume-resolution']?.value);
      if(allowedGrids&&!allowedGrids.includes(grid))throw Error(`This log experiment uses ${allowedGrids.join(' or ')} cells per axis; this basin uses ${grid}`);
      expected=state.source.presetId;
    }else if(allowedGrids)throw Error('Basin inspection is required for this experiment');
    return expected;
  }
  function sourceStatus(current){
    const available=current.registered&&current.registrationId===registration;
    return {status:disposed?'disposed':available?'mounted':'unavailable',objectId:id,sourceRegistrationId:registration,
      enabled:available?current.emissionEnabled!==false:null};
  }
  const availability=()=>sourceStatus(source.read());
  function read(){
    const state=basins.read(),currentFlow=value(state),current=source.read();
    return {identity:BASIN_FIRE_FIXTURE_IDENTITY,...sourceStatus(current),
      basin:{presetId:state.source?.presetId,label:state.source?.label,modified:basins.modified?.()??null},
      flow:currentFlow,visible:presentation.read(),source:current,
      runtime:runtime.debugState(),simulationOwnership:'existing-singleton-domain'};
  }
  const emit=(kind,requested)=>record({kind:'fire-fixture.'+kind,target:id,phase:'applied',requested,effective:read()});
  function setEnabled(enabled){
    live();if(typeof enabled!=='boolean')throw Error('Source enabled must be boolean');
    if(source.read().registrationId!==registration)throw Error('Fire source registration changed');
    source.setEnabled(enabled);emit('source',{enabled});changed();return read();
  }
  try {
    const expected=await admit(presetId);
    if(pauseOnCreate)runtime.setSimulationPaused(true);await runtime.setActive(true);
    await basins.applyBasin(presetId);ownedSettings=JSON.stringify(basins.read());
    const state=basins.read();flow=value(state);
    if(state.source?.presetId!==expected)throw Error('Applied basin identity does not match the requested basin');
    if(!state.source?.presetId||!Number.isFinite(flow)||flow<0)throw Error('Applied basin has no identified finite source');
    id=source.ensure();if(!id||!source.read().registered)throw Error('Fire source was not registered in the scene');
    registration=source.read().registrationId;
    if(!registration)throw Error('Registered fire source identity is missing');
    presentation.set(true);ownedVisibility=true;if(enabled!==null)setEnabled(enabled);
    return {read,availability,setEnabled,
      refresh(){live();changed();return read();},
      reacquire(){live();const current=source.read();if(current.registered&&current.registrationId===registration)return read();
        const nextId=source.ensure(),next=source.read();if(!nextId||!next.registered||!next.registrationId)throw Error('Fire source could not be registered');
        id=nextId;registration=next.registrationId;ownsRegistration=!current.registered;emit('reacquire',{registrationId:registration});changed();return read();},
      async applyBasin(id){live();const expected=await admit(id);live();const wasEnabled=read().enabled,previous=basins.read();
        await basins.applyBasin(id);ownedSettings=JSON.stringify(basins.read());
        try{const state=basins.read();if(state.source?.presetId!==expected)throw Error('Applied basin identity does not match the requested basin');flow=value(state);if(!Number.isFinite(flow)||flow<0)throw Error('Basin has no finite source flow');if(!wasEnabled)setEnabled(false);emit('basin',{presetId:id});changed();return read();}
        catch(error){if(JSON.stringify(basins.read())===ownedSettings)basins.apply(previous,'Restore failed basin change');throw error;}},
      listBasins:()=>basins.list(),
      async describeBasin(id){live();const state=await basins.inspect(id);live();
        const raw=key=>{const field=state.domControls[key]??state.rendererControls?.[key];return field?.rawValue??field?.value;};
        const grid=Number(raw('volume-resolution'));
        return {presetId:state.source.presetId,label:state.source.label,grid,shape:raw('emitter-assay-family'),flow:Number(raw('volume-flow-rate')),
          raySteps:Number(raw('volume-steps')),renderScale:Number(raw('volume-render-scale')),
          supported:!allowedGrids||allowedGrids.includes(grid),reason:allowedGrids&&!allowedGrids.includes(grid)?`This log experiment uses ${allowedGrids.join(' or ')} cells per axis`:null};},
      subscribe(listener){live();listeners.add(listener);return()=>listeners.delete(listener);},
      select(){live();source.select(id);return read();},
      showLibrary(){live();basins.openLibrary();},
      setVisible(visible){live();if(typeof visible!=='boolean')throw Error('Fire visibility must be boolean');presentation.set(visible);emit('visibility',{visible});changed();return read();},
      dispose(){if(disposed)return;disposed=true;listeners.clear();if(source.read().registrationId===registration){presentation.set(wasVisible);if(ownsRegistration&&id)source.remove(id);}},
    };
  }catch(error){
    if(ownedVisibility!==null&&presentation.read()===ownedVisibility)presentation.set(wasVisible);
    if(!wasRegistered&&id&&registration&&source.read().registrationId===registration)source.remove(id);
    try{if(ownedSettings!==null&&JSON.stringify(basins.read())===ownedSettings)basins.apply(previous,'Restore failed fire fixture');}catch(restore){throw new AggregateError([error,restore],'Fire fixture failed and settings could not be restored');}
    throw error;
  }
}

export function mountBasinFireInspector(fixture,{document,container}) {
  const root=document.createElement('div');root.className='basin-fire-controls';
  root.innerHTML='<p data-basin-label></p><label><input type="checkbox" data-source-enabled> Source enabled</label><label><input type="checkbox" data-visible> Fire visible</label><button type="button" class="btn" data-library>Basin library</button><button type="button" class="btn" data-reacquire hidden>Reconnect fire</button><p role="status"></p>';
  container.prepend(root);
  const on=root.querySelector('[data-source-enabled]'),visible=root.querySelector('[data-visible]'),status=root.querySelector('[role=status]');
  const reconnect=root.querySelector('[data-reacquire]');
  const sync=()=>{const state=fixture.read(),available=state.status==='mounted';root.querySelector('[data-basin-label]').textContent=state.basin.label||state.basin.presetId;on.checked=state.enabled===true;on.disabled=!available;visible.checked=state.visible;visible.disabled=!available;reconnect.hidden=available||state.status==='disposed';if(!available)status.textContent='Fire source removed or replaced';};
  const action=fn=>{try{fn();status.textContent='';sync();}catch(error){status.textContent=error.message;sync();}};
  on.onchange=()=>action(()=>fixture.setEnabled(on.checked));visible.onchange=()=>action(()=>fixture.setVisible(visible.checked));
  root.querySelector('[data-library]').onclick=()=>fixture.showLibrary();
  reconnect.onclick=()=>action(()=>fixture.reacquire());
  const unsubscribe=fixture.subscribe(sync);sync();
  return {sync,dispose(){unsubscribe();root.remove();}};
}

export async function openBasinFireLibrary(fixture,{document}) {
  const dialog=document.createElement('dialog');dialog.className='basin-fire-library';
  dialog.innerHTML='<header><h2>Fire basins</h2><button type="button" class="btn" data-close>Close</button></header><input type="search" placeholder="Find a basin" aria-label="Find a basin"><p role="status">Loading</p><div data-basins></div><footer><p data-selection>No basin selected</p><button type="button" class="btn" data-apply disabled>Use basin</button></footer>';
  document.body.append(dialog);dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
  const status=dialog.querySelector('[role=status]'),list=dialog.querySelector('[data-basins]'),search=dialog.querySelector('input'),apply=dialog.querySelector('[data-apply]'),selection=dialog.querySelector('[data-selection]');
  let selected=null,selectionGeneration=0;
  apply.onclick=async()=>{if(!selected)return;apply.disabled=true;status.textContent='Applying basin';try{await fixture.applyBasin(selected);dialog.close();}catch(error){status.textContent=error.message;apply.disabled=false;}};
  try {
    const index=await fixture.listBasins(),entries=[...(index.entries||[]),...(index.earlierVersions||[])];
    const render=()=>{
      list.replaceChildren();const query=search.value.toLowerCase();
      for(const entry of entries){
        if(!`${entry.label} ${entry.presetId}`.toLowerCase().includes(query))continue;
        const row=document.createElement('button');row.type='button';row.className='basin-fire-library-row';
        row.textContent=entry.label||entry.presetId;row.title=entry.presetId;row.dataset.presetId=entry.presetId;
        row.onclick=async()=>{const generation=++selectionGeneration;selected=null;apply.disabled=true;selection.textContent=entry.label||entry.presetId;status.textContent='Reading basin';
          try{const info=await fixture.describeBasin(entry.presetId);if(generation!==selectionGeneration||!dialog.open)return;
            selection.textContent=`${info.label||entry.label} / Grid ${info.grid} / ${info.shape} / Flow ${info.flow} / ${info.raySteps} ray steps / Render scale ${info.renderScale}`;
            status.textContent=info.supported?'':info.reason;if(info.supported){selected=info.presetId;apply.disabled=false;}}
          catch(error){if(generation===selectionGeneration)status.textContent=error.message;}};
        list.append(row);
      }
    };
    search.oninput=render;render();status.textContent=`${entries.length} basins${index.unavailableEntries?.length?` / ${index.unavailableEntries.length} unavailable`:''}`;
  }catch(error){status.textContent=error.message;}
  return dialog;
}
