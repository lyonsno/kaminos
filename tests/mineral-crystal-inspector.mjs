// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountCrystalInspector} from '../mineral-worlds/crust-inspector.mjs';
import {createCrystalObject} from '../mineral-worlds/crust-object.mjs';
import {checkedCrystalSnapshot} from '../mineral-worlds/crust-record.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {installSceneControlHistory} from '../scene-control-history.mjs';
class Element extends EventTarget{
 constructor(tag){super();this.tagName=tag.toUpperCase();this.style={};this.children=[];this.attributes={};}
 append(...nodes){for(const n of nodes){n.parentNode?.remove(n);n.parentNode=this;this.children.push(n);}}
 remove(node){this.children=this.children.filter(n=>n!==node);}
 get lastChild(){return this.children.at(-1);}
 replaceChildren(){this.children=[];}
 setAttribute(k,v){this.attributes[k]=v;}
 fire(type,props={}){const e=new Event(type,{cancelable:true});for(const[k,v]of Object.entries(props))Object.defineProperty(e,k,{value:v});this.dispatchEvent(e);this['on'+type]?.(e);}
}
function setup(){
 const nodes=[],document={activeElement:null,createElement:tag=>{const e=new Element(tag);nodes.push(e);return e;},createTextNode:text=>({textContent:text})},root=new Element('section');
 const runtime=createCrystalObject(),edits=createSceneEdits({read:()=>null,write(){}}),targets=new Set();
 // Exercise the application adapter itself, including its real scene edit service.
 const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function invokeNativeCrystal('),source.indexOf('function syncNativeCrystalInspector('));
 const ensure=id=>{const target='@crystal:'+id;if(!targets.has(target)){edits.register(target,{read:()=>runtime.snapshot(),check:checkedCrystalSnapshot,write:v=>runtime.invoke('restore',v)});targets.add(target);}return target;};
 const invoke=Function('assertSceneConstructionAvailable','nativeCrystal','syncVolumeViewerPlay','scenePlacementTools','crystalEditTargets','checkedCrystalSnapshot','syncNativeCrystalInspector','selectedSceneObjectEntry','ensureCrystalEditTarget',fn+';return invokeNativeCrystal;')(()=>{},()=>runtime,()=>{},{edits},targets,checkedCrystalSnapshot,()=>{},()=>null,ensure);
 let installed=0,disposed=0;const mount=()=>mountCrystalInspector({document,root,read:runtime.read,invoke:(op,v)=>invoke('one',op,v),installNumberDrag:()=>{installed++;return{dispose(){disposed++;}};},installControlHistory:(controls,onError)=>installSceneControlHistory({controls,edits,id:()=>ensure('one'),onError})});
 return {nodes,document,root,runtime,edits,mount,counts:()=>({installed,disposed})};
}
test('repeated crystal inspector mounts release every drag handle exactly once',()=>{
 const f=setup();try{for(let i=0;i<3;i++){const panel=f.mount();panel.dispose();panel.dispose();}assert.deepEqual(f.counts(),{installed:27,disposed:27});}finally{f.runtime.dispose();}
});
test('numeric crystal gesture previews commit once, undo wholly, and Escape cancels',()=>{
 const f=setup(),panel=f.mount();try{
  const input=f.nodes.find(n=>n.attributes['aria-label']==='Brine feed');const before=f.runtime.snapshot();
  f.document.activeElement=input;input.fire('focusin');for(const v of [.03,.04,.05]){input.value=String(v);input.fire('input');}input.fire('change');
  assert.equal(f.runtime.read().settings.feed,.05);assert.equal(f.edits.state().undoCount,1);f.edits.undo();assert.deepEqual(f.runtime.snapshot(),before);
  input.fire('focusin');input.value='.07';input.fire('input');input.fire('keydown',{key:'Escape'});assert.deepEqual(f.runtime.snapshot(),before);assert.equal(f.edits.state().undoCount,0);assert.equal(f.edits.state().active,null);
 }finally{panel.dispose();f.runtime.dispose();}
});
