// kaminos-test: node
import assert from 'node:assert/strict';
import {bindRangeNumber,installLegacyRangeFields} from '../legacy-range-field.mjs';
import {collectVolumeCockpitControlElements} from '../volume-cockpit-layout.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {installSceneControlHistory} from '../scene-control-history.mjs';
class Input extends EventTarget {
  constructor(value){super();this.value=value;this.min='0';this.max='10';this.step='.1';this.disabled=false;this.readOnly=true;this.dataset={};}
  closest(){return null;}
  // Keep DOM currentTarget identity during nested field→owner event dispatch.
  dispatchEvent(event){Object.defineProperty(event,'currentTarget',{configurable:true,get:()=>this});return super.dispatchEvent(event);}
}
const source=new Input('2'),input=new Input('');
bindRangeNumber(source,input);
let changes=0,inputs=0;
source.addEventListener('input',()=>inputs++);source.addEventListener('change',()=>changes++);
input.value='4';input.dispatchEvent(new Event('input'));
assert.equal(source.value,'4','numeric preview must reach the original control and its owner');
assert.equal(inputs,1);
input.dispatchEvent(new Event('change'));assert.equal(changes,1);
source.value='7';assert.equal(input.value,'7','programmatic undo/load updates must reach the visible field');
input.value='';input.dispatchEvent(new Event('input'));assert.equal(source.value,'7','unfinished typing must not zero the owner value');
input.dispatchEvent(new Event('change'));assert.equal(input.value,'7');
assert.equal(source.type,undefined,'the original control identity/type must be preserved');
console.log('Legacy range field propagation and restoration pass');

const aperture=new Input('0.2'),radiusField=new Input('');
aperture.max='.5';
let radius='.2';
Object.defineProperty(aperture,'value',{configurable:true,get:()=>radius,set:v=>{radius=String(Math.min(Number(aperture.max),Number(v)));}});
bindRangeNumber(aperture,radiusField,{unboundedMax:true});
radiusField.value='200';radiusField.dispatchEvent(new Event('input'));radiusField.dispatchEvent(new Event('change'));
assert.equal(aperture.value,'200','unbounded radius writes expand before native range clamping');
assert.equal(radiusField.max,'','number field must not retain the slider extent as an authored limit');
radiusField.value='250';radiusField.dispatchEvent(new Event('input'));
assert.equal(aperture.value,'250');

// Exercise the actual installer and canonical collector together: aliases must
// not become an additional simulation/settings input or change the owner's role.
const canonical=new Input('2');canonical.id='volume-physical-temperature';canonical.type='range';
canonical.dataset={volumeSettingsRole:'renderer'};canonical.style={};canonical.getAttribute=()=>null;
const members=[canonical];
const row={querySelector:()=>null,querySelectorAll:()=>[]};
canonical.closest=selector=>selector.includes('slider-row')?row:null;
canonical.before=alias=>members.unshift(alias);
canonical.ownerDocument={createElement(){const i=new Input('');i.setAttribute=()=>{};i.classList={contains:()=>false};return i;},
  defaultView:{MutationObserver:class{observe(){}}}};
const roots={getElementById:id=>({querySelectorAll:()=>id==='volume-primary-control-root'?members.filter(i=>i.id.startsWith('volume-')):[]}),
  querySelectorAll:()=>[canonical]};
const before=collectVolumeCockpitControlElements(roots).map(i=>({id:i.id,role:i.dataset.volumeSettingsRole}));
installLegacyRangeFields({root:roots,installNumberDrag:()=>({stop(){}})});
assert.deepEqual(collectVolumeCockpitControlElements(roots).map(i=>({id:i.id,role:i.dataset.volumeSettingsRole})),before,
  'numeric presentation must preserve canonical volume IDs, roles and count');

const owner=new Input('2'),field=new Input('2');field.readOnly=false;
field.ownerDocument={activeElement:field};bindRangeNumber(owner,field);
const edits=createSceneEdits({read:()=>null,write(){}});
edits.register('@value',{read:()=>({value:Number(owner.value)}),write:next=>{owner.value=String(next.value);},check:next=>next});
installSceneControlHistory({controls:[owner],edits,id:'@value'});
field.dispatchEvent(new Event('focusin'));
for(const value of ['4','6']) {
  field.dispatchEvent(new Event('beforeinput'));field.value=value;
  field.dispatchEvent(new Event('input'));field.dispatchEvent(new Event('change'));
}
assert.equal(edits.state().undoCount,2,'continued typing after commit must start a new transaction');
edits.undo();assert.equal(owner.value,'4');edits.redo();assert.equal(owner.value,'6');
field.dispatchEvent(new Event('beforeinput'));field.value='8';field.dispatchEvent(new Event('input'));
field.dispatchEvent(new Event('pointercancel'));assert.equal(owner.value,'6');assert.equal(field.value,'6');
