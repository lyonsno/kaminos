// One whole-settings operation over the existing runtime and chronological ledger.
// Presets contain authored coefficients, never a checkpoint of the evolving fluid.
export function createFlameAuthoring({ edits, read, write, check, load, canApply = () => {}, changed = () => {} }) {
  const id = '@flame-settings';
  function restore(next) {
    const checked = check(structuredClone(next));
    const previous = read();
    try { write(checked); }
    catch (error) {
      try { write(previous); }
      catch (rollback) { throw new AggregateError([error, rollback], 'Flame settings failed and could not be restored'); }
      throw error;
    }
    changed();
  }
  edits.register(id, { read, write: restore, check });
  function edit(change, label = 'Edit flame settings') {
    canApply();
    if (edits.state().active || edits.state().replaying) throw Error('Finish the current edit before applying a basin');
    edits.begin(id, label);
    try { change(); check(read()); edits.commit(); changed(); }
    catch (error) { edits.cancel(); throw error; }
    return read();
  }
  function apply(next, label = 'Apply flame settings') {
    const checked = check(structuredClone(next));
    return edit(() => restore(checked), label);
  }
  let loading = false;
  return {
    read: () => structuredClone(read()), apply, edit,
    async applyBasin(presetId) {
      if (loading) throw Error('A basin is already loading');
      canApply();
      const before = JSON.stringify(read());
      const history = JSON.stringify(edits.state());
      loading = true;
      try {
        const next = await load(presetId);
        if (JSON.stringify(read()) !== before || JSON.stringify(edits.state()) !== history) {
          throw Error('The scene changed while the basin loaded; apply it again');
        }
        return apply(next, `Apply basin: ${next.source?.label || presetId}`);
      } finally { loading = false; }
    },
  };
}

// UI grouping describes the current singleton flame and its shared domain. It
// does not assign simulator-wide coefficients to independent scene emitters.
export function flameControlDisplayValue(id,value) {return id==='volume-render-scale'?Number(value)*100:value;}
export function flameControlSourceValue(id,value) {return id==='volume-render-scale'?Number(value)/100:value;}
const reflectedRangeBounds=new WeakMap();
export function syncFlameRangeBounds(source,bounds) {
  const requested={min:String(bounds.min),max:String(bounds.max)},previous=reflectedRangeBounds.get(source);
  if(previous && previous.requested.min===requested.min && previous.requested.max===requested.max && source.min===previous.min && source.max===previous.max)return;
  // A browser range input can serialize a derived endpoint with fewer digits.
  // Use that same native representation for the limits: a legal endpoint must
  // not be rejected as out of range after the alias passes it to the source.
  const probe=source.cloneNode();probe.step='any';probe.min=requested.min;probe.max=requested.max;
  probe.value=requested.min;const min=probe.value;
  probe.value=requested.max;const max=probe.value;
  source.min=min;source.max=max;
  reflectedRangeBounds.set(source,{requested,min,max});
}
export const FLAME_PROPERTY_GROUPS = [
  { name:'Quality', open:true, scope:'Grid changes restart the fluid. Raymarch controls tune the viewport.', fields:[
    ['volume-resolution','Grid width (cells)'], ['volume-grid-height-ratio','Height / width'], ['volume-pressure-resolution','Pressure grid (experimental)'], ['volume-pressure-solver-iterations','Solver sweeps'], ['volume-steps','Ray count'],
    ['volume-adaptive-rays','Adaptive rays'], ['volume-render-scale','Screen resolution (%)'],
    ['volume-wavelet-turbulence','Wavelet turbulence'], ['volume-wavelet-octaves','Wavelet octaves'], ['volume-wavelet-strength','Wavelet strength'],
  ] },
  { name:'World smoke', open:true, scope:'One-way, world-anchored field. Changing its dimensions resets only this field; fine pressure stays independent. Material width must be ≥ flow width.', fields:[
    ['volume-world-smoke','World smoke'], ['volume-world-smoke-flow','Flow width'], ['volume-world-smoke-material','Material width'], ['volume-world-smoke-extent','Extent / fine width'],
  ] },
  { name:'Appearance', open:true, scope:'Shared flame and smoke appearance', fields:[
    ['volume-physical-temperature','Temperature'], ['volume-physical-spread','Temperature spread'],
    ['volume-physical-thermal','Thermal response'], ['volume-physical-clean','Clean flame'],
    ['volume-physical-exposure','Exposure'], ['volume-physical-knee','Highlight knee'],
    ['volume-physical-white','White point'], ['volume-physical-smoke-extinction','Smoke extinction'],
    ['volume-physical-smoke-albedo','Smoke albedo'],
  ] },
  { name:'Emission', open:true, scope:'Selected flame source', fields:[
    ['volume-emitter-source-law','Source law'],
    ['volume-immersed-radius','Radius'], ['volume-immersed-speed','Inlet speed'],
    ['volume-immersed-fuel','Fuel'], ['volume-immersed-temperature','Inlet temperature'],
    ['volume-immersed-cap-fraction','Rate cap'], ['volume-immersed-momentum-gain','Momentum coupling'],
    ['volume-immersed-thickness','Source thickness (cells)'], ['volume-immersed-back-wall','Backing wall'],
    ['emitter-assay-family','Shape'], ['volume-flow-rate','Flow'], ['volume-input-radius','Radius'],
    ['volume-emitter-source-depth','Source depth'],
    ['volume-emitter-inlet-profile','Inlet profile'], ['volume-emitter-momentum-linked','Link momentum'],
    ['volume-emitter-inlet-velocity','Inlet velocity'], ['volume-emitter-shear-width','Shear width'],
    ['volume-emitter-edge-entrainment','Edge entrainment'],
  ] },
  { name:'Motion', scope:'Shared flame domain', fields:[
    ['volume-speed','Speed'], ['volume-plume-height','Plume height'],
    ['volume-wind-strength','Wind strength'],
    ['volume-wind-angle','Wind direction'], ['volume-wind-height','Wind height'],
  ] },
  { name:'Simulation', scope:'Shared domain · resolution changes restart the fluid', fields:[
    ['volume-pressure-solver','Pressure solver'],
    ['volume-advection-scheme','Advection'],
    ['volume-confinement','Confinement'], ['volume-time-step','Time stepping'],
    ['volume-common-gas-transport','Common gas transport'],
  ] },
  { name:'Legacy appearance', scope:'For presets using the earlier material model', fields:[
    ['volume-exposure','Exposure'], ['volume-density','Density'], ['volume-fire','Fire'],
    ['volume-radiance','Radiance'], ['volume-absorption','Absorption'], ['volume-glow','Glow'],
    ['volume-smoke','Smoke'], ['volume-fire-scale','Fire scale'], ['volume-detail-scale','Detail scale'],
  ] },
];

export function flameEmissionControlApplies(id, law) {
  if (id === 'volume-emitter-source-law') return true;
  return id.startsWith('volume-immersed-') === (law === 'immersed-source');
}

export function authoredFlameShapeOptions(options) {
  return [...options].filter(option=>option.value!=='cluster');
}

export function createFlameInspector({ document, host, sharedHost = host, listBasins, applyBasin, readSource, readSourceRuntime = () => null, readPressureRuntime = () => null, readWorldRuntime = () => null, readControlBounds = () => null, openWorkbench, onError }) {
  const basin = document.createElement('details'); basin.id='flame-basin-browser'; basin.open=true;
  basin.innerHTML='<summary>Preset</summary><p id="flame-basin-current" class="flame-scope"></p><input id="flame-basin-search" type="search" placeholder="Find a preset…" aria-label="Find a preset"><select id="flame-basin-select" aria-label="Fire preset"></select><div class="flame-basin-actions"><button type="button" class="btn" id="flame-basin-apply">Apply</button><button type="button" class="btn" id="flame-basin-refresh">Refresh</button></div><p id="flame-basin-status" role="status" class="flame-scope">Applying replaces flame settings. Undo restores settings; the fluid keeps evolving.</p>';
  sharedHost.append(basin);
  const byId=id=>document.getElementById(id);
  let entries=[];
  function renderOptions() {
    const select=byId('flame-basin-select'), previous=select.value, query=byId('flame-basin-search').value.toLowerCase();
    select.replaceChildren();
    for(const entry of entries.filter(entry=>`${entry.label} ${entry.presetId}`.toLowerCase().includes(query))) {
      const option=document.createElement('option');option.value=entry.presetId;option.textContent=entry.label;select.append(option);
    }
    if([...select.options].some(option=>option.value===previous))select.value=previous;
    byId('flame-basin-apply').disabled=!select.value;
  }
  const status=message=>byId('flame-basin-status').textContent=message;
  async function refresh() {
    try {const index=await listBasins();entries=index.entries;renderOptions();status(`${entries.length} presets${index.unavailableEntries?.length?` · ${index.unavailableEntries.length} unavailable`:''}`);}
    catch(error){status(error.message);onError(error);}
  }
  byId('flame-basin-search').addEventListener('input',renderOptions);
  byId('flame-basin-refresh').onclick=refresh;
  byId('flame-basin-apply').onclick=async()=>{
    const button=byId('flame-basin-apply');button.disabled=true;status('Loading basin…');
    try {await applyBasin(byId('flame-basin-select').value);status('Applied · Undo restores the previous settings');}
    catch(error){status(error.message);onError(error);}
    finally{button.disabled=!byId('flame-basin-select').value;sync();}
  };
  const aliases=[], emissionRows=[];
  const runtimeStatus=document.createElement('p');runtimeStatus.className='flame-scope';runtimeStatus.id='selected-flame-source-status';runtimeStatus.setAttribute('role','status');
  const pressureStatus=document.createElement('p');pressureStatus.className='flame-scope';pressureStatus.id='selected-pressure-resolution-status';pressureStatus.setAttribute('role','status');
  const worldStatus=document.createElement('p');worldStatus.className='flame-scope';worldStatus.id='selected-world-smoke-status';worldStatus.setAttribute('role','status');
  for(const group of FLAME_PROPERTY_GROUPS) {
    const section=document.createElement('details');section.open=!!group.open;
    const title=document.createElement('summary');title.textContent=group.name;section.append(title);
    const scope=document.createElement('p');scope.className='flame-scope';scope.textContent=group.scope;section.append(scope);
    for(const [id,label] of group.fields) {
      const source=byId(id);if(!source)throw Error(`Missing flame control ${id}`);
      const row=document.createElement('div');row.className='slider-row';
      const grip=document.createElement('label');grip.className='slider-label';grip.textContent=label;
      const field=document.createElement(source.tagName==='SELECT'?'select':'input');
      if(source.tagName==='SELECT')for(const option of id==='emitter-assay-family'?authoredFlameShapeOptions(source.options):source.options)field.append(option.cloneNode(true));
      else {field.type=source.type==='range'?'number':source.type;field.step='any';}
      field.className='transform-input';field.dataset.authoringAlias=id;field.id=`selected-${id}`;grip.htmlFor=field.id;
      if(source.dataset.volumeCommit==='confirm') {
        field.dataset.volumeCommit='confirm';
        const confirm=key=>source.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
        field.addEventListener('change',()=>confirm('Enter'));
        field.addEventListener('blur',()=>confirm('Enter'));
        field.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key==='Escape')confirm(event.key);});
      }
      field.setAttribute('aria-label',`Flame ${label}`);
      field.dataset.authoringDragStep=source.step==='any'?'.01':source.step||'.01';
      if(id==='volume-render-scale')field.title='Raymarch width and height as a percentage of the viewport';
      function syncField(force=false) {
        const bounds=readControlBounds(id);
        if(bounds)syncFlameRangeBounds(source,bounds);
        for(const key of ['min','max']) {
          if(source[key])field[key]=String(flameControlDisplayValue(id,source[key]));
        }
        if(force!==true&&document.activeElement===field)return;
        if(field.type==='checkbox')field.checked=source.checked;else field.value=String(flameControlDisplayValue(id,source.value));
      }
      if(id==='emitter-assay-family')field.title='Placeable flame shapes. Cluster bowl is available in Workbench.';
      const eventName=source.tagName==='SELECT'||source.type==='checkbox'?'change':'input';
      field.addEventListener(eventName,()=>{
        if(id==='emitter-assay-family'&&!authoredFlameShapeOptions(source.options).some(option=>option.value===field.value)){syncField(true);onError(Error('Cluster bowl is not a placeable flame; use Workbench'));return;}
        if(field.type==='number'&&(!field.value.trim()||!field.validity.valid))return;
        if(field.type==='checkbox')source.checked=field.checked;else source.value=String(flameControlSourceValue(id,field.value));
        source.dispatchEvent(new Event(eventName,{bubbles:true}));
      });
      source.addEventListener('input',syncField);source.addEventListener('change',syncField);
      aliases.push(syncField);syncField();row.append(grip,field);section.append(row);
      if(group.name==='Emission')emissionRows.push({id,row});
    }
    if(group.name==='Emission')section.append(runtimeStatus);
    if(group.name==='Quality')section.append(pressureStatus);
    if(group.name==='World smoke')section.append(worldStatus);
    if(group.name==='Quality')sharedHost.insertBefore(section,sharedHost.querySelector('.flame-domain-controls')||basin);
    else (group.name==='Emission'?host:sharedHost).append(section);
  }
  const more=document.createElement('button');more.type='button';more.className='btn';more.textContent='All controls in Workbench';more.onclick=openWorkbench;sharedHost.append(more);
  function sync(force=false) {
    aliases.forEach(sync=>sync(force));
    const world=readWorldRuntime();
    worldStatus.textContent=world?.effective==='one-way-world-field'?`${world.flowDims.join('×')} flow · ${world.materialDims.join('×')} material · world anchored · one-way · ${world.materialLaw}`:world?.reason?`Not running: ${world.reason}`:'World field off or awaiting simulation step';
    const pressure=readPressureRuntime();
    pressureStatus.textContent=!pressure||pressure.requested!==byId('volume-pressure-resolution').value?'Pressure choice awaiting simulation step'
      : pressure.dispatched?`${pressure.pressureDims.join('×')} pressure · ${pressure.materialDims.join('×')} material. Transport and reaction remain fine.`
      : `Original pressure${pressure.reason?` · ${pressure.reason}`:''}`;
    const immersed=byId('volume-emitter-source-law').value==='immersed-source';
    emissionRows.forEach(({id,row})=>row.hidden=!flameEmissionControlApplies(id,byId('volume-emitter-source-law').value));
    runtimeStatus.hidden=!immersed;
    if(immersed) {
      const source=readSourceRuntime();
      runtimeStatus.textContent=!source||source.requested?.sourceLaw!=='immersed-source'?'Source awaiting simulation step'
        : !source.effective.admitted ? `Supply off · ${source.effective.reason}`
        : `Gas supply ${Number(source.effective.fluxEffectivePredicted).toPrecision(3)} cells³/step${source.effective.clipPredicted?.cells?' · rate capped':''}${source.effective.masked?.cells?' · intersects scene geometry':''}`;
    }
    const source=readSource();byId('flame-basin-current').textContent=source?`${source.label || 'Loaded basin'}${source.modified?' · Modified':''}`:'Scene working settings';
  }
  void refresh();sync();
  return {sync,refresh};
}
