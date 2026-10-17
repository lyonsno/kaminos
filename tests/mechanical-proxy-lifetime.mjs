// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {installMechanicalProxy} from '../mechanical-proxy-tool.mjs';

class Element {
 constructor(){this.value='';this.dataset={};this.children=[];this.open=false;}
 querySelector(selector){const name=selector.match(/data-mp="([^"]+)"/)[1];return(this.fields??=new Map()).get(name)??this.field(name);}
 field(name){const element=new Element();element.value=({envelope:'.05',spacing:'.1',budgetSeconds:'5'})[name]??'';this.fields.set(name,element);return element;}
 querySelectorAll(){return[];}
 append(child){this.children.push(child);}
 replaceChildren(...children){this.children=children;}
 setAttribute(){}
 addEventListener(){}
 remove(){}
}
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};};
const result=(id,sourceDigest)=>({id,status:'passed',sourceDigest,settings:{envelope:.01,spacing:.1,budgetSeconds:5},mesh:{status:'passed',route:'kaminos.mechanical-proxy.wildmeshing.v1',sourceDigest,settings:{envelope:.01,spacing:.1,budgetSeconds:5},diagonal:2,positions:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetrahedra:[[0,1,2,3]],volume:1/6}});
const a={id:'A',object:new THREE.Mesh(new THREE.BoxGeometry())},b={id:'B',object:new THREE.Mesh(new THREE.BoxGeometry())};
let selected=a,handler;
globalThis.fetch=async(url,options)=>{const response=handler(url,options?.body?JSON.parse(options.body):null);return{ok:true,json:()=>response};};
const listeners=new Set();
const scene=new THREE.Scene(),canvas={addEventListener(name,callback){listeners.add(callback);},removeEventListener(name,callback){listeners.delete(callback);}},panelHost=new Element();
const tool=installMechanicalProxy({document:{createElement:()=>new Element(),getElementById:()=>panelHost},scene,camera:new THREE.PerspectiveCamera(),canvas,selected:()=>selected,redraw(){}});
const lateA=deferred();
handler=(url,body)=>body?.action==='inspect'?(body.input.source.id==='A'?lateA.promise:{sourceDigest:'b'.repeat(64),diagonal:2}):{results:[]};
const first=tool.open();tool.close();selected=b;await tool.open();lateA.resolve({sourceDigest:'a'.repeat(64),diagonal:2});await first;
assert.equal(tool.read().sourceDigest,'b'.repeat(64),'late inspection must not replace the current selected source');
const lateResult=deferred();handler=url=>url.includes('result=1')?lateResult.promise:{results:[]};
const loading=tool.selectResult('a'.repeat(32));tool.close();selected=a;
handler=(url,body)=>body?.action==='inspect'?{sourceDigest:'a'.repeat(64),diagonal:2}:{results:[]};await tool.open();lateResult.resolve(result('a'.repeat(32),'b'.repeat(64)));await loading;
assert.equal(tool.read().resultId,null,'closed result load must not publish into another inspection');
handler=url=>url.includes('result=1')?result('c'.repeat(32),'a'.repeat(64)):{results:[]};await tool.selectResult('c'.repeat(32));
assert.equal(panelHost.children[0].querySelector('[data-mp="results"]').value,'c'.repeat(32));
assert.equal(panelHost.children[0].querySelector('[data-mp="envelope"]').value,'0.01');
assert.equal(tool.read().resultSource,'retained','reopened or selected output must identify retained data');
let boundary;scene.traverse(o=>{if(o.isMesh&&o.material.isMeshStandardMaterial)boundary=o;});
assert.equal(boundary.parent.isClippingGroup,true,'effective WebGPU boundary requires ClippingGroup ancestry');
assert.equal(boundary.parent.clippingPlanes.length,1);
globalThis.location={search:''};a.object.position.z=3;a.object.updateMatrixWorld();tool.refresh();
assert.equal(scene.children[0].matrix.elements[14],3,'inspection must follow an ordinary source-object transform');
assert.equal(boundary.parent.clippingPlanes[0].constant,3.5,'world clipping plane must follow the transformed inspection');
tool.close();selected=a;const rejectedGenerate=deferred(),flush=()=>new Promise(setImmediate);
handler=(url,body)=>body?.action==='inspect'?{sourceDigest:'a'.repeat(64),diagonal:2}:{results:[]};await tool.open();
handler=(url,body)=>body?.action==='generate'?rejectedGenerate.promise:{results:[]};panelHost.children[0].querySelector('[data-mp="generate"]').onclick();await flush();
tool.close();selected=b;handler=(url,body)=>body?.action==='inspect'?{sourceDigest:'b'.repeat(64),diagonal:2}:{results:[]};await tool.open();
handler=(url,body)=>body?.action==='generate'||url.includes('?id=')?{id:'d'.repeat(32),jobId:'queue-B',status:'pending'}:{results:[]};panelHost.children[0].querySelector('[data-mp="generate"]').onclick();await flush();
assert.equal(tool.read().status,'pending');rejectedGenerate.reject(Error('old A failed'));await flush();
assert.equal(tool.read().status,'pending','stale Generate rejection must not poison the next inspection');
assert.equal(panelHost.children[0].querySelector('[data-mp="generate"]').disabled,true);
assert.equal(panelHost.children[0].querySelector('[data-mp="cancel"]').disabled,false);
tool.close();
let scheduled;const savedTimeout=globalThis.setTimeout,savedClear=globalThis.clearTimeout;globalThis.setTimeout=fn=>{scheduled=fn;return 1;};globalThis.clearTimeout=()=>{};
try{
 selected=a;handler=(url,body)=>body?.action==='inspect'?{sourceDigest:'a'.repeat(64),diagonal:2}:{results:[]};await tool.open();
 const pendingA={id:'a'.repeat(32),jobId:'queue-A',status:'pending'},oldPoll=deferred();let polls=0;
 handler=(url,body)=>body?.action==='generate'?pendingA:url.includes('?id=')?(++polls===1?pendingA:oldPoll.promise):{results:[]};
 panelHost.children[0].querySelector('[data-mp="generate"]').onclick();await flush();scheduled();await flush();tool.close();selected=b;
 handler=(url,body)=>body?.action==='inspect'?{sourceDigest:'b'.repeat(64),diagonal:2}:{results:[]};await tool.open();
 handler=(url,body)=>body?.action==='generate'||url.includes('?id=')?{id:'d'.repeat(32),jobId:'queue-B',status:'pending'}:{results:[]};panelHost.children[0].querySelector('[data-mp="generate"]').onclick();await flush();oldPoll.reject(Error('old A poll failed'));await flush();
 assert.equal(tool.read().status,'pending','stale poll rejection must not poison the next inspection');
 assert.equal(panelHost.children[0].querySelector('[data-mp="generate"]').disabled,true);
}finally{tool.close();globalThis.setTimeout=savedTimeout;globalThis.clearTimeout=savedClear;}
tool.dispose();assert.equal(scene.children.length,0);assert.equal(listeners.size,0,'disposed inspection must release its input listeners');
console.log('mechanical proxy async ownership and clipping contracts pass');
