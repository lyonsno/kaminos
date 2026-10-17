// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from '../lib/three.webgpu.js';
class Element{
 constructor(){this.children=[];this.style={};}
 append(...nodes){for(const node of nodes){node.remove?.();this.children.push(node);node.parent=this;}}
 prepend(node){node.remove?.();this.children.unshift(node);node.parent=this;}
 replaceChildren(){for(const child of [...this.children])child.remove();}
 remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
 setAttribute(){}
}
const document={createElement:()=>new Element(),createTextNode:text=>({text})},rows=[],seats=[];let tick,mounts=0,panels=0,lastPanel;
const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()),bear=new THREE.Group();bear.add(mesh);
const entry={id:'bear',object:bear};
const session={attach:async()=>({}),loadAsset:async()=>{rows.push(entry);return {id:entry.id,root:bear};},onFrame:cb=>{tick=cb;return ()=>{};},setView:()=>({}),readView:()=>({}),dispose:async()=>{}};
globalThis.__burnableUndoFactory={create:async()=>({read:()=>({}),operations:{frame(){}},mount({root}){const panel=new Element();lastPanel=panel;root.append(panel);panels++;return {dispose(){panel.remove();panels--;}};},dispose:async()=>{}})};
const file=new URL('../experiments/sinter/bear-altar.experiment.mjs',import.meta.url);
let code=await fs.readFile(file,'utf8');
code=code.replace("import liveLog from './live-log-heat.experiment.mjs';",'const liveLog=globalThis.__burnableUndoFactory;');
code=code.replaceAll(/from '([^']+)'/g,(_,relative)=>`from '${new URL(relative,file).href}'`);
const {default:experiment}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const host={scene:{open:async()=>session,objects:()=>rows,refreshPresentation(){},select(){}},controls:{document,mountObject(value){mounts++;seats.push(value);return {dispose(){value.properties.remove();value.playback.remove();}};}}};
const instance=await experiment.create({host,record(){}});instance.mount({root:new Element()});
assert.equal(mounts,1);assert.equal(panels,1);
rows.splice(rows.indexOf(entry),1);tick();rows.push(entry);tick();
assert.equal(mounts,2,'Undo must reseat controls on the same retained object');
assert.equal(panels,1,'Undo must reconnect exactly one active combustion panel');
assert.equal(seats.at(-1).properties.children.includes(lastPanel),true,'Restored seat owns the active combustion panel');
tick();assert.equal(mounts,2);await instance.dispose();delete globalThis.__burnableUndoFactory;
