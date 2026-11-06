// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import {createProceduralMesh,checkedProceduralMesh} from '../scene-geometry.mjs';
function exercise(source){
 const body=source.slice(source.indexOf('function mountProceduralMesh(raw) {'),source.indexOf('\nfunction readBurnerGraph()',source.indexOf('function mountProceduralMesh(raw) {')));
 const geometry={kind:'box',parameters:{width:1,height:1,depth:1}},record={id:'owned',type:'procedural-mesh',source:'kaminos:geometry',geometry,surface:{color:'#998877',roughness:.5,metalness:0},transform:{position:[1,2,3],rotation:[0,0,0],scale:[1,1,1]}};
 const instance=createProceduralMesh(THREE,null,geometry,record.surface),root=instance.group;root.userData.kaminosMountedWorkshop=true;
 const scene=new THREE.Scene(),frame=new THREE.Group();scene.add(frame);frame.add(root);const objects=[{...record,object:root}];
 const sandbox={THREE,createProceduralMesh,checkedProceduralMesh,mergeGeometries:null,workingScene:{objects},proceduralMeshes:new Map([['owned',instance]]),scene,sceneMembership:{admit(entry){objects[0]=entry;}},applySceneObjectTransformState(root,p){root.position.fromArray(p.position);root.rotation.set(...p.rotation);root.scale.fromArray(p.scale);},currentMesh:null,transformControls:null};
 vm.runInNewContext(body+'\nthis.mount=mountProceduralMesh;',sandbox);
 const next=sandbox.mount({...record,geometry:{kind:'box',parameters:{width:2,height:1,depth:1}}});
 assert.equal(next.object,root,'temporary native geometry edits retain the registered root');assert.equal(root.parent,frame,'native edit keeps the presentation frame');assert.deepEqual(root.position.toArray(),[1,2,3]);assert.equal(root.geometry.parameters.width,2);assert.equal(objects[0].object,root);sandbox.proceduralMeshes.get('owned').dispose();assert.equal(root.parent,null);
}
test('temporary native geometry edits preserve session root and frame',()=>exercise(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8')));
