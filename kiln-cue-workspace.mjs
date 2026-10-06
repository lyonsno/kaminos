import {createFlameTunePanel} from './flame-tune-panel.mjs';
import {installRelativeNumberDrag} from './scene-control-history.mjs';

export function installKilnCueWorkspace({host,preview,openCinema,onError}) {
  const document=window.document,api=host.cinematic,workspace=api.workspace(),editor=api.tuneEditor();
  const panel=document.createElement('div');panel.id='authoring-cue-properties';
  panel.innerHTML=`<h2>Kiln cues</h2><nav class="cue-phase-switch" aria-label="Cue phase"><button type="button" data-cue-phase="ignition">Ignition</button><button type="button" data-cue-phase="work">Work</button></nav>
    <div class="cue-key-heading"><span>Keyframes</span><div><button type="button" id="cue-add" title="Add a keyframe">+</button><button type="button" id="cue-duplicate" title="Duplicate selected keyframe">Duplicate</button><button type="button" id="cue-remove" title="Remove selected keyframe">Remove</button></div></div>
    <div id="cue-key-list" role="listbox" aria-label="Keyframes"></div>
    <div class="slider-row"><label class="slider-label" for="cue-key-time">Seconds</label><input class="transform-input" type="number" step="any" min="0" id="cue-key-time"></div>
    <div id="cue-tune-source" class="flame-scope"></div>
    <div class="cue-tune-actions"><button type="button" id="cue-accept">Accept tune</button><button type="button" id="cue-cancel">Cancel</button><button type="button" id="cue-audition">Audition key</button></div>
    <details id="cue-basin-browser"><summary>Basin</summary><input type="search" placeholder="Find a basin" aria-label="Find cue basin" id="cue-basin-search"><select aria-label="Cue basin" id="cue-basin-select"></select><button type="button" id="cue-basin-apply">Use basin</button></details>
    <div id="cue-flame-fields"></div><details id="cue-sequence-settings"><summary>Sequence</summary><div id="cue-sequence-fields"></div></details>
    <div class="cue-document-actions"><button type="button" id="cue-preview">Preview</button><button type="button" id="cue-save">Save scene</button><button type="button" id="cue-cinema">Cinema</button></div><p id="cue-status" role="status" class="flame-scope"></p>`;
  const style=document.createElement('style');style.textContent=`
    .cue-phase-switch,.cue-tune-actions,.cue-document-actions {display:flex;gap:6px;flex-wrap:wrap;margin:10px 0;}
    .cue-phase-switch button {flex:1;}
    .cue-phase-switch button[aria-pressed="true"],#cue-key-list button[aria-selected="true"] {background:#343e39;color:#eef3ef;border-color:#708579;}
    .cue-key-heading {display:flex;align-items:center;justify-content:space-between;gap:6px;margin:12px 0 6px;font-size:12px;color:#abb4ae;}
    .cue-key-heading>div {display:flex;gap:4px;}
    #cue-key-list {display:flex;flex-direction:column;border-top:1px solid #353b38;margin-bottom:12px;}
    #cue-key-list button {display:flex;justify-content:space-between;border-radius:0;border-width:0 0 1px;text-align:left;min-height:32px;font:12px monospace;}
    #cue-basin-browser input,#cue-basin-browser select {box-sizing:border-box;width:100%;margin:6px 0;background:#252927;color:#ddd;border:1px solid #454d48;padding:6px;}
    #cue-flame-fields details,#cue-sequence-settings,#cue-basin-browser {border-top:1px solid #353b38;padding:10px 0;}
    #cue-flame-fields summary,#cue-sequence-settings summary,#cue-basin-browser summary {font-size:12px;color:#c7d0ca;cursor:pointer;margin-bottom:8px;}
    #authoring-cue-properties button {font-size:11px;white-space:normal;}
    #authoring-cue-properties .slider-row {min-width:0;}
    #authoring-cue-properties .transform-input {min-width:0;}
    #cue-status {overflow-wrap:anywhere;}
    body[data-properties-context=cues]:not(.kiln-cinema) #kiln-film {display:none;}
    @media(max-width:800px) {
      body[data-workspace=authoring][data-properties-context=cues] {grid-template-columns:minmax(0,1fr);grid-template-rows:42px minmax(200px,32vh) minmax(0,1fr);}
      body[data-properties-context=cues] #authoring-inspector {grid-column:1;grid-row:3;}
      body[data-properties-context=cues] #authoring-hierarchy,body[data-properties-context=cues] .authoring-splitter {display:none;}
      body[data-properties-context=cues] #viewport {grid-column:1;grid-row:2;}
      body[data-properties-context=cues] #info-bar,body[data-properties-context=cues] #scene-edit-hud,
      body[data-properties-context=cues] #navigation-hint,body[data-properties-context=cues] #fps-counter {display:none;}
    }
  `;document.head.append(style);
  const byId=id=>panel.querySelector(`#${id}`);
  panel.querySelectorAll('button').forEach(button=>button.classList.add('btn'));
  let phase='ignition',index=0,basins=[];
  const status=message=>byId('cue-status').textContent=message;
  const failure=error=>{status(error.message);onError(error);};
  const guard=action=>()=>Promise.resolve().then(action).catch(failure);
  const recipe=()=>api.read(),key=()=>recipe()[phase][index];
  const currentTune=()=>editor.state()?.tune || key()?.tune;
  const ensure=()=>{if(!editor.active())editor.begin(phase,index);};
  function accept() {if(editor.active())editor.accept();}
  const tunePanel=createFlameTunePanel({document,host:byId('cue-flame-fields'),read:currentTune,
    set:(id,value)=>{ensure();editor.set(id,value);syncState();},onError:failure});
  function syncState() {
    const draft=editor.state();
    byId('cue-cancel').disabled=!draft;byId('cue-accept').disabled=!draft;
    byId('cue-tune-source').textContent=(draft?.tune || key()?.tune)?.source?.label || 'Scene flame tune';
  }
  function render() {
    const cues=recipe();index=Math.min(index,cues[phase].length-1);
    const list=byId('cue-key-list');list.replaceChildren();
    cues[phase].forEach((value,i)=>{
      const row=document.createElement('button');row.type='button';row.className='btn';row.setAttribute('role','option');row.setAttribute('aria-selected',String(i===index));
      const time=document.createElement('span');time.textContent=`${Number(value.time.toFixed(3))} s`;
      const look=document.createElement('span');look.textContent=`r ${Number(value.radius.toFixed(3))} · ${Number(value.flow.toFixed(3))}`;
      row.append(time,look);row.onclick=guard(()=>{accept();index=i;editor.begin(phase,index);render();status('Tuning keyframe');});list.append(row);
    });
    panel.querySelectorAll('[data-cue-phase]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.cuePhase===phase)));
    const time=byId('cue-key-time');time.value=cues[phase][index].time;time.disabled=index===0;
    byId('cue-remove').disabled=cues[phase].length<=2 || index===0;
    tunePanel.sync();syncState();
    for(const field of panel.querySelectorAll('[data-cue-setting]'))field.value=cues[field.dataset.cueSetting];
  }
  function changeRecipe(change) {accept();const cues=recipe();change(cues);api.write(cues);render();}
  for(const button of panel.querySelectorAll('[data-cue-phase]'))button.onclick=guard(()=>{accept();phase=button.dataset.cuePhase;index=0;render();});
  byId('cue-add').onclick=guard(()=>changeRecipe(cues=>{
    const last=cues[phase].at(-1),tune=api.readTune();
    cues[phase].push({time:last.time+1,tune,
      radius:Number(tune.domControls['volume-input-radius'].rawValue??tune.domControls['volume-input-radius'].value),
      flow:Number(tune.domControls['volume-flow-rate'].rawValue??tune.domControls['volume-flow-rate'].value)});index=cues[phase].length-1;
  }));
  byId('cue-duplicate').onclick=guard(()=>changeRecipe(cues=>{
    const selected=cues[phase][index],next=cues[phase][index+1];
    cues[phase].splice(index+1,0,{...structuredClone(selected),time:next?(selected.time+next.time)/2:selected.time+1});index++;
  }));
  byId('cue-remove').onclick=guard(()=>changeRecipe(cues=>{if(index===0 || cues[phase].length<=2)throw Error('A phase needs its initial key and at least one later key');cues[phase].splice(index,1);index--;}));
  const time=byId('cue-key-time');let priorTime=0;
  time.addEventListener('focus',()=>{priorTime=Number(time.value);});
  installRelativeNumberDrag({input:time,step:.02,onStart:()=>{priorTime=Number(time.value);}});
  time.addEventListener('change',()=>{try{changeRecipe(cues=>{cues[phase][index].time=Number(time.value);});}catch(error){time.value=priorTime;failure(error);}});
  time.addEventListener('pointercancel',()=>{time.value=priorTime;});
  for(const [name,label,step,min,max] of [['extinguishSeconds','Smoke clearance',.05,.001,null],['revealSeconds','Reveal fade',.05,.001,null],['previewWorkSeconds','Preview work',.05,.001,null],['workLight','Work light',.01,0,null],['cameraPush','Camera push',.002,0,.9]]) {
    const row=document.createElement('div');row.className='slider-row';
    const grip=document.createElement('label');grip.className='slider-label';grip.textContent=label;
    const field=document.createElement('input');field.type='number';field.step='any';field.min=min;if(max!==null)field.max=max;field.className='transform-input';field.dataset.cueSetting=name;field.setAttribute('aria-label',label);
    let previous;row.append(grip,field);byId('cue-sequence-fields').append(row);
    installRelativeNumberDrag({grip,input:field,step,onStart:()=>{previous=Number(field.value);}});
    field.addEventListener('focus',()=>{previous=Number(field.value);});
    field.addEventListener('change',()=>{try{changeRecipe(cues=>{cues[name]=Number(field.value);});}catch(error){field.value=previous;failure(error);}});
    field.addEventListener('pointercancel',()=>{field.value=previous;});
  }
  byId('cue-accept').onclick=guard(()=>{accept();render();status('Keyframe tune accepted');});
  byId('cue-cancel').onclick=guard(()=>{editor.cancel();render();status('Tune cancelled');});
  byId('cue-audition').onclick=guard(()=>{ensure();tunePanel.sync();syncState();status('Auditioning keyframe');});
  const showBasins=()=>{
    const select=byId('cue-basin-select'),old=select.value,q=byId('cue-basin-search').value.toLowerCase();select.replaceChildren();
    const source=api.readTune().source;
    const entries=source&&!basins.some(item=>item.presetId===source.presetId)
      ? [{presetId:source.presetId,label:`Loaded: ${source.label||source.presetId}`},...basins] : basins;
    for(const basin of entries.filter(item=>`${item.label} ${item.presetId}`.toLowerCase().includes(q))) {const option=document.createElement('option');option.value=basin.presetId;option.textContent=basin.label;select.append(option);}
    if([...select.options].some(item=>item.value===old))select.value=old;
    byId('cue-basin-apply').disabled=!select.value;
  };
  byId('cue-basin-search').oninput=showBasins;
  byId('cue-basin-apply').onclick=guard(async()=>{ensure();await editor.useBasin(byId('cue-basin-select').value);tunePanel.sync();syncState();status('Basin loaded into keyframe draft');});
  byId('cue-preview').onclick=guard(async()=>{accept();await preview();});
  byId('cue-save').onclick=guard(async()=>{accept();const result=await window.saveScene({result:true});if(!result?.ok)throw Error(result?.error||'Scene save failed');status(`Saved ${result.filename}`);render();});
  byId('cue-cinema').onclick=guard(()=>{accept();openCinema();});
  workspace.addContext({id:'cues',label:'Cues',node:panel,enter:()=>{render();},leave:()=>{editor.cancel();}});
  api.historyScope(panel);
  window.kaminosSceneEdits.subscribe(()=>{if(workspace.state().context==='cues'&&!editor.active())render();});
  void api.listBasins().then(result=>{basins=result.entries;showBasins();}).catch(failure);
  return {open(){workspace.setMode('authoring');workspace.setContext('cues');render();panel.scrollTop=0;},state:()=>({phase,index,draft:editor.state()}),panel};
}
