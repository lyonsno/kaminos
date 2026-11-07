// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {Scene,Group,Mesh,BoxGeometry,MeshBasicMaterial} from '../lib/three.core.js';
import {createMountedWorkshopMembership} from '../mounted-workshop-membership.mjs';
test('native Delete detaches a mounted child, Undo restores its retained presentation parent',()=>{
 const scene=new Scene(),frame=new Group(),root=new Mesh(new BoxGeometry(),new MeshBasicMaterial());scene.add(frame);frame.add(root);root.userData.kaminosMountedWorkshop=true;
 const entry={id:'part',object:root},m=createMountedWorkshopMembership({scene});m.detach(entry);assert.equal(root.parent,null,'Delete must detach from the actual presentation parent');m.attach(entry,e=>scene.add(e.object));assert.equal(root.parent,frame,'Undo retains the presentation frame');m.detach(entry);m.attach(entry,e=>scene.add(e.object));assert.equal(root.parent,frame,'Redo/Undo remains coherent');
});
test('ordinary members use the existing mount operation',()=>{const scene=new Scene(),root=new Group(),entry={object:root};scene.add(root);const m=createMountedWorkshopMembership({scene});m.detach(entry);let calls=0;m.attach(entry,e=>{calls++;scene.add(e.object);});assert.equal(calls,1);assert.equal(root.parent,scene);});
