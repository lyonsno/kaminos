// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../lib/three.webgpu.js';
import {createSurfaceSplatObject} from '../surface-splat-object.mjs';
import {createFireShadowCasters} from '../fire-shadow-casters.mjs';
import {renderFireShadowBatch} from '../fire-light-field-shadow.mjs';
test('flame shadow capture uses proxy triangles at the authored transform and restores beauty',()=>{
 const scene=new T.Scene(),source=new T.Mesh(new T.BoxGeometry(.6,.4,.2),new T.MeshStandardMaterial());source.castShadow=true;
 const object=createSurfaceSplatObject(source,{data:new Float32Array([0,0,0,0,0,1,.8,.3,.1,0,.5,1]),meta:{count:1,stride:12,radius:.03},footprints:new Float32Array([1,0,0,.06,0,1,0,.06])});scene.add(object);object.position.set(.1,.2,.3);
 const casters=createFireShadowCasters({scene});let seen=false;
 renderFireShadowBatch({scene,casterScene:casters,shadows:[{render(batch){seen=true;assert.equal(batch.triangleCount,12);assert.equal(batch.casters.length,1);assert.equal(batch.casters[0].material.visible,true);assert.equal(batch.casters[0].geometry,source.geometry);assert.deepEqual(batch.casters[0].matrixWorld.elements.slice(12,15),[.1,.2,.3]);}}]});
 assert.equal(seen,true);assert.equal(object.visible,true);assert.equal(object.proxy.material.visible,false);
 assert.throws(()=>casters.withCapture(()=>{throw Error('capture failed');}),/capture failed/);assert.equal(object.visible,true);assert.deepEqual(scene.children,[object]);
 casters.dispose();object.dispose();
});
