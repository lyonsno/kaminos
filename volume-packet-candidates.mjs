import {PARTICLE_LIGHT_MATERIAL_WGSL} from './volume-optical-particles.mjs';

export const PACKET_BUNDLE_STRUCT_WGSL=/* wgsl */`struct Bundle {origin:vec4<f32>,forward:vec4<f32>,right:vec4<f32>,up:vec4<f32>,weight:vec4<f32>,ids:vec4<u32>}`;

export const PACKET_CANDIDATE_WGSL = /* wgsl */`
struct CandidateGrid {
  origin: vec4<f32>,
  size: vec4<u32>,
  dispatch: vec4<u32>,
}
struct Cell {
  occupied: atomic<u32>,
  transverse: atomic<u32>,
  axial: atomic<u32>,
}
struct Draw {
  vertices: u32,
  instances: u32,
  firstVertex: u32,
  firstInstance: u32,
  dense: u32,
  candidates: atomic<u32>,
}
@group(0) @binding(0) var<uniform> grid: CandidateGrid;
@group(0) @binding(1) var<storage, read_write> cells: array<Cell>;
@group(0) @binding(2) var<storage, read_write> slotCells: array<u32>;
@group(0) @binding(3) var<storage, read_write> candidates: array<u32>;
@group(0) @binding(4) var<storage, read_write> draw: Draw;
@group(0) @binding(5) var<storage, read> particles: array<Particle>;
@group(0) @binding(6) var<uniform> material: Options;
@group(0) @binding(7) var<storage, read> bundles: array<Bundle>;
@group(0) @binding(8) var<storage, read_write> cellMasks: array<atomic<u32>>;

fn cellIndex(q: vec3<u32>) -> u32 {
  return q.x + grid.size.x * (q.y + grid.size.y * q.z);
}

fn transverseBound(p: Particle) -> f32 {
  let r = abs(particleLightBaseRadius(p, material));
  return 4.0 * max(r.x, max(r.y, r.z));
}

@compute @workgroup_size(64)
fn indexCurrent(@builtin(global_invocation_id) gid: vec3<u32>) {
  let slot = gid.x + gid.y * grid.dispatch.x;
  if (slot >= arrayLength(&slotCells)) { return; }
  slotCells[slot] = 0u;
  let p = particles[slot];
  if (p.anchor.w <= 0.0 || p.shape.w <= 0.0) { return; }

  // Each particle has one address. Outliers are still tested by the raster.
  // Its support is a projected rectangle (2.5 radii along each eigenaxis)
  // and an independent acquired axial interval, not a 3D ellipsoid.
  let q = (p.anchor.xyz - grid.origin.xyz) / grid.origin.w;
  let transverse = transverseBound(p);
  let axial = p.shape.w * 0.5;
  let finite = all((bitcast<vec2<u32>>(vec2<f32>(transverse, axial)) &
                    vec2<u32>(0x7f800000u)) != vec2<u32>(0x7f800000u));
  var cell = grid.size.w;
  if (finite && all(q >= vec3<f32>(0.0)) && all(q < vec3<f32>(grid.size.xyz))) {
    cell = cellIndex(vec3<u32>(q));
    atomicMax(&cells[cell].transverse, bitcast<u32>(transverse));
    atomicMax(&cells[cell].axial, bitcast<u32>(axial));
  }
  slotCells[slot] = cell + 1u;
  atomicStore(&cells[cell].occupied, 1u);
}

fn touchesBundle(p: vec3<f32>, transverse: f32, axial: f32, halfCell: f32, b: Bundle) -> bool {
  let delta = p - b.origin.xyz;
  // Round the broad phase outward for cell addressing and the FP32 projections.
  let magnitude = abs(p) + abs(b.origin.xyz);
  let pad = 8e-6 * (1.0 + magnitude.x + magnitude.y + magnitude.z + grid.origin.w);
  let lateral = transverse + pad;
  let x = abs(dot(delta, b.right.xyz));
  let y = abs(dot(delta, b.up.xyz));
  if (x > b.right.w + lateral + dot(abs(b.right.xyz), vec3<f32>(halfCell)) ||
      y > b.up.w + lateral + dot(abs(b.up.xyz), vec3<f32>(halfCell))) { return false; }
  let z = dot(delta, b.forward.xyz);
  let depth = axial + pad + dot(abs(b.forward.xyz), vec3<f32>(halfCell));
  return z + depth >= b.origin.w && z - depth <= b.forward.w;
}

fn cellTouches(cell: u32, b: Bundle) -> bool {
  if (cell == grid.size.w) { return true; }
  let xy = grid.size.x * grid.size.y;
  let q = vec3<u32>(cell % grid.size.x, cell / grid.size.x % grid.size.y, cell / xy);
  let p = grid.origin.xyz + (vec3<f32>(q) + 0.5) * grid.origin.w;
  let transverse = bitcast<f32>(atomicLoad(&cells[cell].transverse));
  let axial = bitcast<f32>(atomicLoad(&cells[cell].axial));
  return touchesBundle(p, transverse, axial, grid.origin.w * 0.5, b);
}

@compute @workgroup_size(64)
fn classifyCells(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + gid.y * grid.dispatch.y;
  let totalCells = grid.size.w + 1u;
  let bundle = i / totalCells;
  if (bundle >= grid.dispatch.z) { return; }
  let cell = i % totalCells;
  if (atomicLoad(&cells[cell].occupied) == 0u) { return; }
  let b = bundles[bundle];
  if (b.weight.x <= 0.0 || !cellTouches(cell, b)) { return; }
  atomicOr(&cellMasks[cell * grid.dispatch.w + bundle / 32u], 1u << (bundle % 32u));
}

@compute @workgroup_size(64)
fn gatherCandidates(@builtin(global_invocation_id) gid: vec3<u32>) {
  let slot = gid.x + gid.y * grid.dispatch.x;
  if (slot >= arrayLength(&slotCells)) { return; }
  let key = slotCells[slot];
  if (key == 0u) { return; }
  let cell = key - 1u;
  // Each invocation reads one compact address and the admission bits for
  // that cell. A dense cell never serializes its whole population in a lane.
  // Material in rejected cells is never fetched by this pass.
  for (var word = 0u; word < grid.dispatch.w; word++) {
    var mask = atomicLoad(&cellMasks[cell * grid.dispatch.w + word]);
    if (mask == 0u) { continue; }
    let p = particles[slot];
    let transverse = transverseBound(p);
    while (mask != 0u) {
      let bit = firstTrailingBit(mask);
      mask &= mask - 1u;
      let bundle = word * 32u + bit;
      if (cell != grid.size.w && !touchesBundle(p.anchor.xyz, transverse, p.shape.w * 0.5, 0.0, bundles[bundle])) {
        continue;
      }
      let i = atomicAdd(&draw.candidates, 1u);
      if (i < arrayLength(&candidates)) { candidates[i] = bundle * arrayLength(&slotCells) + slot; }
    }
  }
}

@compute @workgroup_size(1)
fn finishCandidateDraw() {
  let count = atomicLoad(&draw.candidates);
  let overflow = count > arrayLength(&candidates);
  draw.vertices = 6u;
  draw.instances = select(count, arrayLength(&slotCells) * grid.dispatch.z, overflow);
  draw.firstVertex = 0u;
  draw.firstInstance = 0u;
  draw.dense = u32(overflow);
}
`;

export const packetCandidateProfilePasses = Object.freeze([
  'packet-current-index', 'packet-cell-cull', 'packet-candidates', 'packet-draw-count',
]);

function retireBuffers(device, old) {
  if (!old) return;
  queueMicrotask(() => device.queue.onSubmittedWorkDone().catch(()=>{}).then(() => {
    for (const buffer of Object.values(old)) buffer.destroy();
  }));
}

export function createPacketCandidateIndex(device) {
  let buffers, indexedFrame;
  return {
    prepare(encoder, material, cellBytes, slotBytes, encodeIndex) {
      if (!buffers || buffers.cells.size !== cellBytes || buffers.slotCells.size !== slotBytes) {
        retireBuffers(device, buffers);
        const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
        buffers = {
          cells: device.createBuffer({label:'candidate cells',size:cellBytes,usage}),
          slotCells: device.createBuffer({label:'current address per particle',size:slotBytes,usage}),
        };
        indexedFrame = null;
      }
      const {particles, options, identity} = material;
      // The shared owner offers its single index to consumers of one encoded
      // material frame. Independent callers without an identity rebuild.
      const current = identity && [particles, options, identity.epoch, identity.frame, identity.materialStamp];
      const reused = !!(current && indexedFrame && current.every((v,i) => v === indexedFrame[i]));
      if (!reused) {
        encoder.clearBuffer(buffers.cells);
        encodeIndex(buffers);
        indexedFrame = current;
      }
      return {...buffers, reused};
    },
    dispose() { retireBuffers(device,buffers); buffers = indexedFrame = null; },
  };
}

export function createPacketCandidates(device, bundleStruct) {
  const module = device.createShaderModule({
    label: 'current particle support index',
    code: PARTICLE_LIGHT_MATERIAL_WGSL + '\n' + bundleStruct + '\n' + PACKET_CANDIDATE_WGSL,
  });
  const pipelines = ['indexCurrent', 'classifyCells', 'gatherCandidates', 'finishCandidateDraw'].map(entryPoint =>
    device.createComputePipeline({layout:'auto', compute:{module,entryPoint}}));
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  let workspace = null;
  const localIndex = createPacketCandidateIndex(device);
  function dispatch(n) {
    const groups = Math.ceil(n / 64), max = device.limits.maxComputeWorkgroupsPerDimension;
    const x = Math.min(groups, max), y = Math.ceil(groups / x);
    if (!(y <= max && x * y * 64 <= 0xffffffff)) throw Error('Particle candidate dispatch exceeds device capacity');
    return {x,y};
  }

  return {
    encode(encoder, {material, bundleBuffer, plan, profileWrites}) {
      const domain = material.domain;
      if (!domain?.origin?.every(v => Number.isFinite(Math.fround(v))) || domain.origin.length !== 3 ||
          domain?.dims?.length !== 3 || !domain.dims.every(v => Number.isSafeInteger(v) && v > 0) ||
          !(Math.fround(domain.pitch * 4) > 0 && Number.isFinite(Math.fround(domain.pitch * 4)))) {
        throw Error('Current particle candidates require a finite material domain');
      }
      // Four Fine cells per bin is an initial broad-phase resolution. Every bin
      // is queried conservatively, including the no-domain overflow address.
      const dims = domain.dims.map(v => Math.ceil(v / 4));
      const cellCount = dims.reduce((a,b) => a*b, 1) + 1;
      const cellBytes = cellCount * 12;
      const words = Math.ceil(plan.bundles / 32);
      const maskBytes = cellCount * words * 4;
      const limit = Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize);
      if (![cellBytes,maskBytes].every(n => Number.isSafeInteger(n) && n <= limit)) throw Error('Particle index exceeds device capacity');
      const indexWork = dispatch(plan.slots);
      const gatherWork = dispatch(cellCount * plan.bundles);
      // The six narrow resident columns shared more than one pool's worth of
      // pairs in the authored plume profile. Allow two hits per slot on
      // average, subject to hardware limits and the dense pair count.
      // Workspace overflow takes the complete dense draw.
      const slotBytes = plan.slots * 4;
      const pairBytes = 4 * Math.min(plan.instances, 2 * plan.slots, Math.floor(limit / 4));
      if (!workspace || workspace.masks.size !== maskBytes || workspace.ids.size !== pairBytes) {
        const buffer = (label,size,extra=0) => device.createBuffer({label,size,usage:usage|extra});
        retireBuffers(device,workspace);
        workspace = {
          grid: device.createBuffer({label:'current candidate grid',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),
          masks: buffer('bundle admission bits per cell',maskBytes),
          ids: buffer('current bundle and slot pairs',pairBytes),
          draw: buffer('bundle indirect draw and candidate count',24,GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_SRC),
        };
      }
      const {grid,masks,ids,draw} = workspace;
      const data = new ArrayBuffer(48);
      new Float32Array(data).set([...domain.origin,domain.pitch*4]);
      const u = new Uint32Array(data);
      u.set([...dims,cellCount-1],4);
      u.set([indexWork.x*64,gatherWork.x*64,plan.bundles,words],8);
      device.queue.writeBuffer(grid,0,data);
      encoder.clearBuffer(masks);
      encoder.clearBuffer(draw);
      function compute(i, bindings, x, y=1) {
        const pipeline = pipelines[i], label = packetCandidateProfilePasses[i];
        const pass = encoder.beginComputePass({label,...profileWrites(label)});
        pass.setPipeline(pipeline);
        pass.setBindGroup(0,device.createBindGroup({
          layout:pipeline.getBindGroupLayout(0),
          entries:bindings.map(([binding,buffer])=>({binding,resource:{buffer}})),
        }));
        pass.dispatchWorkgroups(x,y);
        pass.end();
      }
      // Private callers get a fresh build. A shared index is explicitly
      // supplied by the owner of the current optical-particle frame.
      const {cells,slotCells,reused} = (material.candidateIndex ?? localIndex).prepare(
        encoder, material.candidateIndex ? material : {...material,identity:null}, cellBytes, slotBytes,
        ({cells,slotCells}) => compute(0,[[0,grid],[1,cells],[2,slotCells],[5,material.particles],[6,material.options]],indexWork.x,indexWork.y));

      compute(1,[[0,grid],[1,cells],[7,bundleBuffer],[8,masks]],gatherWork.x,gatherWork.y);
      compute(2,[[0,grid],[2,slotCells],[3,ids],[4,draw],[5,material.particles],[6,material.options],[7,bundleBuffer],[8,masks]],indexWork.x,indexWork.y);
      compute(3,[[0,grid],[2,slotCells],[3,ids],[4,draw]],1);
      return {ids,draw,cellCount,reusedIndex:reused,bytes:cellBytes+maskBytes+slotBytes+pairBytes+72};
    },
    dispose() { localIndex.dispose(); retireBuffers(device,workspace); workspace = null; },
  };
}
