// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createActuatorController} from '../scene-actuator.mjs';
import {mountActuatorControls} from '../scene-actuator-ui.mjs';
import {installRelativeNumberDrag} from '../scene-control-history.mjs';
const source=JSON.parse(readFileSync(new URL('../assets/assemblies/piston-arm.json',import.meta.url)));
class Element extends EventTarget {
 constructor(tag,doc){super();this.tagName=tag;this.ownerDocument=doc;this.children=[];this.style={};this.dataset={};this.value='';this.classList={add(){},remove(){}};}
 append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=nodes;}
 setAttribute(key,value){this[key]=value;} setPointerCapture(){} hasPointerCapture(){return false;}
 fire(type,props={}){const e=new Event(type,{cancelable:true});for(const [k,v] of Object.entries(props))Object.defineProperty(e,k,{value:v});this.dispatchEvent(e);return e;}
 focus(){this.ownerDocument.activeElement=this;this.fire('focus');this.fire('focusin');} blur(){this.ownerDocument.activeElement=null;this.fire('blur');} select(){} remove(){}
}
function fixture(){
 const doc=new Element('document');doc.defaultView=new Element('window');doc.createElement=tag=>new Element(tag,doc);
 const root=doc.createElement('root'),poses=structuredClone(source.actuators[0].reference),edits=createSceneEdits({read:id=>poses[id],write:(id,p)=>poses[id]=p});let ui;
 const api=createActuatorController({edits,readPose:id=>poses[id],writePoses:out=>Object.assign(poses,out),changed:()=>ui?.refresh()});api.restore(source.actuators);
 ui=mountActuatorControls({document:doc,root,api,edits,readObjects:()=>[],selectedId:()=>api.read()[0].barrelId,cancelPick(){},installNumberDrag:installRelativeNumberDrag});ui.refresh();
 const all=n=>[n,...n.children.flatMap(all)],input=name=>all(root).find(n=>n.dataset.actuator===name);
 const move=(field,dx=20)=>{field.fire('pointerdown',{button:0,pointerId:1,clientX:100,clientY:50});field.fire('pointermove',{pointerId:1,clientX:100+dx,clientY:50});};
 return {doc,root,poses,edits,api,ui,input,move};
}
test('numeric hand crank previews poses before release and records one undoable gesture',()=>{
 const f=fixture(),field=f.input('length'),before=structuredClone(f.poses),length=f.api.read()[0].length;
 try{f.move(field,-20);assert.notDeepEqual(f.poses,before,'arm must move during drag');assert.equal(f.edits.state().undoCount,0);field.fire('pointermove',{pointerId:1,clientX:70,clientY:50});field.fire('pointerup',{pointerId:1});assert.equal(f.edits.state().undoCount,1);const after=structuredClone(f.poses);f.edits.undo();assert.equal(f.api.read()[0].length,length);assert.deepEqual(f.poses,before);f.edits.redo();assert.deepEqual(f.poses,after);}finally{f.ui.dispose();}
});
for(const name of ['length','min','max','period','outward'])test(`${name} dragging and typing cancel to the accepted value without history`,()=>{
 const f=fixture(),field=f.input(name),before=structuredClone(f.poses),recipe=f.api.read(),value=field.value;
 try{
  f.move(field,name==='max'?-10:10);assert.notEqual(field.value,value);f.doc.fire('keydown',{key:'Escape'});assert.equal(field.value,value,'Escape restores displayed value');assert.deepEqual(f.poses,before);assert.deepEqual(f.api.read(),recipe);assert.equal(f.edits.state().undoCount,0);assert.equal(f.edits.state().active,null);
  field.focus();field.fire('beforeinput');field.value=String(Number(value)*.98);field.fire('input');f.doc.fire('keydown',{key:'Escape'});assert.equal(Number(field.value),Number(value));assert.deepEqual(f.api.read(),recipe);assert.deepEqual(f.poses,before);assert.equal(f.edits.state().undoCount,0);
 }finally{f.ui.dispose();}
});
test('a refused numeric gesture restores the value and releases dragging',()=>{
 const f=fixture(),field=f.input('length'),before=f.api.read();try{f.move(field,10000);field.fire('pointermove',{pointerId:1,clientX:110,clientY:50});field.fire('pointerup');assert.deepEqual(f.api.read(),before);assert.equal(Number(field.value),before[0].length);assert.equal(f.edits.state().active,null);assert.equal(f.edits.state().undoCount,0);}finally{f.ui.dispose();}
});
