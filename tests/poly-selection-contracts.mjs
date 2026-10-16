// kaminos-test: node
import assert from 'node:assert/strict';
import {buildPolyMesh} from '../poly-mesh-core.mjs';
import {createComponentSelection,setSelectMode,clickComponent,selectAll,boxSelect,selectLinkedComponents,selectedFaces,selectionCounts} from '../poly-selection.mjs';

// 2 x 1 quads: vertices 0..5 in a row of three columns, four triangles.
//  3---4---5
//  | / | / |
//  0---1---2
const strip=buildPolyMesh({positions:Float32Array.of(0,0,0,1,0,0,2,0,0,0,1,0,1,1,0,2,1,0),indices:Uint32Array.of(0,1,4,0,4,3,1,2,5,1,5,4)});
const on=mask=>[...mask.keys()].filter(i=>mask[i]);
const vertexIndex=(mesh,r)=>mesh.renderVertexToVertex[r];

let s=createComponentSelection(strip);
assert.equal(s.mode,'vertex');
assert.deepEqual(selectionCounts(s),{vertices:0,edges:0,faces:0});

// Click replaces; Shift adds and makes active; Shift on the active one deselects it.
s=clickComponent(s,strip,{kind:'vertex',index:vertexIndex(strip,0)});
s=clickComponent(s,strip,{kind:'vertex',index:vertexIndex(strip,1)},{extend:true});
s=clickComponent(s,strip,{kind:'vertex',index:vertexIndex(strip,4)},{extend:true});
assert.deepEqual(s.active,{kind:'vertex',index:vertexIndex(strip,4)});
assert.deepEqual(on(selectedFaces(s,strip)),[0],'the face whose three vertices are selected');
assert.equal(selectionCounts(s).edges,3,'edges flush from vertices: both ends selected');
s=clickComponent(s,strip,{kind:'vertex',index:vertexIndex(strip,4)},{extend:true});
assert.equal(s.active,null);assert.equal(selectionCounts(s).vertices,2);
s=clickComponent(s,strip,{kind:'vertex',index:vertexIndex(strip,5)});
assert.deepEqual(on(s.vertices),[vertexIndex(strip,5)],'plain click replaces');

// Mode switches convert like Blender: vertex to face keeps only fully selected faces.
s=selectAll(createComponentSelection(strip),strip,'select');
assert.deepEqual(selectionCounts(s),{vertices:6,edges:9,faces:4});
s=clickComponent(setSelectMode(s,strip,'face'),strip,{kind:'face',index:2});
assert.deepEqual(on(s.faces),[2]);
const asVertices=setSelectMode(s,strip,'vertex');
assert.equal(selectionCounts(asVertices).vertices,3,'face to vertex selects its corners');
const asEdges=setSelectMode(s,strip,'edge');
assert.equal(selectionCounts(asEdges).edges,3,'face to edge selects its edges');
const partial=clickComponent(createComponentSelection(strip),strip,{kind:'vertex',index:vertexIndex(strip,1)});
assert.equal(selectionCounts(setSelectMode(partial,strip,'face')).faces,0,'one vertex selects no face');
// Edge mode: a face is selected when all three of its edges are.
let e=setSelectMode(createComponentSelection(strip),strip,'edge');
for(const [a,b] of [[0,1],[1,4],[4,0]]){
  const x=vertexIndex(strip,a),y=vertexIndex(strip,b),lo=Math.min(x,y),hi=Math.max(x,y);
  let edge=-1;for(let k=0;k<strip.edgeCount;k++)if(strip.edgeVertices[2*k]===lo&&strip.edgeVertices[2*k+1]===hi)edge=k;
  e=clickComponent(e,strip,{kind:'edge',index:edge},{extend:true});
}
assert.deepEqual(on(selectedFaces(e,strip)),[0]);

// Select all toggles in Blender's sense: A selects all, Alt-A deselects.
assert.equal(selectionCounts(selectAll(s,strip,'deselect')).faces,0);
assert.equal(selectionCounts(selectAll(selectAll(s,strip,'deselect'),strip,'toggle')).faces,4,'toggle on an empty selection selects all');
assert.equal(selectionCounts(selectAll(selectAll(s,strip,'select'),strip,'toggle')).faces,0);

// Box select works on projected vertices; in face mode a face is boxed by its centre.
const projected=Float32Array.from({length:strip.vertexCount*2},(_,i)=>strip.vertexPositions[3*(i>>1)+(i&1)]*100);
const visible=new Uint8Array(strip.vertexCount).fill(1);
let b=boxSelect(createComponentSelection(strip),strip,{projected,visible,rect:{x0:-10,y0:-10,x1:110,y1:110}});
assert.equal(selectionCounts(b).vertices,4,'the left column of four vertices');
assert.equal(selectionCounts(b).faces,2);
b=boxSelect(b,strip,{projected,visible,rect:{x0:150,y0:-10,x1:250,y1:110},mode:'extend'});
assert.equal(selectionCounts(b).vertices,6);
b=boxSelect(b,strip,{projected,visible,rect:{x0:-10,y0:-10,x1:50,y1:110},mode:'subtract'});
assert.equal(selectionCounts(b).vertices,4);
const hidden=Uint8Array.from(visible);hidden[vertexIndex(strip,0)]=0;
const occluded=boxSelect(createComponentSelection(strip),strip,{projected,visible:hidden,rect:{x0:-10,y0:-10,x1:110,y1:110}});
assert.equal(selectionCounts(occluded).vertices,3,'occluded vertices are not boxed unless selecting through');
const through=boxSelect(createComponentSelection(strip),strip,{projected,visible:hidden,through:true,rect:{x0:-10,y0:-10,x1:110,y1:110}});
assert.equal(selectionCounts(through).vertices,4);
let fb=setSelectMode(createComponentSelection(strip),strip,'face');
fb=boxSelect(fb,strip,{projected,visible,rect:{x0:-10,y0:-10,x1:100,y1:110}});
assert.deepEqual(on(fb.faces),[0,1],'faces whose centres fall in the box');

// Select Linked grows a selection to its connected surface.
const two=buildPolyMesh({positions:Float32Array.of(0,0,0,1,0,0,0,1,0, 5,0,0,6,0,0,5,1,0),indices:Uint32Array.of(0,1,2,3,4,5)});
let l=setSelectMode(createComponentSelection(two),two,'vertex');
l=clickComponent(l,two,{kind:'vertex',index:0});
l=selectLinkedComponents(l,two);
assert.deepEqual(selectionCounts(l),{vertices:3,edges:3,faces:1},'the touched island only');

assert.throws(()=>setSelectMode(s,strip,'loops'),/mode/);
assert.throws(()=>clickComponent(s,strip,{kind:'face',index:99}),/face/);
