// Packed storage extends the two existing grid bindings; no extra host binding.
export function createPackedDensityLayout(particleCount, cellCount, workgroupSize = 64) {
  for(const value of [particleCount,cellCount,workgroupSize])if(!Number.isSafeInteger(value)||value<1)throw new RangeError('Packed density sizes must be positive safe integers');
  const blocks=Math.ceil(cellCount/workgroupSize);
  return {particleCount,cellCount,blocks,headWords:3*cellCount+2*blocks+2,particleWords:5*particleCount,totalOffset:3*cellCount+2*blocks,errorOffset:3*cellCount+2*blocks+1};
}

export const PACKED_DENSITY_WGSL = /* wgsl */`
const packedDensityEnabled: bool = __PACKED_DENSITY_ENABLED__;
var<workgroup> packedScan: array<u32, 64>;
fn packed_block_count() -> u32 { return (params.gridCellCount + 63u) / 64u; }
fn packed_total_offset() -> u32 { return 3u * params.gridCellCount + 2u * packed_block_count(); }
fn packed_record_word(slot: u32) -> u32 { return params.particleCount + 4u * slot; }
fn density_query_particle(slot: u32) -> u32 {
  if (!packedDensityEnabled) { return slot; }
  if (slot >= u32(atomicLoad(&cellHeads[packed_total_offset()]))) { return params.particleCount; }
  return u32(particleNext[packed_record_word(slot) + 3u]);
}
fn density_cell_first(cell: vec3<i32>) -> i32 {
  let c = cellIndex(cell);
  if (!packedDensityEnabled) { return atomicLoad(&cellHeads[c]); }
  if (atomicLoad(&cellHeads[2u * params.gridCellCount + c]) == 0) { return -1; }
  return atomicLoad(&cellHeads[params.gridCellCount + c]);
}
fn density_neighbor_id(cursor: i32) -> u32 {
  if (!packedDensityEnabled) { return u32(cursor); }
  return u32(particleNext[packed_record_word(u32(cursor)) + 3u]);
}
fn density_neighbor_position(cursor: i32, id: u32) -> vec3<f32> {
  if (!packedDensityEnabled) { return particles[id].predicted.xyz; }
  let w = packed_record_word(u32(cursor));
  return vec3<f32>(bitcast<f32>(particleNext[w]), bitcast<f32>(particleNext[w + 1u]), bitcast<f32>(particleNext[w + 2u]));
}
fn density_cell_next(cursor: i32, id: u32, cell: vec3<i32>) -> i32 {
  if (!packedDensityEnabled) { return particleNext[id]; }
  let c = cellIndex(cell);
  let end = atomicLoad(&cellHeads[params.gridCellCount + c]) + atomicLoad(&cellHeads[2u * params.gridCellCount + c]);
  return select(-1, cursor + 1, cursor + 1 < end);
}

// Count each existing chain once, then scan64 counts per workgroup.
// All invocations reach every barrier, including a final partial cell block.
@compute @workgroup_size(64)
fn scan_packed_cell_blocks(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  var count = 0u;
  if (gid.x < params.gridCellCount) {
    var cursor = atomicLoad(&cellHeads[gid.x]);
    while (cursor >= 0) { count = count + 1u; cursor = particleNext[u32(cursor)]; }
    atomicStore(&cellHeads[2u * params.gridCellCount + gid.x], i32(count));
  }
  packedScan[lid.x] = count;
  workgroupBarrier();
  for (var stride = 1u; stride < 64u; stride = stride * 2u) {
    var addend = 0u;
    if (lid.x >= stride) { addend = packedScan[lid.x - stride]; }
    workgroupBarrier();
    packedScan[lid.x] = packedScan[lid.x] + addend;
    workgroupBarrier();
  }
  if (gid.x < params.gridCellCount) { atomicStore(&cellHeads[params.gridCellCount + gid.x], i32(packedScan[lid.x] - count)); }
  if (lid.x == 63u) { atomicStore(&cellHeads[3u * params.gridCellCount + wid.x], i32(packedScan[63])); }
}

// Only320 block totals at the current grid; no serial scan over all particles.
@compute @workgroup_size(1)
fn scan_packed_block_totals() {
  var total = 0;
  let blocks = packed_block_count();
  for (var b = 0u; b < blocks; b = b + 1u) {
    atomicStore(&cellHeads[3u * params.gridCellCount + blocks + b], total);
    total = total + atomicLoad(&cellHeads[3u * params.gridCellCount + b]);
  }
  atomicStore(&cellHeads[packed_total_offset()], total);
  atomicStore(&cellHeads[packed_total_offset() + 1u], select(0, 1, total > i32(params.particleCount)));
}

// Copy xyz and canonical ID in exactly the current chain's order.
@compute @workgroup_size(64)
fn pack_density_cell_records(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.gridCellCount) { return; }
  let blockBase = atomicLoad(&cellHeads[3u * params.gridCellCount + packed_block_count() + gid.x / 64u]);
  var slot = u32(blockBase + atomicLoad(&cellHeads[params.gridCellCount + gid.x]));
  atomicStore(&cellHeads[params.gridCellCount + gid.x], i32(slot));
  var cursor = atomicLoad(&cellHeads[gid.x]);
  while (cursor >= 0) {
    if (slot >= params.particleCount) { atomicAdd(&cellHeads[packed_total_offset() + 1u], 1); return; }
    let p = particles[u32(cursor)].predicted.xyz;
    let w = packed_record_word(slot);
    particleNext[w] = bitcast<i32>(p.x);
    particleNext[w + 1u] = bitcast<i32>(p.y);
    particleNext[w + 2u] = bitcast<i32>(p.z);
    particleNext[w + 3u] = cursor;
    slot = slot + 1u;
    cursor = particleNext[u32(cursor)];
  }
}
`;
