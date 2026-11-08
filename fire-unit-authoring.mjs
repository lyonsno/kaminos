import {createFlameInspector} from './flame-authoring.mjs';
import {GRID_TUNING_FIELDS} from './volume-grid-tuning.mjs';
import {WORLD_CALIBRATION_FIELDS,SIMULATION_LEVER_FIELDS,captureWorldCalibration} from './volume-world-calibration.mjs';
import {installSceneControlHistory} from './scene-control-history.mjs';
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
 const settings=()=>owner.capture().settings??seedSettings;
 function project(value){for(const axis of ['domControls','rendererControls','presentationControls'])for(const d of Object.values(value?.[axis]??{})){
  const node=copy.getElementById(d.id);if(!node)throw Error('Unsupported fire control '+d.id);
  setFireUnitControlValue(node,node.type==='checkbox'?d.value:(d.rawValue??d.value));
 }}
 function snapshot(base=settings()){const value=structuredClone(base);for(const axis of ['domControls','rendererControls','presentationControls'])for(const d of Object.values(value[axis]??{})){
  const node=copy.getElementById(d.id);if(!node)continue;d.value=node.type==='checkbox'?node.checked:['range','number'].includes(node.type)?Number(node.value):node.value;if('rawValue'in d)d.rawValue=node.type==='checkbox'?node.checked:node.value;
 }return value;}
 let applying=false,inspector;
 function write(label='Tune fire simulation',nextSettings=snapshot()){
  const next={...owner.capture(),settings:nextSettings,controls:compile(copy,nextSettings)};
  applying=true;try{if(edits.state().active?.id===target)edits.preview(next);else edits.apply(target,next,label);}finally{applying=false;}inspector?.sync();
 }
 function writeCalibration(patch,label='Tune simulation world scale'){for(const f of [...WORLD_CALIBRATION_FIELDS,...SIMULATION_LEVER_FIELDS])if(Object.hasOwn(patch,f.key))setFireUnitControlValue(copy.getElementById(f.id),patch[f.key]);write(label);}
 const byId=id=>{let node=root.querySelector(`[data-fire-control-id="${id}"]`)??root.querySelector(`[id="${id}"]`)??copy.getElementById(id);
  if(!node){const source=document.getElementById(id);if(source){node=source.cloneNode(true);copy.body.append(node);}}return node;};
 const facade=new Proxy(document,{get(object,key){if(key==='getElementById')return byId;const v=Reflect.get(object,key,object);return typeof v==='function'?v.bind(object):v;}});
 project(settings());seedControls(copy,owner.capture().controls);
 for(const node of copy.querySelectorAll('input,select'))for(const event of ['input','change'])node.addEventListener(event,()=>{try{write();}catch(error){onError(error);}});
 inspector=createFlameInspector({document:facade,host:root,sharedHost:root,scopeDescription:'These controls edit this fire simulation only.',onError,listBasins,
  readSourceRuntime:()=>owner.runtime.debugState().immersedSources?.sources?.[0]?.config??null,
  applyBasin:async id=>{const preset=await loadBasin(id);project(preset);write('Apply fire basin',snapshot(preset));return preset;},
  saveBasin:({label})=>saveBasin(snapshot(),label),readSource:()=>settings().source??null,
  readPressureRuntime:()=>owner.runtime.debugState().pressureResolution,
  readWorldRuntime:()=>owner.runtime.debugState().worldSmoke,
  readAppearanceRuntime:()=>owner.runtime.debugState().physicsAppearance,
  readRaymarchRuntime:()=>owner.runtime.debugState().opticalStepping,
  gridTuning:{idPrefix:prefix,isEnabled:()=>!root.closest('[hidden]'),read:()=>owner.capture().controls,validate:c=>owner.runtime.validateGridControls(c),
   calibration:{set:patch=>writeCalibration(patch),capture:()=>writeCalibration(captureWorldCalibration(owner.capture().controls,owner.root.scale.x),'Capture simulation world scale')},
   bindLiveField:(input,label='Tune pressure iterations')=>installSceneControlHistory({controls:[input],edits,id:target,label,onError}),
   apply:patch=>{for(const [key,id]of GRID_TUNING_FIELDS)if(Object.hasOwn(patch,key))setFireUnitControlValue(copy.getElementById(id),patch[key]);write('Change simulation grids');},
   live:(key,value)=>{const id=GRID_TUNING_FIELDS.find(f=>f[0]===key)[1];setFireUnitControlValue(copy.getElementById(id),value);write('Tune pressure iterations');}},
 });
 for(const node of root.querySelectorAll('[id]'))if(!node.id.startsWith(prefix)){node.dataset.fireControlId=node.id;node.id=prefix+node.id;}
 for(const node of root.querySelectorAll('[for],[aria-controls],[aria-labelledby]'))for(const name of ['for','aria-controls','aria-labelledby']){const value=node.getAttribute(name);if(value&&!value.startsWith(prefix))node.setAttribute(name,prefix+value);}
 return {close(){inspector.closeGrid();},sync(){if(applying)return;project(settings());seedControls(copy,owner.capture().controls);inspector.sync();},dispose(){inspector.dispose?.();}};
}
