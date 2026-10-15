// Separate > Selection, as Blender's P: the selected faces of one mesh become a new mesh
// and the rest stays behind. It works on the GLB's own triangles, checked corner by
// corner against the geometry the selection was made on, so a selection can never land
// on different faces. Both pieces keep the source material, atlas and node placement.
import {readTrianglePrimitives,writeDerivedGlb} from './poly-glb-io.mjs';
import {extractFaces} from './poly-mesh-edit.mjs';

export function separateSelection(sourceBytes,faceMask,{geometry=null,name='Part',restName=`${name} remainder`,source=null}={}) {
  const primitives=readTrianglePrimitives(sourceBytes);
  if(primitives.length!==1)throw Error(`Separate needs a GLB with one triangle mesh; this one has ${primitives.length}`);
  const [primitive]=primitives;
  if(primitive.nodes.length!==1)throw Error('Separate needs the mesh placed by exactly one node');
  const indices=primitive.indices??Uint32Array.from({length:primitive.positions.length/3},(_,i)=>i),faces=indices.length/3;
  if(faceMask.length!==faces)throw Error(`The selection covers ${faceMask.length} faces but the GLB has ${faces}`);
  if(geometry)checkSameTriangles(primitive.positions,indices,geometry);
  let selected=0;for(const s of faceMask)if(s)selected++;
  if(!selected)throw Error('Select faces to separate');
  if(selected===faces)throw Error('Every face is selected, so nothing would remain');
  const {part,rest}=extractFaces({positions:primitive.positions,normals:primitive.normals,uvs:primitive.uvs,indices},faceMask);
  const piece=(arrays,keep,label,count)=>{
    const receipt={schema:'kaminos.poly-derivation.v0',source,operations:[{op:'separate',keep,selectedFaces:selected,sourceFaces:faces}]};
    return {bytes:writeDerivedGlb(sourceBytes,arrays,{name:label,receipt,nodeMatrix:primitive.worldMatrices[0],sourceMaterial:primitive.material??0}),faces:count,receipt};
  };
  return {part:piece(part,'selection',name,selected),rest:piece(rest,'remainder',restName,faces-selected)};
}

function checkSameTriangles(P,I,{positions:Q,indices:J}) {
  const K=J??Uint32Array.from({length:Q.length/3},(_,i)=>i);
  if(K.length!==I.length)throw Error(`The edited geometry has ${K.length/3} faces but the GLB has ${I.length/3}`);
  for(let c=0;c<I.length;c++)for(let k=0;k<3;k++)
    if(Math.fround(P[3*I[c]+k])!==Math.fround(Q[3*K[c]+k]))throw Error(`The edited geometry does not match the GLB at face ${Math.floor(c/3)}`);
}
