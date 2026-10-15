// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createPolyEditMode} from '../poly-edit-mode.mjs';

function seamCube(){
  const sides=[[[1,0,0],[0,1,0],[0,0,1]],[[-1,0,0],[0,0,1],[0,1,0]],[[0,1,0],[0,0,1],[1,0,0]],[[0,-1,0],[1,0,0],[0,0,1]],[[0,0,1],[1,0,0],[0,1,0]],[[0,0,-1],[0,1,0],[1,0,0]]];
  const positions=[],normals=[],uvs=[],indices=[];
  sides.forEach(([n,u,v],k)=>{
    for(const [s,t] of [[0,0],[1,0],[1,1],[0,1]]){positions.push(...[0,1,2].map(i=>n[i]+(2*s-1)*u[i]+(2*t-1)*v[i]));normals.push(...n);uvs.push((k+s)/6,t);}
    indices.push(4*k,4*k+1,4*k+2,4*k,4*k+2,4*k+3);
  });
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);
  return g;
}
const canvas={getBoundingClientRect:()=>({left:0,top:0,width:400,height:400})};
const camera=new THREE.PerspectiveCamera(50,1,.01,100);camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
const root=new THREE.Group(),material=new THREE.MeshStandardMaterial(),mesh=new THREE.Mesh(seamCube(),material);root.add(mesh);root.updateMatrixWorld(true);
const screenOf=p=>{const v=new THREE.Vector3(...p).applyMatrix4(mesh.matrixWorld).project(camera);return [(v.x+1)/2*400,(1-v.y)/2*400];};

const edit=createPolyEditMode({camera,canvas});
assert.equal(edit.active(),false);
assert.throws(()=>edit.click(200,200),/Edit Mode/);
let state=edit.enter(root,{objectId:'mesh-cube'});
assert.deepEqual({editing:state.editing,objectId:state.objectId,mode:state.mode,counts:state.counts},{editing:true,objectId:'mesh-cube',mode:'vertex',counts:{vertices:0,edges:0,faces:0}});
assert.ok(mesh.children.length>0,'the overlay rides on the edited mesh');

// Face mode: the centre of the view is the front (+Z) side, faces 8 and 9.
edit.setMode('face');
state=edit.click(200,200);
assert.equal(state.counts.faces,1);
assert.ok([8,9].includes(state.active.index),`front face picked, got ${state.active.index}`);
state=edit.click(5,5);
assert.equal(state.counts.faces,0,'a click on nothing deselects');

// Vertex mode: a click near a corner picks that corner's welded vertex.
edit.setMode('vertex');
const [cx,cy]=screenOf([.9,.9,1]);
state=edit.click(cx,cy);
assert.equal(state.counts.vertices,1);
assert.deepEqual(edit.vertexPosition(state.active.index),[1,1,1]);
const [dx,dy]=screenOf([-.9,-.9,1]);
state=edit.click(dx,dy,{extend:true});
assert.equal(state.counts.vertices,2);assert.deepEqual(edit.vertexPosition(state.active.index),[-1,-1,1]);

// Box select over the whole view: only the four front corners are visible.
state=edit.box({x0:0,y0:0,x1:400,y1:400});
assert.equal(state.counts.vertices,4,'back corners are hidden behind the cube');
for(const v of edit.selectedVertices())assert.equal(edit.vertexPosition(v)[2],1);
state=edit.setThrough(true);
state=edit.box({x0:0,y0:0,x1:400,y1:400});
assert.equal(state.counts.vertices,8,'x-ray selects through');
edit.setThrough(false);

// Selection follows the object's actual placement.
root.position.set(1.5,0,0);root.updateMatrixWorld(true);
edit.setMode('face');
const [mx,my]=screenOf([0,0,1]);
state=edit.click(mx,my);
assert.ok([8,9].includes(state.active.index),'moved object: still the front face under the cursor');
state=edit.click(200-150,200);
assert.equal(state.counts.faces,0,'where the cube used to be is now empty');

// Select all and linked.
state=edit.selectAll('select');assert.equal(state.counts.faces,12);
state=edit.selectAll('deselect');assert.equal(state.counts.faces,0);
edit.click(mx,my);state=edit.linked();assert.equal(state.counts.faces,12,'Ctrl+L: the whole connected cube');
state=edit.selectAll('deselect');state=edit.linked({at:{x:mx,y:my}});assert.equal(state.counts.faces,12,'L at the cursor');
state=edit.selectAll('deselect');edit.click(mx,my);state=edit.linked({at:{x:mx,y:my}});assert.equal(state.counts.faces,12,'L over the active face grows from it instead of toggling it off');

// Exit removes everything Edit Mode added and leaves the object's material alone.
state=edit.exit();
assert.equal(state.editing,false);
assert.equal(mesh.children.length,0);
assert.equal(mesh.material,material);assert.equal(material.transparent,false);
assert.throws(()=>edit.setMode('face'),/Edit Mode/);
assert.throws(()=>edit.enter(new THREE.Group(),{objectId:'empty'}),/triangle mesh/);
