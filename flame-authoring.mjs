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
export const FLAME_PROPERTY_GROUPS = [
  { name:'Appearance', open:true, scope:'Flame and smoke', fields:[
    ['volume-physical-temperature','Temperature'], ['volume-physical-spread','Temperature spread'],
    ['volume-physical-thermal','Thermal response'], ['volume-physical-clean','Clean flame'],
    ['volume-physical-exposure','Exposure'], ['volume-physical-knee','Highlight knee'],
    ['volume-physical-white','White point'], ['volume-physical-smoke-extinction','Smoke extinction'],
    ['volume-physical-smoke-albedo','Smoke albedo'],
  ] },
  { name:'Emission', scope:'Selected flame source', fields:[
    ['emitter-assay-family','Shape'], ['volume-flow-rate','Flow'], ['volume-input-radius','Radius'],
    ['volume-emitter-source-law','Source law'], ['volume-emitter-source-depth','Source depth'],
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
    ['volume-resolution','Resolution'], ['volume-pressure-solver','Pressure solver'],
    ['volume-pressure-solver-iterations','Iterations'], ['volume-advection-scheme','Advection'],
    ['volume-confinement','Confinement'], ['volume-time-step','Time stepping'],
    ['volume-common-gas-transport','Common gas transport'],
  ] },
  { name:'Legacy appearance', scope:'For basins using the earlier material model', fields:[
    ['volume-exposure','Exposure'], ['volume-density','Density'], ['volume-fire','Fire'],
    ['volume-radiance','Radiance'], ['volume-absorption','Absorption'], ['volume-glow','Glow'],
    ['volume-smoke','Smoke'], ['volume-fire-scale','Fire scale'], ['volume-detail-scale','Detail scale'],
  ] },
];

export function authoredFlameShapeOptions(options) {
  return [...options].filter(option=>option.value!=='cluster');
}

export function createFlameInspector({ document, host, listBasins, applyBasin, readSource, openWorkbench, onError }) {
  const basin = document.createElement('details'); basin.id='flame-basin-browser'; basin.open=true;
  basin.innerHTML='<summary>Basin</summary><p id="flame-basin-current" class="flame-scope"></p><input id="flame-basin-search" type="search" placeholder="Find a basin…" aria-label="Find a basin"><select id="flame-basin-select" aria-label="Flame basin"></select><div class="flame-basin-actions"><button type="button" class="btn" id="flame-basin-apply">Apply</button><button type="button" class="btn" id="flame-basin-refresh">Refresh</button></div><p id="flame-basin-status" role="status" class="flame-scope">Applying replaces flame settings. Undo restores settings; the fluid keeps evolving.</p>';
  host.append(basin);
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
    try {const index=await listBasins();entries=index.entries;renderOptions();status(`${entries.length} basins${index.unavailableEntries?.length?` · ${index.unavailableEntries.length} unavailable`:''}`);}
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
  const aliases=[];
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
      field.setAttribute('aria-label',`Flame ${label}`);
      field.dataset.authoringDragStep=source.step==='any'?'.01':source.step||'.01';
      function syncField(force=false) {
        if(force!==true&&document.activeElement===field)return;
        for(const key of ['min','max'])if(source[key])field[key]=source[key];
        if(field.type==='checkbox')field.checked=source.checked;else field.value=source.value;
      }
      if(id==='emitter-assay-family')field.title='Placeable flame shapes. Cluster bowl is available in Workbench.';
      const eventName=source.tagName==='SELECT'||source.type==='checkbox'?'change':'input';
      field.addEventListener(eventName,()=>{
        if(id==='emitter-assay-family'&&!authoredFlameShapeOptions(source.options).some(option=>option.value===field.value)){syncField(true);onError(Error('Cluster bowl is not a placeable flame; use Workbench'));return;}
        if(field.type==='number'&&(!field.value.trim()||!field.validity.valid))return;
        if(field.type==='checkbox')source.checked=field.checked;else source.value=field.value;
        source.dispatchEvent(new Event(eventName,{bubbles:true}));
      });
      source.addEventListener('input',syncField);source.addEventListener('change',syncField);
      aliases.push(syncField);syncField();row.append(grip,field);section.append(row);
    }
    host.append(section);
  }
  const more=document.createElement('button');more.type='button';more.className='btn';more.textContent='All controls in Workbench';more.onclick=openWorkbench;host.append(more);
  function sync(force=false) {
    aliases.forEach(sync=>sync(force));
    const source=readSource();byId('flame-basin-current').textContent=source?`${source.label || 'Loaded basin'}${source.modified?' · Modified':''}`:'Scene working settings';
  }
  void refresh();sync();
  return {sync,refresh};
}
