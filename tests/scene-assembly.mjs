// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
const source=JSON.parse(fs.readFileSync(new URL('../assets/assemblies/piston-arm.json',import.meta.url)));
test('saving an observed working arm retains the mechanism, not only its displayed parts',()=>{
 const saved=buildSceneDocument(source),restored=planSceneRestore(saved);
 assert.deepEqual(restored.actuators,source.actuators);
 assert.ok(saved.version>12,'clients without actuator retention must refuse the document');
});

import {instantiateAssembly,remapActuators,assemblySelectionId,extractAssembly} from '../scene-assembly.mjs';
import {solveActuator} from '../scene-actuator.mjs';
let serial=0;const newId=kind=>kind+'-'+(++serial);
test('two additions own disjoint part and control identities, while retaining original provenance',()=>{
 const a=instantiateAssembly(source,{newId,position:[2,1,3]}),b=instantiateAssembly(source,{newId,position:[-2,0,0]});
 assert.equal(a.objects.length,24);assert.equal(a.groups.length,5);
 const names=new Set([...a.objects,...a.groups,...a.actuators].map(r=>r.id));assert.ok([...b.objects,...b.groups,...b.actuators].every(r=>!names.has(r.id)));
 assert.deepEqual(a.groups.at(-1).source,source.source);assert.equal(assemblySelectionId(a.objects[0].id,a.objects,a.groups),'@group:'+a.rootId);
 for(const instance of [a,b]){const r=instance.actuators[0],base=instance.groups.find(g=>'@group:'+g.id===r.fixedId);const output=solveActuator(r,r.drive.max,base.transform);assert.ok(Object.values(output.poses).flatMap(p=>p.position).every(Number.isFinite));}
});
test('save/reopen and cross-scene reuse retain controls and provenance without rebinding to the first arm',()=>{
 const a=instantiateAssembly(source,{newId,position:[3,0,1]});
 const restored=planSceneRestore(buildSceneDocument(a));
 assert.deepEqual(restored.groups.at(-1).assembly,a.groups.at(-1).assembly);
 const exported=extractAssembly(restored,a.rootId),b=instantiateAssembly(exported,{newId,position:[-3,0,0]});
 assert.deepEqual(b.groups.find(g=>g.id===b.rootId).source,a.groups.find(g=>g.id===a.rootId).source);
 const valid=new Set([...b.objects.map(o=>o.id),...b.groups.map(g=>'@group:'+g.id)]);
 for(const r of b.actuators)for(const id of Object.keys(r.reference))assert.ok(valid.has(id));
 assert.ok(!b.actuators.some(r=>a.actuators.some(old=>r.id===old.id)));
});
test('partial mechanism duplication and external attachments refuse before constructing a broken copy',()=>{
 const r=source.actuators[0];assert.throws(()=>remapActuators([r],new Map([[r.fixedId,'@group:copy']]),newId),/complete mechanism/);
 const a=instantiateAssembly(source,{newId});a.actuators[0].carried.push('outside');
 assert.throws(()=>extractAssembly(a,a.rootId),/outside/);
});
test('invalid assembly placement and unsupported file records are rejected explicitly',()=>{
 assert.throws(()=>instantiateAssembly(source,{newId,position:[0,NaN,0]}),/finite/);
 assert.throws(()=>instantiateAssembly({...source,objects:[{...source.objects[0],type:'glb'}]},{newId}),/procedural mesh/);
});
test('repeated reuse preserves one assembly root and places its origin at the requested point',()=>{
 let a=instantiateAssembly(source,{newId,position:[2,0,3]});assert.deepEqual(a.groups.find(g=>g.id===a.rootId).transform.position,[2,0,3]);
 for(let n=0;n<3;n++){a=instantiateAssembly(extractAssembly(a,a.rootId),{newId,position:[n,1,2]});assert.equal(a.groups.length,5);assert.deepEqual(a.groups.find(g=>g.id===a.rootId).transform.position,[n,1,2]);}
});
test('an imported assembly cannot silently discard a mechanism with absent attachment identities',()=>{
 const bad=structuredClone(source);for(const r of bad.actuators){const map=new Map(Object.keys(r.reference).map(id=>[id,'missing:'+id]));r.reference=Object.fromEntries(Object.entries(r.reference).map(([id,p])=>[map.get(id),p]));for(const k of ['fixedId','followerId','barrelId','rodId'])r[k]=map.get(r[k]);}
 assert.throws(()=>instantiateAssembly(bad,{newId}),/attachment/);
});
