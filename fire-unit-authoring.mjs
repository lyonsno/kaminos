import {changeFireUnitBoxMode} from './fire-unit-record.mjs';
import {fireControlOwner} from './scene-fire-domain.mjs';
import {createFlameInspector} from './flame-authoring.mjs';
import {GRID_TUNING_FIELDS} from './volume-grid-tuning.mjs';
import {WORLD_CALIBRATION_FIELDS,SIMULATION_LEVER_FIELDS,captureWorldCalibration} from './volume-world-calibration.mjs';
import {installSceneControlHistory,installRelativeNumberDrag} from './scene-control-history.mjs';
// Dynamic inspectors use the same field interaction and transaction owners as
// main's initial inspector. Each source alias edits this unit's data target.
export function installFireUnitFieldEditing({root,edits,target,onError,numberDrag=installRelativeNumberDrag}){
 const histories=[],scrubs=[];
 for(const input of root.querySelectorAll('[data-authoring-alias]')){
  histories.push(installSceneControlHistory({controls:[input],edits,id:target,label:'Tune flame',onError}));
  if(input.type==='number')scrubs.push(numberDrag({input,grip:input.closest('.slider-row')?.querySelector('label')??input,
   step:Number(input.dataset.authoringDragStep)||.01,onStart:()=>histories.forEach(h=>h.commit())}));
 }
 const release=edits.subscribe(state=>{if(!state.active||state.active.id!==target)scrubs.forEach(s=>s.stop());});
 const close=()=>{histories.forEach(h=>h.commit());scrubs.forEach(s=>s.stop());};
 return {close,dispose(){close();release();histories.forEach(h=>h.dispose());scrubs.forEach(s=>s.dispose());}};
}
export function setFireUnitControlValue(node,value){
 if(node.type==='checkbox'){node.checked=value;return;}
 if(GRID_TUNING_FIELDS.some(([,id])=>id===node.id)&&node.tagName==='SELECT'&&String(value).trim()!==''&&Number.isFinite(Number(value))&&!Array.from(node.options).some(o=>o.value===String(value))){const option=node.ownerDocument.createElement('option');option.value=String(value);option.textContent=String(value);node.append(option);}
 if(node.type==='range'){node.min=String(Math.min(Number(node.min),Number(value)));node.max=String(Math.max(Number(node.max),Number(value)));node.step='any';}node.value=String(value);
}
export function createFireUnitControlDocument(document,settings){
 const copy=document.implementation.createHTMLDocument('Fire unit controls');
 for(const source of document.querySelectorAll('input[id],select[id],output[id]')){const node=source.cloneNode(true);if('value'in source)node.value=source.value;if('checked'in source)node.checked=source.checked;copy.body.append(node);}
 for(const axis of ['domControls','rendererControls','presentationControls'])for(const d of Object.values(settings?.[axis]??{})){let node=copy.getElementById(d.id);if(!node&&axis==='presentationControls'&&d.id==='raymarch-smoke-presentation'&&d.type==='button-state'){node=copy.createElement('input');node.id=d.id;node.type='hidden';copy.body.append(node);}if(!node)throw Error('Unsupported fire control '+d.id);setFireUnitControlValue(node,node.type==='checkbox'?d.value:(d.rawValue??d.value));}
 return copy;
}
// Each unit borrows the ordinary inspector with detached backing controls. A
// unit edit never writes the page singleton's controls or another unit.
export function mountFireUnitAuthoring({document,root,owner,edits,target,seedSettings,compile,seedControls,listBasins,loadBasin,saveBasin,onError}){
 const prefix=target.replaceAll(/[^a-zA-Z0-9-]/g,'-')+'-',copy=createFireUnitControlDocument(document,owner.capture().settings??seedSettings);
 const sourceHost=document.createElement('div'),simulationHost=document.createElement('div');
 sourceHost.dataset.fireUnitSourceProperties='';simulationHost.dataset.fireUnitSimulationProperties='';sourceHost.hidden=true;
 root.append(sourceHost,simulationHost);
 const settings=()=>owner.capture().settings??seedSettings;
 function project(value){for(const axis of ['domControls','rendererControls','presentationControls'])for(const d of Object.values(value?.[axis]??{})){
  const node=copy.getElementById(d.id);if(!node)throw Error('Unsupported fire control '+d.id);
  setFireUnitControlValue(node,node.type==='checkbox'?d.value:(d.rawValue??d.value));
 }}
 function snapshot(base=settings()){const value=structuredClone(base);for(const axis of ['domControls','rendererControls','presentationControls'])for(const d of Object.values(value[axis]??{})){
  const node=copy.getElementById(d.id);if(!node)continue;d.value=node.type==='checkbox'?node.checked:['range','number'].includes(node.type)?Number(node.value):node.value;if('rawValue'in d)d.rawValue=node.type==='checkbox'?node.checked:node.value;
 }return value;}
 let applying=false,inspector,boxMode;
 function write(label='Tune fire simulation',nextSettings=snapshot(),base=owner.capture()){
  const current=owner.capture(),next={...base,settings:nextSettings,controls:compile(copy,nextSettings)};
  if(Object.entries(nextSettings.domControls??{}).some(([id,d])=>(fireControlOwner(id)==='source'||id.startsWith('volume-coverage-'))&&String(d.rawValue??d.value)!==String(current.settings?.domControls?.[id]?.rawValue??current.settings?.domControls?.[id]?.value)))next.fineManualHold=false;
  applying=true;try{if(edits.state().active?.id===target)edits.preview(next);else edits.apply(target,next,label);}finally{applying=false;}if(boxMode)boxMode.value=owner.capture().controls.worldSmoke==='on'?'double':'single';inspector?.sync();
 }
 function writeCalibration(patch,label='Tune simulation world scale'){for(const f of [...WORLD_CALIBRATION_FIELDS,...SIMULATION_LEVER_FIELDS])if(Object.hasOwn(patch,f.key))setFireUnitControlValue(copy.getElementById(f.id),patch[f.key]);write(label);}
 const byId=id=>{let node=root.querySelector(`[data-fire-control-id="${id}"]`)??root.querySelector(`[id="${id}"]`)??copy.getElementById(id);
  if(!node){const source=document.getElementById(id);if(source){node=source.cloneNode(true);copy.body.append(node);}}return node;};
 const facade=new Proxy(document,{get(object,key){if(key==='getElementById')return byId;const v=Reflect.get(object,key,object);return typeof v==='function'?v.bind(object):v;}});
 project(settings());seedControls(copy,owner.capture().controls);
 for(const node of copy.querySelectorAll('input,select'))for(const event of ['input','change'])node.addEventListener(event,()=>{try{write();}catch(error){onError(error);}});
 inspector=createFlameInspector({document:facade,host:sourceHost,sharedHost:simulationHost,scopeDescription:'These controls edit this flame only.',onError,listBasins,
  readSourceRuntime:()=>owner.runtime.debugState().immersedSources?.sources?.[0]?.config??null,
  applyBasin:async id=>{const preset=await loadBasin(id);project(preset);write('Apply fire basin',snapshot(preset));return preset;},
  saveBasin:({label})=>saveBasin(snapshot(),label),readSource:()=>settings().source??null,
  readPressureRuntime:()=>owner.runtime.debugState().pressureResolution,
  readWorldRuntime:()=>owner.runtime.debugState().worldSmoke,
  readWorldOverlay:()=>owner.worldOverlay(),setWorldOverlay:mode=>owner.setWorldOverlay(mode),
  readAppearanceRuntime:()=>owner.runtime.debugState().physicsAppearance,
  readRaymarchRuntime:()=>owner.runtime.debugState().opticalStepping,
  gridTuning:{idPrefix:prefix,isEnabled:()=>!root.closest('[hidden]'),read:()=>owner.capture().controls,validate:c=>owner.runtime.validateGridControls(c),
   calibration:{set:patch=>writeCalibration(patch),capture:()=>writeCalibration(captureWorldCalibration(owner.capture().controls,owner.root.scale.x),'Capture simulation world scale')},
   bindLiveField:(input,label='Tune pressure iterations')=>installSceneControlHistory({controls:[input],edits,id:target,label,onError}),
   apply:patch=>{const current=owner.capture();project(current.settings??seedSettings);seedControls(copy,current.controls);for(const [key,id]of GRID_TUNING_FIELDS)if(key!=='worldSmoke'&&Object.hasOwn(patch,key))setFireUnitControlValue(copy.getElementById(id),patch[key]);const stagedSettings=snapshot(),staged={...current,settings:stagedSettings,controls:compile(copy,stagedSettings)},base=Object.hasOwn(patch,'worldSmoke')?changeFireUnitBoxMode(staged,patch.worldSmoke==='on'?'double':'single'):staged;project(base.settings??seedSettings);seedControls(copy,base.controls);write('Change simulation grids',snapshot(base.settings??seedSettings),base);},
   live:(key,value)=>{const id=GRID_TUNING_FIELDS.find(f=>f[0]===key)[1];setFireUnitControlValue(copy.getElementById(id),value);write('Tune pressure iterations');}},
 });
 const qualityRow=document.createElement('label');qualityRow.className='slider-row';qualityRow.append(document.createTextNode('Simulation boxes'));
 boxMode=document.createElement('select');boxMode.className='select-input';boxMode.dataset.fireUnitBoxMode='';boxMode.setAttribute('aria-label','Simulation boxes');
 for(const [value,label]of [['double','Double · local Fine + outer'],['single','Single · outer becomes Fine']]){const option=document.createElement('option');option.value=value;option.textContent=label;boxMode.append(option);}
 const syncBoxMode=()=>{boxMode.value=owner.capture().controls.worldSmoke==='on'?'double':'single';};syncBoxMode();
 boxMode.onchange=()=>{try{const next=changeFireUnitBoxMode(owner.capture(),boxMode.value);project(next.settings??seedSettings);seedControls(copy,next.controls);write('Change Flame boxes',snapshot(next.settings??seedSettings),next);}catch(error){onError(error);syncBoxMode();}};
 qualityRow.append(boxMode);simulationHost.querySelector('[role="tabpanel"][id$="-quality"]').prepend(qualityRow);
 const editing=installFireUnitFieldEditing({root,edits,target,onError});
 for(const node of root.querySelectorAll('[id]'))if(!node.id.startsWith(prefix)){node.dataset.fireControlId=node.id;node.id=prefix+node.id;}
 for(const node of root.querySelectorAll('[for],[aria-controls],[aria-labelledby]'))for(const name of ['for','aria-controls','aria-labelledby']){const value=node.getAttribute(name);if(value&&!value.startsWith(prefix))node.setAttribute(name,prefix+value);}
 return {close(){editing.close();inspector.closeGrid();},setSourceMode(value){sourceHost.hidden=!value;simulationHost.hidden=!!value;},sync(){if(applying)return;project(settings());seedControls(copy,owner.capture().controls);syncBoxMode();inspector.sync();},dispose(){editing.dispose();inspector.dispose?.();}};
}
