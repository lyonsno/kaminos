// kaminos-test: node
import assert from 'node:assert/strict';
import * as T from '../lib/three.core.js';
import * as copies from '../experiments/link-workshop/copy-geometry.mjs';
import {furnaceAssembly} from '../experiments/link-workshop/furnace.mjs';
assert.equal(typeof copies.mirrorBodyGeometry,'function','body geometry needs a reusable same-assembly mirror operation');
const source=furnaceAssembly(),before=JSON.stringify(source.geometry);
const packet=copies.mirrorBodyGeometry(source.geometry,{planeZ:-1.3,selections:[{id:'piston:0:barrel'}],positions:{'piston:0:barrel':.44}});
assert.equal(JSON.stringify(source.geometry),before,'source remains untouched');
assert.equal(packet.bodies.length,source.geometry.bodies.length,'same body identities, no extra assembly');
const old=new T.ObjectLoader().parse(source.geometry.bodies.find(b=>b.id==='piston:0:barrel').object),next=new T.ObjectLoader().parse(packet.bodies.find(b=>b.id==='piston:0:barrel').object);
old.updateMatrixWorld(true);next.updateMatrixWorld(true);
const meshes=[];next.traverse(o=>{if(o.isMesh)meshes.push(o);});
let count=0;old.traverse(o=>{if(!o.isMesh)return;const mirror=meshes.find(x=>x.name==='Mirror: '+o.uuid);assert(mirror);const a=o.geometry.attributes.position,b=mirror.geometry.attributes.position;for(let i=0;i<a.count;i++){const p=new T.Vector3().fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld),q=new T.Vector3().fromBufferAttribute(b,i);assert(Math.abs(p.x-q.x)<1e-6);assert(Math.abs(p.y-q.y)<1e-6);assert(Math.abs(q.z-(-2.6-2*.44-p.z))<1e-6);}count++;});assert(count>0);
assert.throws(()=>copies.mirrorBodyGeometry(source.geometry,{planeZ:NaN,selections:[{id:'piston:0:rod'}],positions:{}}),/plane/);
assert.throws(()=>copies.mirrorBodyGeometry(source.geometry,{planeZ:0,selections:[{id:'absent'}],positions:{}}),/Unknown/);
assert.throws(()=>copies.mirrorBodyGeometry(source.geometry,{planeZ:0,selections:[{id:'link:1',names:['absent']}],positions:{'link:1':.22}}),/selection/);
console.log('same-assembly reflection preserves source, identity and coordinates');
