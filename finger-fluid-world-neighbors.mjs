/** Finite PBF's linked buckets index world-space cells. Bucket collisions cost
 * scans, never neighbors: every lookup checks the exact integer cell first.
 * No CPU bounds reduction, reallocation, or per-cell population cap is needed. */
export const WORLD_NEIGHBOR_CONTRACT='wgsl-world-space-linked-hash-neighbors-v1';
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

export function applyWorldSpaceNeighbors(shader,{cellWidth}){
 const functions=worldNeighborFunctions(cellWidth);
 const start=shader.indexOf('fn gridCoord('),end=shader.indexOf('fn kernelWeight(',start);
 if(start<0||end<start)throw Error('World neighbor shader requires grid helpers before kernelWeight');
 let result=shader.slice(0,start)+functions+'\n'+shader.slice(end);
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
 return result;
}
