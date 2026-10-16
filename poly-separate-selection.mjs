// Separate and Slice on a GLB, for Edit Mode. Both work on the GLB's own triangles,
// checked corner by corner against the geometry the selection was made on, so a
// selection can never land on different faces. Both pieces keep the source material,
// atlas and node placement, and carry a receipt of what was done.
//   Separate > Selection, as Blender's P: the selected faces become a new mesh.
//   Slice: a plane cuts the selected faces, the mesh splits where the cut separates it,
//   and both openings are capped: Bisect, Fill and Separate in one step.
import {parseGlb,readTrianglePrimitives,writeDerivedGlb} from './poly-glb-io.mjs';
import {buildPolyMesh,selectLinkedFaces} from './poly-mesh-core.mjs';
import {bisectFaces,cutBarrier,extractFaces,followCut,sectionCap} from './poly-mesh-edit.mjs';

// The mesh's primitives edit as one face set, in order, each with its own vertex block, as
// Edit Mode merges them. A derived part's second material is its cut cap, and stays one.
// A null faceMask means the operation needs no face selection.
function editedPrimitive(sourceBytes,faceMask,geometry) {
  const primitives=readTrianglePrimitives(sourceBytes);
  if(!primitives.length)throw Error('Edit Mode needs a GLB with a triangle mesh');
  if(primitives.some(p=>p.mesh!==primitives[0].mesh))throw Error('Edit Mode needs a GLB with one mesh; this one has several');
  const [first]=primitives;
  if(first.nodes.length!==1)throw Error('Edit Mode needs the mesh placed by exactly one node');
  const materials=[...new Set(primitives.map(p=>p.material??0))];
  if(materials.length>2)throw Error('Edit Mode supports one material plus cut caps for now');
  const blocks=primitives.map(p=>({...p,indices:p.indices??Uint32Array.from({length:p.positions.length/3},(_,i)=>i)}));
  const join=key=>{if(!blocks.every(p=>p[key]))return null;if(blocks.length===1)return blocks[0][key];const out=new Float32Array(blocks.reduce((n,p)=>n+p[key].length,0));let at=0;for(const p of blocks){out.set(p[key],at);at+=p[key].length;}return out;};
  const indices=new Uint32Array(blocks.reduce((n,p)=>n+p.indices.length,0)),faceMaterial=new Uint8Array(indices.length/3);
  for(let b=0,at=0,base=0;b<blocks.length;b++){const p=blocks[b],slot=materials.indexOf(p.material??0);for(let i=0;i<p.indices.length;i++)indices[at+i]=p.indices[i]+base;faceMaterial.fill(slot,at/3,(at+p.indices.length)/3);at+=p.indices.length;base+=p.positions.length/3;}
  const arrays={positions:join('positions'),normals:join('normals'),uvs:join('uvs'),indices,faceMaterial},faces=indices.length/3;
  if(faceMask&&faceMask.length!==faces)throw Error(`The selection covers ${faceMask.length} faces but the GLB has ${faces}`);
  if(geometry)checkSameTriangles(arrays.positions,indices,geometry);
  let selected=0;for(const s of faceMask??[])if(s)selected++;
  return {primitive:{node:first.worldMatrices[0],materials},arrays,faces,selected};
}
function derived(sourceBytes,{node,materials},arrays,label,receipt) {
  const capMaterial=materials.length>1?parseGlb(sourceBytes).json.materials?.[materials[1]]:undefined;
  return writeDerivedGlb(sourceBytes,arrays,{name:label,receipt,nodeMatrix:node,sourceMaterial:materials[0],...(capMaterial?{capMaterial}:{})});
}

export function separateSelection(sourceBytes,faceMask,{geometry=null,name='Part',restName=`${name} remainder`,source=null}={}) {
  const {primitive,arrays,faces,selected}=editedPrimitive(sourceBytes,faceMask,geometry);
  if(!selected)throw Error('Select faces to separate');
  if(selected===faces)throw Error('Every face is selected, so nothing would remain');
  const {part,rest}=extractFaces(arrays,faceMask);
  const piece=(piece,keep,label,count)=>{
    const receipt={schema:'kaminos.poly-derivation.v0',source,operations:[{op:'separate',keep,selectedFaces:selected,sourceFaces:faces}]};
    return {bytes:derived(sourceBytes,primitive,piece,label,receipt),faces:count,receipt};
  };
  return {part:piece(part,'selection',name,selected),rest:piece(rest,'remainder',restName,faces-selected)};
}

// The plane is in the mesh's own frame. Only selected faces are cut; the selection must
// span the junction, so that the cut leaves no path from one side to the other.
export function sliceSelection(sourceBytes,faceMask,plane,{geometry=null,name='Part',restName=`${name} remainder`,source=null,fill='outline'}={}) {
  const {primitive,arrays,faces,selected}=editedPrimitive(sourceBytes,faceMask,geometry);
  if(!selected)throw Error('Select the faces to slice, around where the cut goes');
  const {mask:cutMask,followed}=followCut(arrays,faceMask,plane),cut=bisectFaces(arrays,cutMask,plane);
  if(!cut.cutVertices)throw Error('The line does not cross the selected faces');
  // Grow each side from its own faces along the cut. The smaller side is the part; everything
  // else, including selected debris the cut never touches, stays with the remainder.
  const mesh=buildPolyMesh(cut.arrays),barrier=cutBarrier(mesh,cut.side),seeds={1:[],[-1]:[]};
  for(let f=0;f<mesh.faceCount;f++)if(cut.side[f])for(let c=3*f;c<3*f+3;c++)if(barrier[mesh.cornerEdge[c]]){seeds[cut.side[f]].push(f);break;}
  const above=selectLinkedFaces(mesh,seeds[1],{barrier}),below=selectLinkedFaces(mesh,seeds[-1],{barrier});
  let aboveFaces=0,belowFaces=0;
  for(let f=0;f<mesh.faceCount;f++){if(above[f]&&below[f])throw Error('The cut does not separate the mesh: the two sides still join elsewhere. Select the whole junction, or move the line');aboveFaces+=above[f];belowFaces+=below[f];}
  const partAbove=aboveFaces<=belowFaces,partMask=partAbove?above:below;
  const pieces=extractFaces(cut.arrays,partMask),bisect={op:'bisect',plane:{point:[...plane.point],normal:[...plane.normal]},selectedFaces:selected,followedFaces:followed,sourceFaces:faces,cutVertices:cut.cutVertices};
  const piece=(pieceArrays,keep,label,side)=>{
    const cap=sectionCap(pieceArrays,arrays,cutMask,plane,{side,fill});
    const receipt={schema:'kaminos.poly-derivation.v0',source,operations:[bisect,{op:'separate',keep,by:'cut'},{op:'section-cap',fill,side,capFaces:cap.capFaces,regions:cap.regions,openChains:cap.openChains}]};
    return {bytes:derived(sourceBytes,primitive,cap.arrays,label,receipt),faces:cap.arrays.indices.length/3,capFaces:cap.capFaces,openChains:cap.openChains,receipt};
  };
  return {part:piece(pieces.part,'selection',name,partAbove?1:-1),rest:piece(pieces.rest,'remainder',restName,partAbove?-1:1),cutVertices:cut.cutVertices};
}

function checkSameTriangles(P,I,{positions:Q,indices:J}) {
  const K=J??Uint32Array.from({length:Q.length/3},(_,i)=>i);
  if(K.length!==I.length)throw Error(`The edited geometry has ${K.length/3} faces but the GLB has ${I.length/3}`);
  for(let c=0;c<I.length;c++)for(let k=0;k<3;k++)
    if(Math.fround(P[3*I[c]+k])!==Math.fround(Q[3*K[c]+k]))throw Error(`The edited geometry does not match the GLB at face ${Math.floor(c/3)}`);
}

// Origin to Selection: `point` (in the mesh frame) becomes the object's origin. The vertices are
// unchanged; the node is moved back by `offset`, the point in the object frame, so moving the
// object forward by the same offset (rotated and scaled by its transform) leaves the world alone.
export function moveOrigin(sourceBytes,point,{geometry=null,name='Part',source=null}={}) {
  if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite))throw Error('Origin to Selection needs a finite point');
  const {primitive,arrays}=editedPrimitive(sourceBytes,null,geometry);
  const m=primitive.node??[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const offset=[0,1,2].map(r=>m[r]*point[0]+m[4+r]*point[1]+m[8+r]*point[2]+m[12+r]);
  const node=[...m];for(let r=0;r<3;r++)node[12+r]-=offset[r];
  const receipt={schema:'kaminos.poly-derivation.v0',source,operations:[{op:'origin',to:'selection',point:[...point]}]};
  // A derived piece's primitives share one vertex block, which merging repeats; keep one copy.
  const {part:compacted}=extractFaces(arrays,new Uint8Array(arrays.indices.length/3).fill(1));
  return {bytes:derived(sourceBytes,{...primitive,node},compacted,name,receipt),offset,receipt};
}
