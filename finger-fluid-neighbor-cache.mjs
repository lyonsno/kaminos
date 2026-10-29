/** Optional GPU candidate cache. Capacity limits caching, never interactions:
 * overflowing rows take the original complete linked walk. Each grid rebuild
 * is followed by a cache build; no positions or dynamic material values are cached. */
export const NEIGHBOR_CACHE_CONTRACT='wgsl-complete-neighbor-cache-v1';
function endBrace(s,open){let depth=1,i=open+1;for(;depth&&i<s.length;i++){if(s[i]==='{')depth++;else if(s[i]==='}')depth--;}if(depth)throw Error('Unbalanced neighbor shader');return i;}
export function applyNeighborCache(shader,slots){
 if(!Number.isSafeInteger(slots)||slots<0||slots%4)throw RangeError('Neighbor cache slots must be a nonnegative multiple of four');
 if(!slots)return shader;
 if(!shader.includes('worldUniformSupportRadius'))throw Error('Neighbor cache requires uniform radius queries');
 const edits=[];let builderLoop=null,builderSetup=null;
 for(const match of shader.matchAll(/fn (\w+)\(/g)){
  const open=shader.indexOf('{',match.index),end=endBrace(shader,open),body=shader.slice(open+1,end-1);
  const start=body.indexOf('for (var z = neighborCellMin.z;');
  if(start<0)continue;
  const loopEnd=endBrace(body,body.indexOf('{',start));
  const loop=body.slice(start,loopEnd);
  const guard=loop.indexOf('if (!world_neighbor_pair_might_contribute');
  if(guard<0)throw Error('Neighbor cache missing pair gate: '+match[1]);
  const payloadStart=endBrace(loop,loop.indexOf('{',guard));
  const payloadEnd=loop.lastIndexOf('current = particleNext[neighborIndex].w;');
  if(payloadEnd<payloadStart)throw Error('Neighbor cache missing link advance');
  const payload=loop.slice(payloadStart,payloadEnd);
  const cached=`if (world_cache_count(index) >= 0) {
    for (var cachedOrdinal = 0u; cachedOrdinal < u32(world_cache_count(index)); cachedOrdinal++) {
      let neighborIndex = world_cache_neighbor(index, cachedOrdinal);
      ${payload}
    }
  } else {
    ${loop}
  }`;
  edits.push({start:open+1+start,end:open+1+loopEnd,text:cached});
  if(match[1]==='compute_velocity_viscosity'){
   const setupStart=body.indexOf('  let neighborSearchRadius');
   const setupEnd=body.indexOf(';',body.indexOf('  let neighborCellMax'))+1;
   builderSetup=body.slice(setupStart,setupEnd);
   builderLoop=loop.slice(0,payloadStart)+`
          if (count == ${slots}u) { world_cache_store_count(index, -1); return; }
          world_cache_store_neighbor(index,count,neighborIndex);
          count++;
          `+loop.slice(payloadEnd);
  }
 }
 if(edits.length!==13||!builderLoop)throw Error('Neighbor cache requires all thirteen consumers');
 for(const e of edits.reverse())shader=shader.slice(0,e.start)+e.text+shader.slice(e.end);
 const rows=1+slots/4;
 const helpers=`
// Stored after the original N linked nodes, in the same storage binding.
fn world_cache_base(index:u32)->u32 { return params.particleCount + index * ${rows}u; }
fn world_cache_count(index:u32)->i32 { return particleNext[world_cache_base(index)].x; }
fn world_cache_store_count(index:u32,count:i32) { particleNext[world_cache_base(index)].x=count; }
fn world_cache_neighbor(index:u32,ordinal:u32)->u32 { return u32(particleNext[world_cache_base(index)+1u+ordinal/4u][ordinal%4u]); }
fn world_cache_store_neighbor(index:u32,ordinal:u32,neighbor:u32) { particleNext[world_cache_base(index)+1u+ordinal/4u][ordinal%4u]=i32(neighbor); }
`;
 function builder(nominal){
  let setup=builderSetup;
  if(nominal)setup=setup.replaceAll('worldUniformSupportRadius','params.fluid.x').replaceAll('worldNeighborCellWidth','worldNominalCellWidth');
  return `\n@compute @workgroup_size(64)
fn build_${nominal?'nominal':'fine'}_neighbor_cache(@builtin(global_invocation_id) gid:vec3<u32>) {
 let index=gid.x;
 if(index>=params.particleCount){return;}
 let position=particles[index].predicted.xyz;
 ${setup}
 var count=0u;
 ${builderLoop}
 world_cache_store_count(index,i32(count));
}\n`;
 }
 return shader+helpers+builder(false)+builder(true);
}
export function neighborCacheBytes(particleCount,slots){return particleCount*(slots?32+slots*4:16);}
