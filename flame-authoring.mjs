import {PHYSICS_APPEARANCE_UNCOUPLED_CONTROLS} from './volume-physics-appearance.mjs';
import {volumeControlTooltip} from './volume-control-descriptions.mjs';
import {describeVolumeSettingsSaveOutcome} from './volume-settings-preset-contract.mjs';

// Standalone presets do not contain the emitter pose. Store its effective
// aperture, not a raw slider value whose meaning depends on that missing pose.
export function portableFlamePreset(preset, localScale) {
  const result=structuredClone(preset);
  if(result.domControls?.['volume-emitter-source-law']?.value!=='immersed-source')return result;
  if(localScale<0||!Number.isFinite(localScale))throw Error('Invalid emitter scale for preset aperture');
  const d=result.domControls['volume-immersed-radius'];
  const radius=Number(d.rawValue??d.value)*localScale;
  if(!Number.isFinite(radius)||radius<0)throw Error('Effective preset aperture must be finite and nonnegative');
  if(Object.hasOwn(d,'rawValue'))d.rawValue=String(radius);
  if(Object.hasOwn(d,'value'))d.value=radius;
  const route=new URL(result.route);route.searchParams.set('volume_immersed_radius',String(radius));
  result.route=route.toString();result.sourceRadiusSpace='simulation-v1';return result;
}
export function flamePresetRadius(preset,localScale) {
  const d=preset.domControls['volume-immersed-radius'];const radius=Number(d.rawValue??d.value);
  if(preset.sourceRadiusSpace===undefined)return radius;
  if(preset.sourceRadiusSpace!=='simulation-v1')throw Error('Unknown preset source radius space');
  if(localScale<0||!Number.isFinite(localScale))throw Error('Invalid destination emitter scale');
  // A collapsed source has no invertible aperture space. Keep the coefficient
  // editable while its zero pose continues to suppress injection.
  return localScale===0?radius:radius/localScale;
}
// Compare a portable receipt with local controls without changing its saved
// identity. Scene snapshots retain their own raw radius plus authored pose.
export function flamePresetForLocalControls(preset,localScale) {
  if(!preset.sourceRadiusSpace || preset.domControls?.['volume-emitter-source-law']?.value!=='immersed-source')return preset;
  const result=structuredClone(preset),radius=flamePresetRadius(preset,localScale);
  const d=result.domControls['volume-immersed-radius'];
  if(Object.hasOwn(d,'value'))d.value=radius;
  if(Object.hasOwn(d,'rawValue'))d.rawValue=String(radius);
  delete result.sourceRadiusSpace;
  return result;
}

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
    async applyBasin(presetId, options = {}) {
      if (loading) throw Error('A basin is already loading');
      canApply();
      const before = JSON.stringify(read());
      const history = JSON.stringify(edits.state());
      loading = true;
      try {
        const next = await load(presetId, options);
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
  if(bounds.max===null) {
    const value=source.value;
    syncFlameRangeBounds(source,{min:bounds.min,max:Math.max(Number(source.max)||0,Number(value)||0,bounds.min)});
    source.value=value;
    return;
  }
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
  {id:'look',label:'Material'},{id:'motion',label:'Flow'},{id:'quality',label:'Quality'},
];
export const FLAME_PROPERTY_GROUPS = [
  { name:'Ray marching', view:'quality', open:true, fields:[
    ['volume-raymarch-mode','Ray marcher'], ['volume-optical-tolerance','Tolerance'], ['volume-ray-step-telemetry','Ray statistics'],
    ['volume-steps','Ray count'],
    ['volume-adaptive-rays','Adaptive rays'], ['volume-occupancy-skip','Empty-space acceleration'],
    ['volume-ray-start-noise','Blue noise'], ['volume-ray-noise-animated','Animate noise'], ['volume-quadrature-jitter','Interior jitter'],
    ['volume-flame-priority','Flame priority'], ['volume-render-scale','Screen resolution (%)'],
  ] },
  // Group by the material or mechanism being authored, not by implementation layer.
  { name:'Emission & image', view:'look', open:true, fields:[
    ['volume-physical-thermal','Glow gain'], ['volume-physical-clean','Clean reaction emission'],
    ['volume-tone-mapping','Tone mapping'], ['volume-physical-exposure','Exposure (EV)'],
    ['volume-physical-white','White balance (K)'], ['volume-physical-knee','Highlight knee'],
    ['volume-physical-ambient','Ambient fill'],
    ] },
  { name:'Combustion', view:'look', open:true, fields:[
    ['volume-reactant-mixing-time','Reaction time'], ['volume-heat-release-expansion','Combustion expansion'],
    ['volume-physical-kelvin-per-heat','Kelvin per heat'], ['volume-reactant-cooling-time','Cooling time'],
    ['volume-reaction-law','Reaction law'],
  ] },
  { name:'Soot', view:'look', open:true, fields:[
    ['volume-reactant-soot-yield','Yield per fuel burned'],
    ['volume-physical-soot-burnout-rate','Burnout rate'], ['volume-physical-soot-burnout-kelvin','Burnout temperature (K)'],
    ['volume-density','Display gain'], ['volume-physical-smoke-extinction','Extinction'],
    ['volume-physical-smoke-albedo','Scattering albedo'],
  ] },
  { name:'Subgrid turbulence', view:'motion', fields:[
    ['volume-wavelet-turbulence','Wavelet turbulence'], ['volume-wavelet-octaves','Octaves'],
    ['volume-wavelet-strength','Detail strength'],
  ] },
  { name:'Carriers & added forces', view:'motion', fields:[
    ['volume-microdetail','Microdetail'], ['volume-interface-shred','Shred'],
    ['volume-fire-licks','Fire licks'], ['volume-swirl-jostle','Swirl jostle'], ['volume-fine-breakup-localization','Swirl jostle focus'], ['volume-fire-scale','Carrier contour scale'],
  ] },
  { name:'Emitter & feed', scope:'emitter', open:true, fields:[
    ['volume-emitter-source-law','Source law'],
    ['volume-immersed-radius','Radius'], ['volume-immersed-speed','Inlet speed'],
    ['volume-immersed-fuel','Fuel concentration'], ['volume-immersed-temperature','Inlet heat'],
    ['volume-immersed-cap-fraction','Rate cap'], ['volume-immersed-momentum-gain','Momentum coupling'],
    ['volume-immersed-thickness','Source thickness (cells)'], ['volume-immersed-back-wall','Backing wall'],
    ['emitter-assay-family','Shape'], ['volume-flow-rate','Flow'], ['volume-input-radius','Radius'],
    ['volume-emitter-source-depth','Source depth'],
    ['volume-emitter-inlet-profile','Inlet profile'], ['volume-emitter-momentum-linked','Link momentum'],
    ['volume-emitter-inlet-velocity','Inlet velocity'], ['volume-emitter-shear-width','Shear width'],
    ['volume-emitter-edge-entrainment','Edge entrainment'], ['volume-emitter-fuel-fraction','Fuel fraction'],
    ['volume-emitter-inlet-temperature','Inlet heat'], ['volume-emitter-aperture-pattern','Aperture'],
    ['volume-emitter-aperture-count','Aperture count'], ['volume-emitter-aperture-seed','Seed'],
    ['volume-emitter-swirl','Swirl'], ['volume-emitter-line-weight','Line weight'],
    ['volume-emitter-jet-jitter','Jet jitter'], ['volume-emitter-inlet-turbulence','Inlet turbulence'],
    ['volume-emitter-inlet-turbulence-scale','Turbulence scale'], ['volume-emitter-puff','Puff strength'],
    ['volume-emitter-puff-period','Puff correlation time'], ['volume-fixed-source-dephase','Source dephasing'],
  ] },
  { name:'Flow response', view:'motion', open:true, fields:[
    ['volume-plume-height','Plume rise shaping'], ['volume-confinement','Confinement'],
    ['volume-curl','Curl gain'], ['volume-artistic-swirl','Artistic swirl'], ['volume-phased-sway','Lateral excitation'],
  ] },
  { name:'Wind', view:'motion', open:true, fields:[
    ['volume-wind-model','Wind model'], ['volume-wind-strength','Wind strength'],
    ['volume-wind-angle','Wind direction'], ['volume-wind-height','Wind height'],
    ['volume-wind-gust','Gust strength'], ['volume-wind-gust-period','Gust period'], ['volume-wind-gust-veer','Gust veer'],
  ] },
  { name:'Domain & simulation', view:'quality', open:true, fields:[
    ['volume-resolution','Grid width (cells)'], ['volume-grid-height-ratio','Height / width'],
    ['volume-speed','Simulation speed'], ['volume-time-step','Time stepping'],
    ['volume-pressure-solver-iterations','Solver sweeps'],
    ['volume-pressure-solver','Pressure solver'], ['volume-projection','Projection'],
    ['volume-advection-scheme','Advection'],
    ['volume-common-gas-transport','Common gas transport'], ['volume-velocity-staggering','Velocity sampling'],
  ] },
  { name:'Diagnostics', view:'quality', fields:[
    ['volume-reaction-live-view','Field view'], ['volume-boundary-sidecar-view','Structure view'],
    ['volume-grid-overlay','Grid overlay'], ['volume-flow-debug','Flow display'],
  ] },
  { name:'Support diagnostics', view:'quality', fields:[
    ['volume-boundary-sidecar-source','Structure source'], ['volume-boundary-sidecar-width','Step width'],
    ['volume-boundary-sidecar-blur','Blur'], ['volume-boundary-sidecar-ridge','Baked ridge gain'],
  ] },
];

const physicsUnused=new Set(PHYSICS_APPEARANCE_UNCOUPLED_CONTROLS.filter(control=>control.reason==='unused').map(control=>control.id));
// Physics (soot x blackbody) is the material law (2026-10-18; the law select
// is retired), so its calibration controls always apply.
export function flamePropertyApplies(id,{toneMapping,physicsActive=false,sceneLighting=false,supportActive=false}) {
  if(['volume-boundary-sidecar-source','volume-boundary-sidecar-width','volume-boundary-sidecar-blur','volume-boundary-sidecar-ridge'].includes(id))return supportActive;
  if(id==='volume-physical-ambient'&&sceneLighting)return false;
  if(id==='volume-physical-knee')return toneMapping==='custom';
  if(['volume-physical-kelvin-per-heat','volume-physical-soot-burnout-rate','volume-physical-soot-burnout-kelvin'].includes(id))return true;
  return !physicsActive||!physicsUnused.has(id);
}
export function flameAppearanceStatus(physics) {
  if(physics?.requested!==true)return {state:'pending',text:'Physics material: awaiting runtime'};
  if(physics.effective?.render===true)return {state:'active',text:'Physics material active'};
  return {state:'inactive',text:'Physics material inactive: '+String(physics.reason||'unavailable').replace(/^physics-appearance-/,'').replaceAll('-',' ')};
}

export function flameEmissionControlApplies(id, law) {
  if (id === 'volume-emitter-source-law') return true;
  if (['volume-emitter-inlet-turbulence','volume-emitter-inlet-turbulence-scale',
    'volume-emitter-puff','volume-emitter-puff-period','volume-emitter-aperture-pattern',
    'volume-emitter-aperture-count','volume-emitter-aperture-seed','volume-emitter-line-weight',
    'volume-emitter-jet-jitter'].includes(id)) return law==='immersed-source'||law==='inflow-boundary';
  return id.startsWith('volume-immersed-') === (law === 'immersed-source');
}

export function authoredFlameShapeOptions(options) {
  return [...options].filter(option=>option.value!=='cluster');
}

export function createFlameInspector({ document, host, sharedHost = host, listBasins, applyBasin, saveBasin, readSource, readSourceRuntime = () => null, readAppearanceRuntime = () => null, readSceneLighting = () => false, readControlBounds = () => null, readSourceControl = () => null, writeSourceControl = () => false, writeValue = (source,value) => {source.value=String(value);}, onError }) {
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
  basin.open=false;
  basin.innerHTML='<summary>Basins</summary><p id="flame-basin-current" class="flame-scope"></p><label for="flame-basin-label">Basin name</label><input id="flame-basin-label" type="text" placeholder="New basin name" autocomplete="off"><button type="button" class="btn" id="flame-basin-save">Save basin</button><input id="flame-basin-search" type="search" placeholder="Find a basin" aria-label="Find a basin"><select id="flame-basin-select" aria-label="Fire basin"></select><div class="flame-basin-actions"><button type="button" class="btn" id="flame-basin-apply">Apply</button><button type="button" class="btn" id="flame-basin-refresh">Refresh</button></div><p id="flame-basin-status" role="status" class="flame-scope"></p>';
  sharedHost.insertBefore(basin,navigation);
  const byId=id=>document.getElementById(id);
  let entries=[];
  function renderOptions() {
    const select=byId('flame-basin-select'), previous=select.value, query=byId('flame-basin-search').value.toLowerCase();
    select.replaceChildren();
    for(const entry of entries.filter(entry=>`${entry.label} ${entry.presetId}`.toLowerCase().includes(query))) {
      const option=document.createElement('option');option.value=entry.presetId;option.textContent=entry.reason?`${entry.label} | ${entry.reason==='held-label'?'held':'earlier'} | ${entry.presetId.slice(0,16)}`:entry.label;select.append(option);
    }
    if([...select.options].some(option=>option.value===previous))select.value=previous;
    byId('flame-basin-apply').disabled=!select.value;
  }
  const status=message=>byId('flame-basin-status').textContent=message;
  async function refresh() {
    try {const index=await listBasins();entries=[...index.entries,...(index.earlierVersions||[])];renderOptions();status(`${entries.length} presets${index.unavailableEntries?.length?` · ${index.unavailableEntries.length} unavailable`:''}`);}
    catch(error){status(error.message);onError(error);}
  }
  byId('flame-basin-search').addEventListener('input',renderOptions);
  byId('flame-basin-refresh').onclick=refresh;
  byId('flame-basin-save').onclick=async()=>{
    const button=byId('flame-basin-save'),label=byId('flame-basin-label').value.trim();
    if(button.disabled)return;
    if(!label){status('Enter a basin name');byId('flame-basin-label').focus();return;}
    button.disabled=true;status('Saving basin...');
    try {
      const result=await saveBasin({label});
      await refresh();
      byId('flame-basin-search').value='';renderOptions();
      byId('flame-basin-select').value=result.effective.presetId;renderOptions();
      const outcome=describeVolumeSettingsSaveOutcome(result);
      status(`Saved ${result.effective.label}${outcome.text?` | ${outcome.text}`:''}`);
    } catch(error){status(error.message);onError(error);}
    finally{button.disabled=false;sync();}
  };
  byId('flame-basin-label').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void byId('flame-basin-save').onclick();}});
  byId('flame-basin-apply').onclick=async()=>{
    const button=byId('flame-basin-apply');button.disabled=true;status('Loading basin…');
    try {const applied=await applyBasin(byId('flame-basin-select').value);status(`Applied${applied?.source?.sourceSizeRecovery==='clamped-to-valid-range'?' · emitter radius clamped to valid range':''} · Undo restores the previous settings`);}
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
      function syncField(force=false) {
        const bounds=readControlBounds(id);
        if(bounds&&!readSourceControl(id))syncFlameRangeBounds(source,bounds);
        for(const key of ['min','max']) {
          const bound=bounds&&Object.hasOwn(bounds,key)?bounds[key]:source[key];
          field[key]=bound===null||bound===undefined||bound===''?'':String(flameControlDisplayValue(id,bound));
        }
        field.disabled=source.disabled;
        if(force!==true&&document.activeElement===field)return;
        const descriptor=readSourceControl(id),value=descriptor?(descriptor.rawValue??descriptor.value):source.type==='checkbox'?source.checked:source.value;
        if(field.type==='checkbox')field.checked=typeof value==='boolean'?value:Number(value)>=.5;else field.value=String(flameControlDisplayValue(id,value));
      }
      const eventName=source.tagName==='SELECT'||field.type==='checkbox'?'change':'input';
      field.addEventListener(eventName,()=>{
        if(id==='emitter-assay-family'&&!authoredFlameShapeOptions(source.options).some(option=>option.value===field.value)){syncField(true);onError(Error('Cluster bowl is not a placeable flame; use Workbench'));return;}
        if(id==='volume-immersed-radius'&&field.value.trim()&&Number(field.value)<0)field.value='0';
        if(field.type==='number'&&(!field.value.trim()||!field.validity.valid))return;
        const value=field.type==='checkbox'?(source.type==='checkbox'?field.checked:field.checked?1:0):source.tagName==='SELECT'?field.value:Number(flameControlSourceValue(id,field.value));
        try{if(writeSourceControl(id,value)){syncVisibility();return;}}catch(error){syncField(true);onError(error);return;}
        if(field.type==='checkbox'){if(source.type==='checkbox')source.checked=field.checked;else source.value=field.checked?'1':'0';}
        else writeValue(source,flameControlSourceValue(id,field.value));
        source.dispatchEvent(new Event(eventName,{bubbles:true}));
      });
      source.addEventListener('input',syncField);source.addEventListener('change',()=>{syncField();syncVisibility();});
      aliases.push(syncField);syncField();row.append(grip,field);section.append(row);
      const record={id,row,source,emission:group.scope==='emitter',searchText:`${group.name} ${label} ${id}`.toLowerCase()};
      rows.push(record);sectionRows.push(record);
      grip.title=volumeControlTooltip(id)||label;field.title=grip.title;
    }
    if(group.scope==='emitter')section.append(runtimeStatus);
    if(group.name==='Combustion')section.append(appearanceStatus);
    if(group.name==='Ray marching')section.append(byId('volume-raymarch-status'),byId('volume-ray-step-stats'));
    (group.scope==='emitter'?host:panels.get(group.view)).append(section);
    sections.push({section,group,rows:sectionRows,open:!!group.open});
  }
  const geometry=[...sharedHost.querySelectorAll(':scope > .flame-domain-controls,:scope > .flame-collision-controls')];
  for(const panel of geometry)panels.get('quality').append(panel);
  const mode=()=>({toneMapping:byId('volume-tone-mapping').value,
    physicsActive:readAppearanceRuntime()?.effective?.render===true,sceneLighting:readSceneLighting(),
    supportActive:byId('volume-reaction-law').value==='authored-tall-plume'||byId('volume-boundary-sidecar-view').value!=='off'
      ||!['off','boundary_fire'].includes(byId('volume-reaction-live-view').value)
      ||(byId('volume-raymarch-mode').value==='numerical'&&Number(byId('volume-flame-priority').value)>0)});
  function syncVisibility(){
    const query=search.value.trim().toLowerCase(),isSearching=!!query,currentMode=mode();
    const status=flameAppearanceStatus(readAppearanceRuntime());
    appearanceStatus.hidden=status.state==='off';appearanceStatus.dataset.state=status.state;appearanceStatus.textContent=status.text;
    const law=readSourceControl('volume-emitter-source-law')?.value??byId('volume-emitter-source-law').value;
    if(isSearching&&!searching)for(const item of sections)item.open=item.section.open;
    for(const item of rows){
      const retired=item.source.closest('[data-volume-ui-retired],[data-volume-retired-control-state]');
      item.row.hidden=!!retired||!flamePropertyApplies(item.id,currentMode)||(item.emission&&!flameEmissionControlApplies(item.id,law))
        ||(!item.emission&&isSearching&&!query.split(/\s+/).every(term=>item.searchText.includes(term)));
    }
    for(const item of sections){
      item.section.hidden=!item.rows.some(item=>!item.row.hidden);
      if(item.group.scope!=='emitter'){
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
    const immersed=(readSourceControl('volume-emitter-source-law')?.value??byId('volume-emitter-source-law').value)==='immersed-source';
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
