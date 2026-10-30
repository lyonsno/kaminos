// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRawFieldMesh} from '../trellis-raw-mesh.mjs';
test('raw triangles preserve positions, normals and opacity without finishing',()=>{
 const data=new Float32Array([0,0,0,0,0,1,1,.5,0,.1,.2,.3, 1,0,0,0,0,1,0,1,0,0,.8,1, 0,1,0,0,0,1,0,0,1,0,.8,.5]);
 const c=createRawFieldMesh(data,new Uint32Array([0,1,2]),{count:3,stride:12,triangles:{count:1}});
 assert.deepEqual([...c.root.geometry.index.array],[0,1,2]);
 assert.equal(c.root.geometry.getAttribute('position').getX(1),1);
 assert.ok(Math.abs(c.root.geometry.getAttribute('rawOpacity').getX(0)-.3)<1e-6);
 for(const mode of ['plain','normals','glass']){c.set({mode});assert.equal(c.read().mode,mode);}
 c.set({mode:'normals'});assert.equal(c.root.material.fragmentNode,null,'normal diagnostics must preserve renderer MRT outputs');assert.equal(c.root.material.lights,false);
 assert.throws(()=>createRawFieldMesh(data,new Uint32Array([0,1,4]),{count:3,stride:12,triangles:{count:1}}));
 c.dispose();
});
