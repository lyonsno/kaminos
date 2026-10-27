// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createSceneAOState,bindSceneAOControls,AO_CONTROL_FIELDS} from '../scene-ao-state.mjs';
const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('undispatched AO drafts do not alter the effective accepted material-side strength',()=>{
 const a=page.indexOf('function effectiveAOIntensity('),b=page.indexOf('\n}',a)+2;
 const controls={'ao-toggle':{checked:true},'ao-intensity':{value:'2.9'}};
 const context=vm.createContext({viewportDisplay:{shading:'solid'},sceneAO:createSceneAOState(),document:{getElementById:id=>controls[id]}});
 vm.runInContext(page.slice(a,b),context);
 assert.equal(context.effectiveAOIntensity(),1,'rendering reads accepted state, not undispatched control text');
 context.viewportDisplay.shading='wireframe';assert.equal(context.effectiveAOIntensity(),0);
});

test('accepted AO state rejects atomically, retains precision and copies persistence output',()=>{
 const state=createSceneAOState(),seen=[];state.subscribe(value=>seen.push(value));
 state.patch({radius:27.123456,intensity:0,enabled:false});
 const before=state.read();assert.ok(Object.isFrozen(before));
 assert.equal(before.radius,27.123456);assert.equal(state.document().intensity,0);
 for(const patch of [{radius:NaN},{intensity:-1},{enabled:'false'},{scale:Infinity},{unexpected:2}])assert.throws(()=>state.patch(patch));
 assert.equal(state.read(),before);assert.equal(seen.length,1);
 const doc=state.document();doc.radius=2;assert.equal(state.read().radius,27.123456);
 assert.equal(state.document().farBlend,state.read().falloff);
});

test('actual document and browser storage compatibility retain their distinct old interpretations',()=>{
 const state=createSceneAOState();state.patch({intensity:2,falloff:.2});
 state.restoreDocument({scale:1.62,farBlend:.74,unknownAdditive:'compatible'});
 assert.equal(state.read().intensity,1.62);assert.equal(state.read().scale,1.62);assert.equal(state.read().falloff,.74);assert.equal(state.read().enabled,true);
 state.restoreLegacy({'ao-toggle':false,'ao-intensity':'0','ao-radius':'27.123456','ao-scale':'.72'});
 assert.equal(state.read().enabled,false);assert.equal(state.read().intensity,0);assert.equal(state.read().radius,27.123456);
 assert.equal(state.legacySettings()['ao-radius'],'27.123456');
 const before=state.read();assert.throws(()=>state.restoreDocument({radius:4,thickness:NaN}));assert.equal(state.read(),before);
 assert.throws(()=>state.restoreLegacy({'ao-radius':''}));assert.equal(state.read(),before);
});

test('AO controls admit edits, preserve unfinished text and reconcile explicit commit/history',()=>{
 const fields=new Map(),doc={activeElement:null,getElementById:id=>fields.get(id)};
 class Input extends EventTarget{constructor(value){super();this.value=String(value);this.min='0';this.max='20';this.checked=true;this.style={};}}
 for(const id of Object.values(AO_CONTROL_FIELDS)){fields.set(id,new Input(0));fields.set(id+'-val',{textContent:''});}fields.set('ao-controls',{style:{}});
 const state=createSceneAOState(),accepted=[],errors=[];const controls=bindSceneAOControls({state,document:doc,onAccepted:()=>accepted.push(state.read()),onError:error=>errors.push(error)});
 const input=fields.get('ao-radius');doc.activeElement=input;input.value='';input.dispatchEvent(new Event('input'));state.patch({intensity:2});
 assert.equal(input.value,'');assert.equal(state.read().radius,10);assert.equal(fields.get('ao-intensity-val').textContent,'2.0');
 input.value='27.123456';input.dispatchEvent(new Event('input'));assert.equal(state.read().radius,27.123456);assert.equal(input.step,'any');assert.ok(Number(input.max)>=27.123456);
 input.value='-1';input.dispatchEvent(new Event('input'));assert.equal(errors.length,1);assert.equal(state.read().radius,27.123456);
 input.dispatchEvent(new Event('change'));assert.equal(Number(input.value),27.123456);
 input.value='';state.patch({radius:12});controls.sync({force:true});assert.equal(input.value,'12');
 const enabled=fields.get('ao-toggle');enabled.checked=false;enabled.dispatchEvent(new Event('change'));assert.equal(state.read().enabled,false);assert.equal(fields.get('ao-controls').style.display,'none');
 assert.equal(accepted.length,2);controls.dispose();input.value='3';input.dispatchEvent(new Event('input'));assert.equal(state.read().radius,12);
});

test('the page projects accepted AO values into the actual pass uniforms while wireframe only suppresses the effective strength',()=>{
 const state=createSceneAOState(),context=vm.createContext({sceneAO:state,viewportDisplay:{shading:'solid'},aoPass:Object.fromEntries(['radius','scale','thickness','distanceFallOff'].map(key=>[key,{value:0}])),aoIntensity:{value:0},window:{}});
 for(const name of ['effectiveAOIntensity','applySceneAOParameters']){const a=page.indexOf('function '+name+'('),b=page.indexOf('\n}',a)+2;vm.runInContext(page.slice(a,b),context);}
 state.subscribe(context.applySceneAOParameters);state.patch({radius:13.125,scale:1.2,thickness:.7,falloff:.33,intensity:2.2});
 assert.equal(context.aoPass.radius.value,13.125);assert.equal(context.aoPass.distanceFallOff.value,.33);assert.equal(context.aoIntensity.value,2.2);
 context.viewportDisplay.shading='wireframe';context.applySceneAOParameters(state.read());assert.equal(context.aoIntensity.value,0);assert.equal(state.document().intensity,2.2);
});

test('the actual scene restore updates browser-local AO continuation as well as rendering state',()=>{
 const state=createSceneAOState();state.patch({intensity:.1});let stored=state.legacySettings();
 const a=page.indexOf('    const ao = data.postprocessing.ao;'),b=page.indexOf('    const dof =',a);assert.ok(a>=0&&b>a);
 vm.runInNewContext(page.slice(a,b),{data:{postprocessing:{ao:{intensity:1.75,radius:7.125}}},sceneAO:state,saveSettings:()=>stored=state.legacySettings()});
 assert.equal(state.read().intensity,1.75);assert.equal(Number(stored['ao-intensity']),1.75,'reopened accepted state must replace the prior browser-local tweak');
});
