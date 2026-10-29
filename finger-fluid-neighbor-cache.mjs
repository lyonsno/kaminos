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
  const cached=`let cachedCount = world_cache_count(index);
  if (cachedCount >= 0) {
    for (var cachedOrdinal = 0u; cachedOrdinal < u32(cachedCount); cachedOrdinal++) {
      let neighborIndex = world_cache_neighbor(index, cachedOrdinal);
      ${payload}
    }
  } else {
    ${loop}
  }`;
  const producer=['compute_density_lambda','measure_neighbor_topology','classify_free_surface'].includes(match[1]);
  const built=producer?`var cachedBuildCount=0u;
  ${loop.slice(0,payloadStart)}
  if(cachedBuildCount < ${slots}u){world_cache_store_neighbor(index,cachedBuildCount,neighborIndex);}
  cachedBuildCount++;
  ${loop.slice(payloadStart)}
  world_cache_store_count(index,select(i32(cachedBuildCount),-1,cachedBuildCount>${slots}u));`:cached;
  edits.push({start:open+1+start,end:open+1+loopEnd,text:built});
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
 // Grid rebuild invalidates every row before any consumer can return early.
 for(const name of ['build_linked_cell_grid','build_nominal_cell_grid']){
  const start=shader.indexOf('fn '+name+'(');if(start<0)continue;
  const open=shader.indexOf('{',start),end=endBrace(shader,open),body=shader.slice(open,end);
  const guard='if (index >= params.particleCount) { return; }';
  if(!body.includes(guard))throw Error('Cache invalidation requires grid particle guard');
  shader=shader.slice(0,open)+body.replace(guard,guard+'\n  world_cache_store_count(index,-1);')+shader.slice(end);
 }
 const helpers=`
// Scalar atomic entries after the hash heads avoid component-write aliasing.
// Columns are contiguous across particles, so adjacent lanes read adjacent IDs.
fn world_cache_count(index:u32)->i32 { return atomicLoad(&cellHeads[params.gridCellCount+index]); }
fn world_cache_store_count(index:u32,count:i32) { atomicStore(&cellHeads[params.gridCellCount+index],count); }
fn world_cache_neighbor(index:u32,ordinal:u32)->u32 { return u32(atomicLoad(&cellHeads[params.gridCellCount+(ordinal+1u)*params.particleCount+index])); }
fn world_cache_store_neighbor(index:u32,ordinal:u32,neighbor:u32) { atomicStore(&cellHeads[params.gridCellCount+(ordinal+1u)*params.particleCount+index],i32(neighbor)); }
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
export function neighborCacheBytes(particleCount,slots){return slots?particleCount*(slots+1)*4:0;}
