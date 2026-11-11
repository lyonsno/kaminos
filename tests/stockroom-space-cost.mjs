// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import * as T from '../lib/three.core.js';
import {compileNeighborBoxes,compileNeighborField} from '../stockroom-space-context.mjs';
import {defaultSpace,createSpace,rebuildSpace} from '../stockroom-space.mjs';
import {prepareNavigationGeometry} from '../scene-navigation.mjs';
const boxes=Array.from({length:75},(_,i)=>({matrix:new T.Matrix4().compose(new T.Vector3(i*2,1,0),new T.Quaternion().setFromEuler(new T.Euler(0,i*.13,.07)),new T.Vector3(.7,1.3,.9)).toArray(),min:[-.5,-.5,-.5],max:[.5,.5,.5]}));
test('neighbor broad phase retains the full field for rotated, scaled and sheared construction',()=>{
 const shear={...boxes[0],matrix:new T.Matrix4().set(1,.7,0,3,0,1,.2,1,.1,0,1,-1,0,0,0,1).toArray()},input=[...boxes,shear],fields=compileNeighborBoxes(input),evaluate=compileNeighborField(input);
 for(let x=-2;x<155;x+=2.7)for(let y=-1;y<4;y+=.8)for(const z of [-2,-.3,0,.4,2])for(const solid of [-2,-.05,0,.4,3]){
  const expected=fields.reduce((value,d)=>Math.max(value,-d(x,y,z)),solid);assert.equal(evaluate(x,y,z,solid),expected);
 }
});
test('far construction does not require evaluating every box at every sample',()=>{
 const metrics={boxTests:0},evaluate=compileNeighborField(boxes,metrics);let samples=0;
 for(let x=-1;x<5;x+=.2)for(let y=-1;y<4;y+=.2){evaluate(x,y,0,-.15);samples++;}
 assert.ok(metrics.boxTests<samples*boxes.length/4,`${metrics.boxTests} exact box tests for ${samples} samples still scans the whole construction`);
});
test('unchanged extracted vertex count reuses compact render geometry and buffers',()=>{
 const p={...defaultSpace(),resolution:16},root=createSpace(p),mesh=root.children[0],geometry=mesh.geometry,position=geometry.attributes.position;
 rebuildSpace(root,p);assert.equal(mesh.geometry,geometry);assert.equal(mesh.geometry.attributes.position,position);assert.equal(position.count,mesh.count);assert.equal(position.array.length,mesh.count*3);
});
test('reused vertex storage invalidates the native picking index before another raycast',async()=>{
 const p={...defaultSpace(),resolution:16},root=createSpace(p),mesh=root.children[0],positions=mesh.geometry.attributes.position;root.updateMatrixWorld(true);
 const triangle=new T.Triangle(...[0,1,2].map(i=>new T.Vector3().fromBufferAttribute(positions,i))),point=triangle.getMidpoint(new T.Vector3()).applyMatrix4(mesh.matrixWorld),normal=triangle.getNormal(new T.Vector3()).applyNormalMatrix(new T.Matrix3().getNormalMatrix(mesh.matrixWorld));
 const ray=new T.Raycaster(point.clone().addScaledVector(normal,2),normal.clone().negate());assert.ok(ray.intersectObject(root,true).length>0,'baseline ray must hit actual concrete');
 await prepareNavigationGeometry(root);assert.ok(mesh.geometry.boundsTree);
 rebuildSpace(root,p);assert.ok(!mesh.geometry.boundsTree,'native picking must not use the preceding vertex index');root.updateMatrixWorld(true);
 assert.ok(ray.intersectObject(root,true).length>0);
});
