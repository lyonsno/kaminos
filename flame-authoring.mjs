import {PHYSICS_APPEARANCE_UNCOUPLED_CONTROLS} from './volume-physics-appearance.mjs';

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
export function flamePropertyInputType(source) {
  return source.type==='range'?(source.min==='0'&&source.max==='1'&&source.step==='1'?'checkbox':'number'):source.type;
}
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
export const FLAME_INSPECTOR_VIEWS = [
  {id:'look',label:'Look'},{id:'shape',label:'Shape'},{id:'motion',label:'Motion'},{id:'quality',label:'Quality'},
];
export const FLAME_PROPERTY_GROUPS = [
  { name:'Quality', view:'quality', open:true, fields:[
    ['volume-raymarch-mode','Ray marcher'], ['volume-optical-tolerance','Tolerance'], ['volume-ray-step-telemetry','Ray statistics'],
    ['volume-resolution','Grid width (cells)'], ['volume-grid-height-ratio','Height / width'], ['volume-pressure-solver-iterations','Solver sweeps'], ['volume-steps','Ray count'],
    ['volume-adaptive-rays','Adaptive rays'], ['volume-occupancy-skip','Empty-space acceleration'],
    ['volume-ray-start-noise','Blue noise'], ['volume-ray-noise-animated','Animate noise'], ['volume-quadrature-jitter','Interior jitter'],
    ['volume-flame-priority','Flame priority'], ['volume-render-scale','Screen resolution (%)'],
  ] },
  { name:'Appearance', view:'look', open:true, fields:[
    ['volume-tone-mapping','Tone mapping'], ['volume-physical-exposure','Exposure (EV)'],
    ['volume-physical-white','White balance (K)'], ['volume-physical-knee','Highlight knee'],
    ['volume-physical-temperature','Temperature (K)'], ['volume-physical-spread','Temperature spread'],
    ['volume-physical-thermal','Thermal response'], ['volume-physical-clean','Clean flame'],
    ['volume-reaction-boundary-fire-clean-color','Clean color'], ['volume-reaction-boundary-fire-soot-color','Soot color'],
    ['volume-reaction-boundary-fire-luma','Flame brightness'], ['volume-reaction-boundary-fire-clean-blue','Clean blue'],
    ['volume-reaction-boundary-fire-soot','Soot yield'], ['volume-reaction-boundary-fire-yellow','Soot yellowing'],
    ['volume-reaction-boundary-fire-warmth','Thermal warmth'],
  ] },
  { name:'Smoke', view:'look', open:true, fields:[
    ['volume-density','Density'], ['volume-physical-smoke-extinction','Extinction'],
    ['volume-physical-smoke-albedo','Albedo'], ['volume-physical-ambient','Ambient light'],
    ['volume-smoke','Smoke amount'],
  ] },
  { name:'Material', view:'look', fields:[
    ['volume-physical-mode','Color model'], ['volume-physical-material-law','Material law'],
    ['volume-physical-kelvin-per-heat','Kelvin per heat'], ['volume-physical-soot-burnout-rate','Soot burnout rate'],
    ['volume-physical-soot-burnout-kelvin','Burnout temperature (K)'],
    ['volume-reaction-boundary-contrast','Contrast'], ['volume-reaction-boundary-gamma','Gamma'],
    ['volume-reaction-boundary-opacity','Opacity'],
  ] },
  { name:'Front structure', view:'shape', open:true, fields:[
    ['volume-reaction-boundary-fire-ridge','Ridge strength'], ['volume-reaction-boundary-fire-ridge-cut','Ridge threshold'],
    ['volume-reaction-boundary-fire-tip','Tip breakup'], ['volume-reaction-boundary-fire-erosion','Erosion'],
    ['volume-reaction-boundary-gradient','Gradient'], ['volume-reaction-boundary-cut','Cut'],
    ['volume-reaction-boundary-softness','Softness'], ['volume-reaction-boundary-core-reject','Core rejection'],
    ['volume-reaction-boundary-topology','Topology'], ['volume-reaction-boundary-curl','Curl'],
    ['volume-reaction-boundary-divergence','Divergence'],
  ] },
  { name:'Support & reconstruction', view:'shape', fields:[
    ['volume-reaction-boundary-support-thermal','Thermal support'], ['volume-reaction-boundary-support-reaction','Reaction support'],
    ['volume-reaction-boundary-support-front','Front support'], ['volume-reaction-boundary-support-interface','Interface support'],
    ['volume-boundary-sidecar-source','Structure source'], ['volume-boundary-sidecar-width','Step width'],
    ['volume-boundary-sidecar-blur','Blur'], ['volume-boundary-sidecar-ridge','Baked ridge gain'],
  ] },
  { name:'Detail', view:'shape', fields:[
    ['volume-render-detail','Flow detail'], ['volume-render-detail-scale','Flow detail scale (cells)'], ['volume-render-detail-fine','Fine breakup'],
    ['volume-fire','Fire detail'], ['volume-microdetail','Microdetail'], ['volume-interface-shred','Shred'],
    ['volume-fire-licks','Fire licks'], ['volume-fire-scale','Emitter scale'], ['volume-detail-scale','Detail scale'],
  ] },
  { name:'Emission', open:true, fields:[
    ['volume-emitter-source-law','Source law'],
    ['volume-immersed-radius','Radius'], ['volume-immersed-speed','Inlet speed'],
    ['volume-immersed-fuel','Fuel'], ['volume-immersed-temperature','Inlet temperature'],
    ['volume-immersed-cap-fraction','Rate cap'], ['volume-immersed-momentum-gain','Momentum coupling'],
    ['volume-immersed-thickness','Source thickness (cells)'], ['volume-immersed-back-wall','Backing wall'],
    ['emitter-assay-family','Shape'], ['volume-flow-rate','Flow'], ['volume-input-radius','Radius'],
    ['volume-emitter-source-depth','Source depth'],
    ['volume-emitter-inlet-profile','Inlet profile'], ['volume-emitter-momentum-linked','Link momentum'],
    ['volume-emitter-inlet-velocity','Inlet velocity'], ['volume-emitter-shear-width','Shear width'],
    ['volume-emitter-edge-entrainment','Edge entrainment'], ['volume-emitter-fuel-fraction','Fuel fraction'],
    ['volume-emitter-inlet-temperature','Fuel temperature'], ['volume-emitter-aperture-pattern','Aperture'],
    ['volume-emitter-aperture-count','Aperture count'], ['volume-emitter-aperture-seed','Seed'],
    ['volume-emitter-swirl','Swirl'], ['volume-emitter-line-weight','Line weight'],
    ['volume-emitter-jet-jitter','Jet jitter'], ['volume-emitter-inlet-turbulence','Inlet turbulence'],
    ['volume-emitter-inlet-turbulence-scale','Turbulence scale'], ['volume-emitter-puff','Puff strength'],
    ['volume-emitter-puff-period','Puff period'], ['volume-fixed-source-dephase','Source dephasing'],
  ] },
  { name:'Motion', view:'motion', open:true, fields:[
    ['volume-speed','Speed'], ['volume-plume-height','Plume height'],
    ['volume-curl','Vorticity'], ['volume-artistic-swirl','Artistic swirl'], ['volume-phased-sway','Phased sway'],
    ['volume-canonical-spread','Spread'], ['volume-canonical-centerline','Centerline'], ['volume-canonical-body-balance','Body balance'],
  ] },
  { name:'Wind', view:'motion', open:true, fields:[
    ['volume-wind-model','Wind model'], ['volume-wind-strength','Wind strength'],
    ['volume-wind-angle','Wind direction'], ['volume-wind-height','Wind height'],
    ['volume-wind-gust','Gust strength'], ['volume-wind-gust-period','Gust period'], ['volume-wind-gust-veer','Gust veer'],
  ] },
  { name:'Combustion', view:'motion', fields:[
    ['volume-reaction-law','Reaction law'], ['volume-reactant-mixing-time','Mixing time'],
    ['volume-reactant-cooling-time','Cooling time'], ['volume-heat-release-expansion','Heat expansion'],
  ] },
  { name:'Simulation', view:'quality', fields:[
    ['volume-pressure-solver','Pressure solver'], ['volume-projection','Projection'],
    ['volume-advection-scheme','Advection'],
    ['volume-confinement','Confinement'], ['volume-time-step','Time stepping'],
    ['volume-common-gas-transport','Common gas transport'], ['volume-velocity-staggering','Velocity sampling'],
  ] },
  { name:'Inspection', view:'quality', fields:[
    ['volume-reaction-live-view','Field view'], ['volume-boundary-sidecar-view','Structure view'],
    ['volume-grid-overlay','Grid overlay'], ['volume-flow-debug','Flow display'],
  ] },
  { name:'Legacy appearance', view:'look', fields:[
    ['volume-exposure','Legacy exposure'], ['volume-radiance','Radiance'],
    ['volume-absorption','Absorption'], ['volume-glow','Glow'],
  ] },
];

const physicsUnused=new Set(PHYSICS_APPEARANCE_UNCOUPLED_CONTROLS.filter(control=>control.reason==='unused').map(control=>control.id));
export function flamePropertyApplies(id,{toneMapping,materialLaw,physicsActive=false}) {
  if(id==='volume-physical-knee')return toneMapping==='custom';
  if(['volume-physical-kelvin-per-heat','volume-physical-soot-burnout-rate','volume-physical-soot-burnout-kelvin'].includes(id))return Number(materialLaw)===2;
  return !physicsActive||!physicsUnused.has(id);
}
export function flameAppearanceStatus(materialLaw,physics) {
  if(Number(materialLaw)!==2)return {state:'off',text:''};
  if(physics?.requested!==true)return {state:'pending',text:'Physics material: awaiting runtime'};
  if(physics.effective?.render===true)return {state:'active',text:'Physics material active'};
  return {state:'inactive',text:'Physics material inactive: '+String(physics.reason||'unavailable').replace(/^physics-appearance-/,'').replaceAll('-',' ')};
}

export function flameEmissionControlApplies(id, law) {
  if (id === 'volume-emitter-source-law') return true;
  return id.startsWith('volume-immersed-') === (law === 'immersed-source');
}

export function authoredFlameShapeOptions(options) {
  return [...options].filter(option=>option.value!=='cluster');
}

export function createFlameInspector({ document, host, sharedHost = host, listBasins, applyBasin, readSource, readSourceRuntime = () => null, readAppearanceRuntime = () => null, readControlBounds = () => null, writeValue = (source,value) => {source.value=String(value);}, onError }) {
  sharedHost.classList.add('flame-control-inspector');host.classList.add('flame-control-inspector');
  const navigation=document.createElement('div');navigation.className='flame-inspector-navigation';
  const search=document.createElement('input');search.type='search';search.placeholder='Find a flame setting';search.setAttribute('aria-label','Find a flame setting');
  const tabs=document.createElement('div');tabs.className='flame-inspector-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Flame properties');
  navigation.append(search,tabs);sharedHost.insertBefore(navigation,sharedHost.querySelector('.flame-domain-controls'));
  const panels=new Map(),tabButtons=new Map(),sections=[],rows=[];
  let activeView='look',searching=false;
  const empty=document.createElement('p');empty.className='flame-inspector-empty';empty.textContent='No matching settings';empty.hidden=true;
  for(const view of FLAME_INSPECTOR_VIEWS){
    const button=document.createElement('button');button.type='button';button.id=`flame-view-${view.id}`;button.textContent=view.label;
    button.setAttribute('role','tab');button.setAttribute('aria-controls',`flame-properties-${view.id}`);
    button.addEventListener('click',()=>{activeView=view.id;syncVisibility();});
    button.addEventListener('keydown',event=>{
      const index=FLAME_INSPECTOR_VIEWS.indexOf(view),length=FLAME_INSPECTOR_VIEWS.length;
      const next=event.key==='ArrowRight'?(index+1)%length:event.key==='ArrowLeft'?(index+length-1)%length:event.key==='Home'?0:event.key==='End'?length-1:null;
      if(next===null)return;event.preventDefault();activeView=FLAME_INSPECTOR_VIEWS[next].id;syncVisibility();tabButtons.get(activeView).focus();
    });
    tabs.append(button);tabButtons.set(view.id,button);
    const panel=document.createElement('div');panel.id=`flame-properties-${view.id}`;panel.className='flame-inspector-view';
    panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);sharedHost.append(panel);panels.set(view.id,panel);
  }
  sharedHost.append(empty);
  const basin = document.createElement('details'); basin.id='flame-basin-browser';basin.className='flame-inspector-section';
  basin.innerHTML='<summary>Preset</summary><p id="flame-basin-current" class="flame-scope"></p><input id="flame-basin-search" type="search" placeholder="Find a preset…" aria-label="Find a preset"><select id="flame-basin-select" aria-label="Fire preset"></select><div class="flame-basin-actions"><button type="button" class="btn" id="flame-basin-apply">Apply</button><button type="button" class="btn" id="flame-basin-refresh">Refresh</button></div><p id="flame-basin-status" role="status" class="flame-scope">Applying replaces flame settings. Undo restores settings; the fluid keeps evolving.</p>';
  panels.get('look').append(basin);
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
  const aliases=[];
  const runtimeStatus=document.createElement('p');runtimeStatus.className='flame-scope';runtimeStatus.id='selected-flame-source-status';runtimeStatus.setAttribute('role','status');
  const appearanceStatus=document.createElement('output');appearanceStatus.id='flame-material-status';appearanceStatus.className='flame-material-status';appearanceStatus.setAttribute('role','status');
  for(const group of FLAME_PROPERTY_GROUPS) {
    const section=document.createElement('details');section.open=!!group.open;section.className='flame-inspector-section';section.dataset.flameGroup=group.name;
    const title=document.createElement('summary');title.textContent=group.name;section.append(title);
    const sectionRows=[];
    for(const [id,label] of group.fields) {
      const source=byId(id);if(!source)throw Error(`Missing flame control ${id}`);
      const row=document.createElement('div');row.className='slider-row flame-property-row';row.dataset.flameControl=id;
      const grip=document.createElement('label');grip.className='slider-label';grip.textContent=label;
      const field=document.createElement(source.tagName==='SELECT'?'select':'input');
      if(source.tagName==='SELECT')for(const option of id==='emitter-assay-family'?authoredFlameShapeOptions(source.options):source.options)field.append(option.cloneNode(true));
      else {field.type=flamePropertyInputType(source);field.step='any';}
      field.className='transform-input';field.dataset.authoringAlias=id;field.id=`selected-${id}`;grip.htmlFor=field.id;
      if(source.dataset.volumeCommit==='confirm') {
        field.dataset.volumeCommit='confirm';
        const confirm=key=>source.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
        field.addEventListener('change',()=>confirm('Enter'));
        field.addEventListener('blur',()=>confirm('Enter'));
        field.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key==='Escape')confirm(event.key);});
      }
      field.setAttribute('aria-label',`Flame ${label}`);
      field.dataset.authoringDragStep=source.dataset.authoringDragStep||(source.step==='any'?'.01':source.step||'.01');
      if(id==='volume-render-scale')field.title='Raymarch width and height as a percentage of the viewport';
      function syncField(force=false) {
        const bounds=readControlBounds(id);
        if(bounds)syncFlameRangeBounds(source,bounds);
        for(const key of ['min','max']) {
          if(source[key])field[key]=String(flameControlDisplayValue(id,source[key]));
        }
        field.disabled=source.disabled;
        if(force!==true&&document.activeElement===field)return;
        if(field.type==='checkbox')field.checked=source.type==='checkbox'?source.checked:Number(source.value)>=.5;else field.value=String(flameControlDisplayValue(id,source.value));
      }
      if(id==='emitter-assay-family')field.title='Placeable flame shapes. Cluster bowl is available in Workbench.';
      const eventName=source.tagName==='SELECT'||field.type==='checkbox'?'change':'input';
      field.addEventListener(eventName,()=>{
        if(id==='emitter-assay-family'&&!authoredFlameShapeOptions(source.options).some(option=>option.value===field.value)){syncField(true);onError(Error('Cluster bowl is not a placeable flame; use Workbench'));return;}
        if(field.type==='number'&&(!field.value.trim()||!field.validity.valid))return;
        if(field.type==='checkbox'){if(source.type==='checkbox')source.checked=field.checked;else source.value=field.checked?'1':'0';}
        else writeValue(source,flameControlSourceValue(id,field.value));
        source.dispatchEvent(new Event(eventName,{bubbles:true}));
      });
      source.addEventListener('input',syncField);source.addEventListener('change',()=>{syncField();syncVisibility();});
      aliases.push(syncField);syncField();row.append(grip,field);section.append(row);
      const record={id,row,source,emission:group.name==='Emission',searchText:`${group.name} ${label} ${id}`.toLowerCase()};
      rows.push(record);sectionRows.push(record);
      grip.title=source.closest('.slider-row')?.querySelector('[title]')?.title||label;
    }
    if(group.name==='Emission')section.append(runtimeStatus);
    if(group.name==='Material')section.append(appearanceStatus);
    if(group.name==='Quality')section.append(byId('volume-raymarch-status'),byId('volume-ray-step-stats'));
    (group.name==='Emission'?host:panels.get(group.view)).append(section);
    sections.push({section,group,rows:sectionRows,open:!!group.open});
  }
  panels.get('look').append(basin);
  const geometry=[...sharedHost.querySelectorAll(':scope > .flame-domain-controls,:scope > .flame-collision-controls')];
  for(const panel of geometry)panels.get('quality').append(panel);
  const mode=()=>({toneMapping:byId('volume-tone-mapping').value,materialLaw:byId('volume-physical-material-law').value,
    physicsActive:readAppearanceRuntime()?.effective?.render===true});
  function syncVisibility(){
    const query=search.value.trim().toLowerCase(),isSearching=!!query,currentMode=mode();
    const status=flameAppearanceStatus(currentMode.materialLaw,readAppearanceRuntime());
    appearanceStatus.hidden=status.state==='off';appearanceStatus.dataset.state=status.state;appearanceStatus.textContent=status.text;
    const law=byId('volume-emitter-source-law').value;
    if(isSearching&&!searching)for(const item of sections)item.open=item.section.open;
    for(const item of rows){
      const retired=item.source.closest('[data-volume-ui-retired],[data-volume-retired-control-state]');
      item.row.hidden=!!retired||!flamePropertyApplies(item.id,currentMode)||(item.emission&&!flameEmissionControlApplies(item.id,law))
        ||(!item.emission&&isSearching&&!query.split(/\s+/).every(term=>item.searchText.includes(term)));
    }
    for(const item of sections){
      item.section.hidden=!item.rows.some(item=>!item.row.hidden);
      if(item.group.name!=='Emission'){
        if(isSearching)item.section.open=true;
        else if(searching)item.section.open=item.open;
      }
    }
    for(const [id,panel] of panels){
      panel.hidden=isSearching?!sections.some(item=>item.group.view===id&&!item.section.hidden):id!==activeView;
      const button=tabButtons.get(id);button.setAttribute('aria-selected',String(id===activeView));button.tabIndex=id===activeView?0:-1;
    }
    tabs.hidden=isSearching;basin.hidden=isSearching;
    geometry.forEach(panel=>panel.hidden=isSearching);
    empty.hidden=!isSearching||rows.some(item=>!item.emission&&!item.row.hidden);
    searching=isSearching;
  }
  search.addEventListener('input',syncVisibility);
  search.addEventListener('keydown',event=>{if(event.key==='Escape'){search.value='';syncVisibility();}});
  function sync(force=false) {
    aliases.forEach(sync=>sync(force));
    const immersed=byId('volume-emitter-source-law').value==='immersed-source';
    syncVisibility();
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
