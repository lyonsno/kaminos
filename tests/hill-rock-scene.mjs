// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRockScene} from '../experiments/hill-terrain/rock-scene.mjs';
test('rendered rock vertices and normals come from the query solids, with deterministic rebuilds',()=>{
 const scene=createRockScene(),source=scene.source();
 assert.equal(scene.root.children.length,source.solids.length);
 for(let i=0;i<source.solids.length;i++){
  assert.deepEqual(scene.root.children[i].geometry.attributes.position.array,Float32Array.from(source.solids[i].positions));
  assert.deepEqual(scene.root.children[i].geometry.attributes.normal.array,Float32Array.from(source.solids[i].normals));
 }
 const original=scene.source();assert.throws(()=>scene.rebuild({gap:Infinity}),/dimensions/);assert.equal(scene.source(),original);
 const old=[...scene.root.children],disposed=[];old.forEach(m=>m.geometry.addEventListener('dispose',()=>disposed.push(m)));
 scene.rebuild({gap:.04});assert.equal(disposed.length,old.length);assert.equal(scene.read().gap,.04);
 assert.notDeepEqual(scene.source(),original);
 const children=[...scene.root.children];children.forEach(m=>m.geometry.addEventListener('dispose',()=>disposed.push(m)));
 scene.dispose();assert.equal(disposed.length,old.length+children.length);
});
