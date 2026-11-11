// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from '../lib/three.core.js';
import {collectSpaceNeighborhood,nearestSpaceBoundary,compileNeighborBoxes} from '../stockroom-space-context.mjs';
import {defaultSpace,pullSpace,compileSpace,createSpace,rebuildSpace,SPACE_SOURCE} from '../stockroom-space.mjs';
import {createSceneRepetitionController} from '../scene-repetition-controller.mjs';
import {repetitionDefaults,isRepetitionCopy} from '../scene-repetition.mjs';
const fixture=()=>{const root=new THREE.Group(),box=new THREE.Mesh(new THREE.BoxGeometry(2,.2,2));box.position.set(0,1.9,0);box.updateMatrixWorld(true);return {root,box,entries:[{id:'ceiling',object:box,type:'procedural-mesh',geometry:{kind:'box'}}]};};
test('live native geometry resolves a named neighbor and supplies a pre-click surface normal',()=>{
 const {root,entries}=fixture(),context=collectSpaceNeighborhood(root,{neighbors:['ceiling']},entries);
 assert.equal(context.unavailable.length,0);assert.equal(context.boxes.length,1);
 const nearest=nearestSpaceBoundary(context,[0,1.6,0]);assert.equal(nearest.id,'ceiling');assert.ok(nearest.normal[1]<-.999);assert.ok(Math.abs(nearest.point[1]-1.8)<1e-6);
});
test('neighbor movement changes the effective constraint rather than only its metadata',()=>{
 const {root,box,entries}=fixture(),p={...defaultSpace(),neighbors:['ceiling']},a=collectSpaceNeighborhood(root,p,entries);
 const before=compileNeighborBoxes(a.boxes);assert.ok(before.some(d=>d(0,1.9,0)<0));
 box.position.x=4;const b=collectSpaceNeighborhood(root,p,entries),after=compileNeighborBoxes(b.boxes);assert.notEqual(a.signature,b.signature);assert.ok(after.every(d=>d(0,1.9,0)>0));
});
test('new kept-empty claims bring surrounding material into an absent region',()=>{
 const p=defaultSpace(),q=pullSpace(p,{point:[5,0,0],axis:[0,1,0],radius:.7,bandNormal:[0,0,1]},1,'empty');
 assert.equal(q.claims.at(-1).rim,true);assert.equal(q.claims.at(-1).radii[0],.7);
 const distance=compileSpace(q);assert.ok(distance(5.8,.5,0)<0,'new empty claim must create its own bearing');assert.ok(distance(5,.5,0)>0);
});
test('the actual concrete field respects a native neighbor and changes when it moves',()=>{
 const {root,box,entries}=fixture(),p={...defaultSpace(),neighbors:['ceiling']},a=collectSpaceNeighborhood(root,p,entries);
 assert.ok(compileSpace(defaultSpace())(.8,1.9,0)<0);assert.ok(compileSpace(p,a)(.8,1.9,0)>.01,'concrete must not occupy the ceiling');
 box.position.x=4;const b=collectSpaceNeighborhood(root,p,entries);assert.ok(compileSpace(p,b)(.8,1.9,0)<-.01,'moving ceiling must release its actual constraint');
});
for(const mode of ['object','group'])test(`unresolved construction withholds ${mode} repeated concrete and restoration refreshes it`,()=>{
 const {entries}=fixture(),p={...defaultSpace(),resolution:16,neighbors:['ceiling']},root=createSpace(p),repetition={...repetitionDefaults(),mode:'line',count:2,step:[6,0,0]};
 const pose=o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()}),entry={id:'place',object:root,type:'pbr',source:SPACE_SOURCE,space:p,repetition:mode==='object'?repetition:null};
 const groups=mode==='group'?[{id:'assembly',objectIds:['place'],transform:pose(root),repetition}]:[],controller=createSceneRepetitionController({objects:()=>[entry],groups:()=>groups,readPose:pose});
 const resolved=collectSpaceNeighborhood(root,p,entries);rebuildSpace(root,p,resolved);controller.sync();
 const source=()=>root.children.find(c=>c.userData.spaceSurface),copy=()=>root.children.find(isRepetitionCopy).children[0];assert.equal(source().visible,true);assert.equal(copy().visible,true);assert.ok(source().count>0,'the visible fixture must contain rendered concrete');
 const previous=source().geometry,version=previous.attributes.position.version;rebuildSpace(root,p,collectSpaceNeighborhood(root,p,[]));controller.sync();assert.equal(source().visible,false);assert.equal(copy().visible,false,'unresolved repeated concrete must not remain visible');
 rebuildSpace(root,p,resolved);controller.sync();assert.equal(source().visible,true);assert.equal(copy().visible,true);assert.ok(source().geometry!==previous||source().geometry.attributes.position.version>version,'restoration must publish current vertex data');assert.equal(copy().geometry,source().geometry);controller.clearAll();
});
