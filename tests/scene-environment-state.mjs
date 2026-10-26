// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSceneEnvironmentState} from '../scene-environment-state.mjs';
import {bindSceneEnvironmentControls,ENVIRONMENT_CONTROL_FIELDS,environmentLegacySettings} from '../scene-environment-controls.mjs';
import {buildSceneDocument} from '../scene-persistence-core.js';
const presets={studio:{exposure:1.1,intensity:.7},neutral:{exposure:1.5,intensity:1}};
const create=()=>createSceneEnvironmentState({presets});
test('accepted state owns per-map recipe recall and independent document snapshots',()=>{
 const state=create();state.select('studio');state.patch({exposure:7.123456,intensity:0,rotation:-9.1234,backgroundBrightness:1.234567,backgroundContrast:0,backgroundBlur:.345678,showBackground:false});const first=state.document();
 state.select('neutral');state.patch({intensity:2.345678});state.select('studio');assert.deepEqual(state.document(),{...first,recipes:{...first.recipes,neutral:{...state.defaults('neutral'),intensity:2.345678}}});
 first.recipes.studio.intensity=99;assert.equal(state.read().intensity,0);assert.throws(()=>{state.read().recipes.studio.intensity=88;},TypeError);
 const doc=buildSceneDocument({environment:state.document()});const reopened=create();reopened.restoreDocument(doc.environment);assert.deepEqual(reopened.document(),state.document());
});
test('invalid edits and invalid restore are atomic and leave all listeners untouched',()=>{
 const state=create();state.select('studio');let calls=0;state.subscribe(()=>calls++);const previous=state.read();
 for(const patch of [{intensity:-1},{rotation:Infinity},{backgroundBlur:2},{exposure:'1'},{showBackground:1},{other:2}])assert.throws(()=>state.patch(patch));
 assert.throws(()=>state.restoreDocument({name:'studio',intensity:-1,recipes:{neutral:{intensity:5}}}));assert.throws(()=>state.select('missing'));
 assert.equal(state.read(),previous);assert.equal(calls,0);assert.equal(state.check({intensity:1.234567}).intensity,1.234567);assert.equal(state.read(),previous);
});
test('existing document defaults and legacy per-map storage survive without controls',()=>{
 const state=create();state.restoreDocument({name:'neutral',recipes:{studio:{intensity:2.7},retired:{intensity:9}}});assert.equal(state.read().exposure,1.5);assert.equal(state.read().intensity,1);assert.equal(state.read().showBackground,false);assert.equal(state.read().recipes.retired,undefined);
 state.select('studio');assert.equal(state.read().intensity,2.7);const storage=environmentLegacySettings(state);assert.equal(storage['env-intensity-slider'],'2.7');assert.equal(storage['show-env-bg'],false);assert.equal(storage.environmentRecipes.studio.intensity,2.7);
 state.patch({intensity:4});state.reset();assert.equal(state.read().intensity,.7);assert.equal(state.read().showBackground,false);
});
function controlsFixture(){
 const nodes=new Map(),document={activeElement:null,getElementById(id){if(!nodes.has(id))nodes.set(id,new Control());return nodes.get(id);}};
 class Control extends EventTarget{constructor(){super();this.value='0';this.min='0';this.max='1';this.step='.1';this.checked=false;this.style={};}fire(type){this.dispatchEvent(new Event(type));}}
 return {nodes,document};
}
test('UI admits edits to the same owner; drafts and invalid text never become saved state',()=>{
 const state=create();state.select('studio');const {document}=controlsFixture(),errors=[];const ui=bindSceneEnvironmentControls({state,document,onError:error=>errors.push(error.message)});
 const input=document.getElementById(ENVIRONMENT_CONTROL_FIELDS.intensity);document.activeElement=input;input.value='';input.fire('input');assert.equal(state.read().intensity,.7);assert.equal(input.value,'');assert.equal(environmentLegacySettings(state)['env-intensity-slider'],'0.7');
 input.value='1.234567';input.fire('input');assert.equal(state.read().intensity,1.234567);assert.equal(input.value,'1.234567');
 input.value='-1';input.fire('input');assert.equal(state.read().intensity,1.234567);assert.equal(errors.length,1);input.fire('change');assert.equal(input.value,'1.234567');
 document.activeElement=null;state.patch({intensity:7.345678});assert.equal(input.value,'7.345678');assert.ok(Number(input.max)>=7.345678);
 const show=document.getElementById(ENVIRONMENT_CONTROL_FIELDS.showBackground);show.checked=false;show.fire('change');assert.equal(state.read().showBackground,false);assert.equal(document.getElementById('blur-row').style.display,'none');
 const before=state.read();ui.dispose();input.value='3';input.fire('input');assert.equal(state.read(),before);
});
