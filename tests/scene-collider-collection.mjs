import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createSceneColliderCollection} from '../scene-collider.mjs';
import {trianglesFromSceneObject,sceneSolidRevision} from '../volume-scene-solid.mjs';
const record=(id,object,enabled=true)=>({id,type:'procedural-mesh',object,collision:{domainId:'flame-field',enabled}});
const mesh=()=>new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5),new THREE.MeshBasicMaterial());
test('chosen obstacles supply actual world triangles without reparenting or changing source geometry',()=>{
 const parent=new THREE.Group(),a=mesh(),b=mesh();parent.position.set(.5,1,.25);parent.scale.set(2,1,1);parent.add(a);a.position.x=.25;b.position.set(-.5,0,0);
 const collection=createSceneColliderCollection(THREE),first=collection.update([record('a',a),record('b',b,false)]);
 assert.deepEqual(first.memberIds,['a']);assert.equal(first.object.children.length,1);assert.equal(a.parent,parent);
 assert.equal(first.objects[0].object.children[0].geometry,a.geometry);assert.deepEqual(trianglesFromSceneObject(first.object).triangles,trianglesFromSceneObject(a).triangles);
 const before=sceneSolidRevision(first.object);const second=collection.update([record('a',a),record('b',b,false)]);
 assert.equal(second.object,first.object);assert.equal(sceneSolidRevision(second.object),before,'unchanged membership/materials must retain the geometry revision');
 a.position.x=.5;collection.update([record('a',a)]);assert.notEqual(sceneSolidRevision(first.object),before);assert.equal(a.parent,parent);
});
test('multiple marked objects remain distinct meshes and hidden or editor helpers do not enter the mask',()=>{
 const a=mesh(),b=mesh(),helper=mesh();a.add(helper);helper.userData.kaminosEditorHelper=true;
 const collection=createSceneColliderCollection(THREE),both=collection.update([record('a',a),record('b',b)]);
 assert.deepEqual(both.memberIds,['a','b']);assert.equal(both.object.children.length,2);assert.equal(trianglesFromSceneObject(both.object).triangles.length,24);
 b.visible=false;assert.deepEqual(collection.update([record('a',a),record('b',b)]).memberIds,['a']);
 assert.equal(collection.update([record('a',a,false)]),null);assert.equal(collection.state().meshCount,0);assert.equal(a.geometry.getAttribute('position').count,24);
});
