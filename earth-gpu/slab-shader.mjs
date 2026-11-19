import { REGION_WGSL } from './region-shader.mjs';

// Each face queries only the hard-grain buckets intersecting its expanded
// bounds. The existing grain/triangle narrow phase and reactions are shared.
const oldContact = REGION_WGSL.slice(
  REGION_WGSL.indexOf('@compute @workgroup_size(64) fn materialContacts'),
  REGION_WGSL.indexOf('// The tool uses the same continuous boundary'),
);
const areaStart = oldContact.indexOf('  let area=');
const narrowPhase = oldContact.slice(areaStart, oldContact.lastIndexOf('\n }\n}'));
if (areaStart < 0 || !narrowPhase.includes('addDelta(ids[k]')) {
  throw new Error('Grain and face contact entry changed');
}

const slabFaces = `
fn hardBucketBase()->u32{return p.grid.x*p.grid.y*p.grid.z;}
fn faceExposed(face:vec4u)->bool{
 if(face.w==END||regionControl.law.x==0.0){return true;}
 let band=faces[face.w];
 for(var i=band.x;i<band.y;i++){
  if(regionLinks[i].law.z<1.0){return false;}
 }
 return true;
}
@compute @workgroup_size(64) fn indexHard(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 if(i>=u32(regionControl.gripDelta.w)){return;}
 let key=cellKey(cell(bodies[i].p.xyz))+hardBucketBase();
 next[p.counts.y+i]=atomicExchange(&heads[key],i);
}
@compute @workgroup_size(64) fn materialContacts(@builtin(global_invocation_id) id:vec3u){
 let f=id.x;
 if(f>=p.counts.w){return;}
 let face=faces[f];
 if(!faceExposed(face)){return;}
 let a=bodies[face.x].p.xyz;
 let c=bodies[face.y].p.xyz;
 let d=bodies[face.z].p.xyz;
 let extent=vec3f(regionControl.law.w);
 let boxMin=min(a,min(c,d))-extent;
 let boxMax=max(a,max(c,d))+extent;
 let hi=vec3i(p.grid.xyz)-1;
 let lower=clamp(cell(boxMin),vec3i(0),hi);
 let upper=clamp(cell(boxMax),vec3i(0),hi);
 for(var z=lower.z;z<=upper.z;z++){
  for(var y=lower.y;y<=upper.y;y++){
   for(var x=lower.x;x<=upper.x;x++){
    var candidate=atomicLoad(&heads[cellKey(vec3i(x,y,z))+hardBucketBase()]);
    loop{
     if(candidate==END){break;}
     let i=candidate;
     candidate=next[p.counts.y+i];
     let b=bodies[i];
     if(any(b.p.xyz<boxMin)||any(b.p.xyz>boxMax)){continue;}
${narrowPhase}
    }
   }
  }
 }
}
`;

export const SLAB_WGSL = REGION_WGSL
  .replace(oldContact, slabFaces)
  .replace('let ids=faces[fi].xyz;', 'let face=faces[fi];if(!faceExposed(face)){return;}let ids=face.xyz;')
  .replace('let ti=id.x;if(ti>=p.counts.z){return;}let t=tets[ti];',
    'let lane=p.grid.w+id.x;if(lane>=arrayLength(&faces)){return;}let ti=faces[lane].x;if(ti>=p.counts.z){return;}let t=tets[ti];')
  // Keep positional correction resolution independent of the tray width.
  .replace('262144.0/p.domain.x', '262144.0/.026')
  .replace('p.domain.x/262144.0', '.026/262144.0');

// Faces, range records and the element dispatch list share one readonly binding.
// Keep Tet order canonical so plastic state can be captured without remapping.
export function packSlabDispatch(state) {
  const byColor = Array.from({ length: state.materialColors }, () => []);
  const tetWords = new Uint32Array(state.tets.buffer, state.tets.byteOffset, state.tets.length);
  for (let i = 0; i < state.material.tets.length; i++) {
    byColor[tetWords[i*20+18]].push(i);
  }
  const firstBand = state.faceCount;
  let offset = firstBand+state.bands.length;
  const dispatches = byColor.map(indices => {
    const range = { offset, count: indices.length };
    offset += indices.length;
    return range;
  });
  const words = new Uint32Array(offset*4);
  words.set(state.triangles.subarray(0,state.faceCount*4));
  for (const [i,band] of state.faceBands.entries()) {
    words[i*4+3] = band < 0 ? 0xffffffff : firstBand+band;
  }
  for (const [i,{first,count}] of state.bands.entries()) {
    const start = state.attachments.length+first;
    words.set([start,start+count],(firstBand+i)*4);
  }
  for (const [i,indices] of byColor.entries()) {
    for (const [lane,tet] of indices.entries()) words[(dispatches[i].offset+lane)*4] = tet;
  }
  return { words, dispatches };
}
