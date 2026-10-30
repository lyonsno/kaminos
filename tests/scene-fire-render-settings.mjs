// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {checkedFireRendering,readFireRendering,FIRE_RENDER_DEFAULTS} from '../scene-fire-render-settings.mjs';
test('scene flame lighting preserves camera match, source softness and surface trim',()=>{
 const values={...FIRE_RENDER_DEFAULTS,'rendering-match-flame-camera':true,'rendering-source-softness':4,'rendering-surface-gain':-2.5,'rendering-angular-pattern':'guided','rendering-angular-samples':48};
 const document={getElementById:id=>({checked:values[id],value:String(values[id])})};assert.deepEqual(readFireRendering(document),values);assert.deepEqual(checkedFireRendering(values),values);assert.throws(()=>checkedFireRendering({'rendering-source-softness':NaN}),/Invalid/);assert.throws(()=>checkedFireRendering({'rendering-source-softness':.4}),/integer/);
});
test('scene documents retain every supported smoke angular pattern',()=>{
 for(const pattern of ['fixed','spatial','blue','source','guided','regions','importance']){
  const values={...FIRE_RENDER_DEFAULTS,'rendering-angular-pattern':pattern};
  const document={getElementById:id=>({checked:values[id],value:String(values[id])})};
  assert.deepEqual(checkedFireRendering(JSON.parse(JSON.stringify(readFireRendering(document)))) ,values);
 }
 assert.throws(()=>checkedFireRendering({'rendering-angular-pattern':'unknown'}),/Invalid/);
});
test('legacy document restoration applies direction and pattern without history collisions',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm');
 const {restoreFireRendering}=await import('../scene-fire-render-settings.mjs');
 const {createSceneEdits}=await import('../scene-edit-session.mjs');
 const {createFireLightingHistory}=await import('../fire-lighting-history.mjs');
 const elements=new Map(),errors=[],state={directions:24,angularPattern:'fixed'};let phase='applying';
 class Element extends EventTarget{constructor(id){super();this.value=String(FIRE_RENDER_DEFAULTS[id]??'');this.checked=FIRE_RENDER_DEFAULTS[id];this.type=typeof this.checked==='boolean'?'checkbox':id.includes('pattern')||id.includes('samples')||id.includes('solver')?'select-one':'number';}}
 const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);}};
 const source={debugState:()=>({...state}),setDirections:v=>{state.directions=v;},setAngularPattern:v=>{state.angularPattern=v;},whenRebuilt:()=>Promise.resolve()};
 const edits=createSceneEdits({read:()=>null,write(){}});
 const context={document,window:{__kaminosSceneRadiance:source},sceneDocument:{state:()=>({phase})},setInfo:e=>errors.push(e),refreshRenderingControls(){source.setDirections(Number(document.getElementById('rendering-angular-samples').value));source.setAngularPattern(document.getElementById('rendering-angular-pattern').value);}};
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('let sceneFireLightingHistory='),end=html.indexOf("document.getElementById('rendering-receiver-spacing')",start);
 vm.createContext(context);vm.runInContext(html.slice(start,end),context);context.adapter=createFireLightingHistory({edits,getSource:()=>source,sync:context.syncFireLightingControls});vm.runInContext('sceneFireLightingHistory=adapter',context);
 restoreFireRendering(document,{...FIRE_RENDER_DEFAULTS,'rendering-angular-samples':48,'rendering-angular-pattern':'spatial'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(errors,[]);assert.deepEqual(state,{directions:48,angularPattern:'spatial'});assert.equal(edits.state().undoCount,0);assert.equal(edits.state().active,null);
 phase='idle';document.getElementById('rendering-angular-pattern').value='blue';document.getElementById('rendering-angular-pattern').dispatchEvent(new Event('change'));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(edits.state().undoCount,1);await edits.undo();assert.equal(state.angularPattern,'spatial');await edits.redo();assert.equal(state.angularPattern,'blue');
});
