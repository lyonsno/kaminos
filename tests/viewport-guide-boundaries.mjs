import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.webgpu.js';
import {createFlameEmitterHandle,applyFlameEmitterGuideSettings} from '../scene-flame-emitter.mjs';
import {installRelativeNumberDrag} from '../scene-control-history.mjs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const workspace=readFileSync(new URL('../authoring-workspace.mjs',import.meta.url),'utf8');
class Control extends EventTarget {
  style={};classList={add(){},remove(){}};value='.55';validity={valid:true};
  setPointerCapture(){}hasPointerCapture(){return false;}
  fire(type,init={}) {const e=new Event(type,{cancelable:true});for(const [k,v] of Object.entries(init))Object.defineProperty(e,k,{value:v});this.dispatchEvent(e);}
}

test('accepted unfocused opacity scrubs establish the next cancellation baseline',()=>{
  for(const dragPart of ['number','label']) {
    const doc=new Control(),input=new Control(),label=new Control();input.ownerDocument=doc;input.previousElementSibling=label;input.min='0';input.max='1';doc.activeElement=null;
    input.focus=()=>{doc.activeElement=input;input.fire('focusin');};input.select=()=>{};
    input.blur=()=>{if(doc.activeElement===input){doc.activeElement=null;input.fire('blur');}};
    let value=.55;const api={read:()=>({emitterGuideOpacity:value}),set:next=>{value=next.emitterGuideOpacity;input.value=String(value);}};
    const start=workspace.indexOf("  const opacity=byId('viewport-emitter-opacity');"),end=workspace.indexOf("  byId('apply-burner-preset')",start);
    globalThis.window=new Control();globalThis.document=doc;
    try {
      vm.runInNewContext(workspace.slice(start,end),{byId:()=>input,document:{defaultView:{kaminosViewportSettings:api}},installRelativeNumberDrag});
      const target=dragPart==='number'?input:label;
      target.fire('pointerdown',{button:0,pointerId:1,clientX:100});target.fire('pointermove',{pointerId:1,clientX:110});target.fire('pointerup',{pointerId:1});
      assert.equal(value,.65,dragPart+' first scrub');
      target.fire('pointerdown',{button:0,pointerId:2,clientX:100});target.fire('pointermove',{pointerId:2,clientX:110});
      doc.fire('keydown',{key:'Escape'});assert.equal(value,.65,dragPart+' cancellation must preserve the accepted scrub');
    }finally{delete globalThis.window;delete globalThis.document;}
  }
});

test('editor guide appearance is excluded from material snapshots and legacy material restore',()=>{
  const helper=createFlameEmitterHandle(THREE),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({opacity:.8,transparent:true}));
  const start=html.indexOf('function getMaterialStateForObject('),end=html.indexOf('function serializeSceneObject(',start);
  const applyStart=html.indexOf('function applyMaterialStateToObject('),applyEnd=html.indexOf('\nfunction ',applyStart+10);
  const context={THREE};vm.createContext(context);vm.runInContext(html.slice(start,end)+html.slice(applyStart,applyEnd),context);
  applyFlameEmitterGuideSettings(helper,{visible:true,opacity:.55});const before=context.getMaterialStateForObject(helper);
  applyFlameEmitterGuideSettings(helper,{visible:false,opacity:.15});assert.deepEqual(context.getMaterialStateForObject(helper),before);
  assert.equal(before,null);
  context.applyMaterialStateToObject(helper,{opacity:.9,transparent:false});helper.traverse(o=>{for(const m of o.material?[o.material].flat():[])assert.equal(m.opacity,.15);});
  context.applyMaterialStateToObject(mesh,{opacity:.4,transparent:true});assert.equal(context.getMaterialStateForObject(mesh).opacity,.4);
});
