// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {ClippingGroup,Mesh,BufferGeometry,MeshStandardMaterial,Group,Vector3} from '../lib/three.webgpu.js';
// Production strip keeps its mask/geometry intact; the renderer clips only the
// displayed aperture. All glyph rows travel through that aperture in order.
import {createKilnPromptStrip} from '../kiln-prompt-strip.mjs';

test('full admitted strip feeds through an aperture carried by the native frame',()=>{
 const parent=new Group(),root=new ClippingGroup(),mesh=new Mesh(new BufferGeometry(),new MeshStandardMaterial());parent.add(root);root.add(mesh);
 root.position.set(1.2,2.46,-3.4);root.rotation.y=-.15;root.scale.setScalar(1.75);
 const strip=createKilnPromptStrip({root,mesh,windowHeight:520});strip.prepare(1240,400);const draftY=mesh.position.y;
 assert.equal(draftY,(520-1240+800)/1024);strip.admit();assert.equal(mesh.position.y,(520-1240)/1024,'admission begins at the first glyph row');
 strip.advance(.5);assert.equal(mesh.position.y,0);strip.advance(.25);assert.equal(mesh.position.y,0,'physical strip does not run backwards');strip.advance(1);assert.equal(mesh.position.y,(1240-520)/1024);
 assert.equal(strip.read().height,1240,'full text is retained');assert.equal(root.clippingPlanes.length,2);
 for(const frame of [{x:0,s:1},{x:4,s:.0494}]){
  parent.position.x=frame.x;parent.scale.setScalar(frame.s);strip.sync();
  const center=root.localToWorld(new Vector3(0,0,0)),above=root.localToWorld(new Vector3(0,521/1024,0)),below=root.localToWorld(new Vector3(0,-521/1024,0));
  assert.ok(root.clippingPlanes.every(p=>p.distanceToPoint(center)>0));assert.ok(root.clippingPlanes.some(p=>p.distanceToPoint(above)<0));assert.ok(root.clippingPlanes.some(p=>p.distanceToPoint(below)<0));
 }
 strip.release(80);assert.equal(mesh.position.y,(520-1240+160)/1024);assert.equal(strip.read().admitted,false);
 mesh.geometry.dispose();mesh.material.dispose();
});
