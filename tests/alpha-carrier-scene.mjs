// kaminos-test: node
import assert from 'node:assert/strict';
import {Box3,Vector3} from '../lib/three.webgpu.js';
import {createAlphaObject,createAlphaReference,childUrl} from '../alpha-carrier-scene.mjs';
const h=new Float32Array([2,3,4,1,0,0,0,1,0,0,0,1,.5,.25,0,0]);
const level={headers:h,meta:{count:1,sourceCount:8,sourceSHA256:'source',patchesSHA256:'patch'}};
const object=createAlphaObject(level,'analytic');
assert.equal(object.root.isInstancedMesh,true);assert.equal(object.root.count,1);
const box=new Box3().setFromObject(object.root);
assert.deepEqual(box.min.toArray(),[1.5,2.75,4]);assert.deepEqual(box.max.toArray(),[2.5,3.25,4]);
assert.equal(object.read().decoderCallsPerShadedFragment,0);assert.ok(object.root.userData.kaminosAODepthMaterial);object.dispose();
assert.throws(()=>createAlphaObject(level,'learned'),/analytical support only/);
assert.throws(()=>createAlphaObject(level,'other'),/Unknown/);
const source={rows:new Float32Array([2,3,4,0,0,1,1,1,1,0,1,1]),meta:{count:1,radius:.1},sha:'s'};
const reference=createAlphaReference(source);assert.equal(reference.root.geometry.attributes.position.count,4);
assert.ok(new Box3().setFromObject(reference.root).containsPoint(new Vector3(2,3,4)));reference.dispose();
assert.equal(childUrl('http://localhost/api/read?root=generated-meshes&path=grass%2F','4000/').searchParams.get('path'),'grass/4000/');
console.log('Native plane bounds, AO support, single-call contract and source URL composition pass');
