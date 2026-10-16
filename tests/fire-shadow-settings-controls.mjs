// kaminos-test: node
import assert from 'node:assert/strict';
import {createFireShadowSettings} from '../experiments/fire-shadow-sampling.experiment.mjs';
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.listeners={};this.attrs={};this._value='';this.assignments=0;}
 append(...children){this.children.push(...children);}
 setAttribute(key,value){this.attrs[key]=value;}
 addEventListener(key,fn,capture=false){const previous=this.listeners[key];this.listeners[key]=async()=>{let stopped=false;const event={stopImmediatePropagation(){stopped=true;}};if(capture){await fn(event);if(!stopped)await previous?.();}else{await previous?.();await fn(event);}};}
 set value(value){this._value=value;this.assignments++;}get value(){return this._value;}
}
let state={shadowSampling:'complementary',pointCount:4,pointSampling:'paired',shadowResolution:48,blockerSamples:3,filterSamples:3,shadowImplementation:'shared',shadowGrain:'world',shadowWorldCellSize:.02};
const document={createElement:tag=>new Element(tag),getElementById:()=>null,defaultView:{__kaminosSceneRadiance:{debugState:()=>state,setShadowSampling:value=>{state={...state,shadowSampling:value};}}}};
const root=new Element('div'),installed=[];
const settings=createFireShadowSettings({document,applyInitial:false,diagnostics:true,session:{redraw(){},dispose(){}},installNumberDrag:options=>{installed.push(options);}});
settings.mount({root,document,invoke:async(name,value)=>settings.operations[name](value)});
const walk=node=>[node,...node.children.filter(v=>typeof v==='object').flatMap(walk)];
const controls=walk(root),select=controls.find(v=>v.attrs['aria-label']==='Fire shadow sampling');
select.value='fixed';const before=select.assignments;
state={...state,status:'submitted-awaiting-presentation'};settings.sync();
assert.equal(select.value,'fixed','status-only refresh must not overwrite pending menu selection');
assert.equal(select.assignments,before,'unchanged configuration must not touch the native menu');
await select.listeners.change();assert.equal(settings.read().effective,'fixed');
assert.equal(controls.filter(v=>v.type==='range').length,0,'quality uses a single drag/type field, not duplicate sliders');
assert.equal(installed.length,4,'world-cell size and all three cost controls use the shared widget');
assert(controls.some(v=>v.value==='screen-animated'),'animated screen grain is exposed');
const cell=controls.find(v=>v.attrs['aria-label']==='World grain cell size');
await cell.listeners.focus();cell.value='0';await cell.listeners.change();
assert.equal(cell.value,'.02'.replace(/^\./,'0.'),'rejected edits restore the effective value');
console.log('PASS status refresh preserves pending controls and native numeric widgets are installed');

state={...state,shadowSampling:'complementary',shadowGrain:'screen-animated'};
const nativeRoot=new Element('div');
const nativeSettings=createFireShadowSettings({document,applyInitial:false,session:{redraw(){},dispose(){}},installNumberDrag:()=>{}});
nativeSettings.mount({root:nativeRoot,document,invoke:async()=>{}});
const nativeControls=walk(nativeRoot);
assert(!nativeControls.some(v=>v.attrs['aria-label']==='Capture implementation'),'ordinary settings omit implementation A/B');
assert(!nativeControls.some(v=>v.attrs['aria-label']==='Fire shadow sampling'),'ordinary settings omit repeated-pattern baseline');
assert(!nativeControls.some(v=>v.textContent==='Restore 256 / 9 / 16'),'ordinary settings do not advertise costly experiment baseline');
const nativeCellRow=nativeControls.find(v=>v.children.some(c=>c.attrs?.['aria-label']==='World grain cell size'));
assert.equal(nativeCellRow.hidden,true,'world-only size is absent for screen grain');
state={...state,shadowGrain:'world'};nativeSettings.sync();
assert.equal(nativeCellRow.hidden,false,'world size returns for world grain');
state={...state,shadowSampling:'fixed',shadowImplementation:'legacy'};nativeSettings.sync();
const nativeStatus=nativeControls.find(v=>v.attrs.role==='status');
assert.match(nativeStatus.textContent,/fixed.*legacy/,'saved diagnostic configurations remain visible, never silently relabeled');
assert.equal(state.shadowSampling,'fixed','mount and sync do not migrate saved lighting');
console.log('PASS ordinary fire settings retain quality and report legacy state without experimental controls');
