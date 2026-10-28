/** Finite PBF's linked buckets index world-space cells. Bucket collisions cost
 * scans, never neighbors: every lookup checks the exact integer cell first.
 * No CPU bounds reduction, reallocation, or per-cell population cap is needed. */
export const WORLD_NEIGHBOR_CONTRACT='wgsl-world-space-linked-hash-neighbors-v1';
export const WORLD_NEIGHBOR_QUERY_CONTRACT='wgsl-uniform-radius-aware-world-neighbors-v1';
export const WORLD_UNIFORM_KERNEL_CONTRACT='wgsl-uniform-world-neighbor-kernels-v1';

function uniformPairKernels(shader,volume){
 volume=Math.fround(volume);
 if(!Number.isFinite(volume)||volume<=0)throw new RangeError('Uniform particle volume must be positive finite f32');
 const radius=Math.fround(Math.pow(Math.max(volume,0.000001),1/3));
 for(const [name,value] of [['adaptive_volume_scale','worldUniformParticleVolume'],['adaptive_radius_scale','worldUniformParticleRadius']]){
  const pattern=new RegExp(`fn ${name}\\(index: u32\\) -> f32 \\{[^]*?\\n}`);
  if(!pattern.test(shader))throw Error('Uniform kernel contract missing '+name);
  shader=shader.replace(pattern,`fn ${name}(index: u32) -> f32 {\n  return ${value};\n}`);
 }
 return `const worldUniformParticleVolume: f32 = ${volume};\nconst worldUniformParticleRadius: f32 = ${radius};\n`+shader;
}

// Physical radii belong to the consumers. Grid resolution must not silently
// shorten cohesion/topology when uniform pressure support becomes smaller.
const radiusConsumers={
 measure_neighbor_topology:['params.fluid.x','predicted'],
 apply_surface_cohesion:['params.fluid.x','predicted'],
 compute_material_tracer_diffusion:['worldUniformSupportRadius','predicted'],
 compute_density_lambda:['worldUniformSupportRadius','predicted'],
 solve_position_delta:['worldUniformSupportRadius','predicted'],
 classify_free_surface:['worldUniformSupportRadius','predicted'],
 compute_velocity_viscosity:['worldUniformSupportRadius','predicted'],
 compute_vorticity:['worldUniformSupportRadius','predicted'],
 apply_vorticity_confinement:['worldUniformSupportRadius','predicted'],
 classify_unsupported_sheet:['worldUniformSupportRadius','predicted'],
 compute_support_particle_shift:['worldUniformSupportRadius','position'],
 estimate_interface_curvature:['worldUniformSupportRadius','position'],
 compact_interface_records:['worldUniformSupportRadius','position'],
};

function radiusAwareQueries(shader,uniformSupportRadius,nominalCellWidth){
 if(!Number.isFinite(uniformSupportRadius)||!Number.isFinite(Math.fround(uniformSupportRadius))||Math.fround(uniformSupportRadius)<=0)throw new RangeError('Uniform neighbor support must be positive finite f32');
 const edits=[];
 for(const match of shader.matchAll(/fn (\w+)\(/g)){
  const open=shader.indexOf('{',match.index);let end=open+1,depth=1;
  for(;depth&&end<shader.length;end++){if(shader[end]==='{')depth++;else if(shader[end]==='}')depth--;}
  const body=shader.slice(open+1,end-1);
  if(!body.includes('atomicLoad(&cellHeads[cellIndex(neighborCell)])'))continue;
  const spec=radiusConsumers[match[1]];
  if(!spec)throw Error('World neighbor radius contract missing for '+match[1]);
  const [radius,field]=spec;
  const width=radius==='params.fluid.x'?'worldNominalCellWidth':'worldNeighborCellWidth';
  let next=body.replace('  let baseCell = gridCoord(position);',`  let baseCell = gridCoord(position);
  let neighborSearchRadius = ${radius};
  let neighborSearchCellWidth = ${width};
  let neighborPadding = world_neighbor_query_padding(position, neighborSearchRadius, neighborSearchCellWidth);
  let neighborCellMin = world_neighbor_coord(position - vec3<f32>(neighborSearchRadius) - neighborPadding, neighborSearchCellWidth);
  let neighborCellMax = world_neighbor_coord(position + vec3<f32>(neighborSearchRadius) + neighborPadding, neighborSearchCellWidth);`);
  for(const axis of ['x','y','z'])next=next.replace(`var ${axis} = -1; ${axis} <= 1;`, `var ${axis} = neighborCellMin.${axis}; ${axis} <= neighborCellMax.${axis};`);
  next=next.replace('let neighborCell = baseCell + vec3<i32>(x, y, z);',`let neighborCell = vec3<i32>(x, y, z);
        if (!world_neighbor_cell_might_contribute(position, neighborCell, neighborSearchRadius, neighborSearchCellWidth)) { continue; }`);
  next=next.replace('          let neighborIndex = u32(current);',`          let neighborIndex = u32(current);
          if (!world_neighbor_pair_might_contribute(position, particles[neighborIndex].${field}.xyz, neighborSearchRadius, neighborSearchCellWidth)) {
            current = particleNext[neighborIndex];
            continue;
          }`);
  if(next===body||!next.includes('neighborCellMin.z; z <= neighborCellMax.z')||!next.includes('world_neighbor_pair_might_contribute'))throw Error('World neighbor radius contract changed for '+match[1]);
  edits.push({start:open+1,end:end-1,next});
 }
 if(edits.length!==Object.keys(radiusConsumers).length)throw Error('World neighbor radius contract requires every known consumer');
 for(const edit of edits.reverse())shader=shader.slice(0,edit.start)+edit.next+shader.slice(edit.end);
 return `const worldUniformSupportRadius: f32 = ${Math.fround(uniformSupportRadius)};
const worldNominalCellWidth: f32 = ${Math.fround(nominalCellWidth)};
fn world_neighbor_coord(position: vec3<f32>, width: f32) -> vec3<i32> {
  return vec3<i32>(floor(position / width));
}
fn world_neighbor_query_padding(position: vec3<f32>, radius: f32, width: f32) -> vec3<f32> {
  return vec3<f32>(width * 0.001 + radius * 0.00001) + abs(position) * 0.000001;
}
fn world_neighbor_cell_might_contribute(position: vec3<f32>, cell: vec3<i32>, radius: f32, width: f32) -> bool {
  let lower = vec3<f32>(cell) * width;
  let upper = lower + vec3<f32>(width);
  let pad = world_neighbor_query_padding(max(abs(lower), abs(upper)), radius, width);
  let separation = position - clamp(position, lower - pad, upper + pad);
  return dot(separation, separation) <= radius * radius;
}
fn world_neighbor_pair_might_contribute(position: vec3<f32>, neighbor: vec3<f32>, radius: f32, width: f32) -> bool {
  let offset = position - neighbor;
  let pad = world_neighbor_query_padding(max(abs(position), abs(neighbor)), radius, width);
  let upperRadius = radius + max(pad.x, max(pad.y, pad.z));
  return dot(offset, offset) <= upperRadius * upperRadius;
}
`+shader;
}
export function worldNeighborFunctions(cellWidth){
 if(!Number.isFinite(cellWidth)||cellWidth<=0||!Number.isFinite(Math.fround(cellWidth))||Math.fround(cellWidth)<=0)throw new RangeError('Neighbor cell width must be positive finite f32');
 return `
const worldNeighborCellWidth: f32 = ${cellWidth};
fn gridCoord(position: vec3<f32>) -> vec3<i32> {
  return vec3<i32>(floor(position / worldNeighborCellWidth));
}
fn cellIndex(coord: vec3<i32>) -> u32 {
  let bits = bitcast<vec3<u32>>(coord);
  let hash = (bits.x * 73856093u) ^ (bits.y * 19349663u) ^ (bits.z * 83492791u);
  return hash % params.gridCellCount;
}
fn density_neighbor_cell_might_contribute(position: vec3<f32>, neighborCell: vec3<i32>, radiusScale: f32) -> bool {
  if (params.refinementControl.y != 0u || params.refinementControl.w == 0u) { return true; }
  let cellMin = vec3<f32>(neighborCell) * worldNeighborCellWidth;
  let cellMax = cellMin + vec3<f32>(worldNeighborCellWidth);
  // Account for both cell arithmetic and world-coordinate f32 rounding.
  let pad = vec3<f32>(worldNeighborCellWidth * 0.001) + max(abs(cellMin), abs(cellMax)) * 0.000001;
  let separation = position - clamp(position, cellMin - pad, cellMax + pad);
  let supportRadius = params.fluid.x * radiusScale;
  return dot(separation, separation) <= supportRadius * supportRadius;
}
`;
}

export function applyWorldSpaceNeighbors(shader,{cellWidth,uniformSupportRadius=null,nominalCellWidth=cellWidth,uniformVolumeScale=null}){
 const functions=worldNeighborFunctions(cellWidth);
 worldNeighborFunctions(nominalCellWidth);
 const start=shader.indexOf('fn gridCoord('),end=shader.indexOf('fn kernelWeight(',start);
 if(start<0||end<start)throw Error('World neighbor shader requires grid helpers before kernelWeight');
 let result=shader.slice(0,start)+functions+'\n'+shader.slice(end);
 if(uniformVolumeScale!==null)result=uniformPairKernels(result,uniformVolumeScale);
 if(uniformSupportRadius!==null)result=radiusAwareQueries(result,uniformSupportRadius,nominalCellWidth);
 const boundary='        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }';
 const visit='          let neighborIndex = u32(current);';
 const traversals=[...result.matchAll(/atomicLoad\(&cellHeads\[cellIndex\(neighborCell\)\]\)/g)].length;
 if(traversals===0||result.split(boundary).length-1!==traversals||result.split(visit).length-1!==traversals)throw Error('World neighbor shader traversal changed; every bucket must filter exact cell membership');
 result=result.replaceAll(boundary,'        // World-space cells have no search-box boundary.');
 result=result.replaceAll(visit,visit+`
          if (any(particleNext[neighborIndex].xyz != neighborCell)) {
            current = particleNext[neighborIndex];
            continue;
          }`);
 // Retain the build-time cell alongside the link. Later interface/shift passes
 // must not reclassify a stored node from its subsequently updated position.
 result=result.replace('particleNext: array<i32>','particleNext: array<vec4<i32>>')
   .replace('particleNext[index] = -1;', 'particleNext[index] = vec4<i32>(0, 0, 0, -1);')
   .replace('let gridIndex = cellIndex(gridCoord(particles[index].predicted.xyz));', 'let storedCell = gridCoord(particles[index].predicted.xyz);\n  let gridIndex = cellIndex(storedCell);')
   .replace('particleNext[index] = atomicExchange(&cellHeads[gridIndex], i32(index));', 'particleNext[index] = vec4<i32>(storedCell, atomicExchange(&cellHeads[gridIndex], i32(index)));')
   .replaceAll('current = particleNext[neighborIndex];','current = particleNext[neighborIndex].w;');
 if(uniformSupportRadius!==null){
  const builder=result.match(/@compute @workgroup_size\(\d+\)\nfn build_linked_cell_grid[\s\S]*?(?=\n@compute)/)?.[0];
  if(!builder)throw Error('World neighbor radius contract requires the production grid builder');
  result+='\n'+builder.replace('fn build_linked_cell_grid(','fn build_nominal_cell_grid(').replace('gridCoord(particles[index].predicted.xyz)','world_neighbor_coord(particles[index].predicted.xyz, worldNominalCellWidth)');
 }
 return result;
}
