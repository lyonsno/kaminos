// Provisional exterior for the joined boundary: a quiescent coarse box around
// the fine grid, coupled by pressure only, so the live route can be smoked
// before the exterior owner's producer lands. Each sim step, on the same
// encoder, after fine transport and before the (skipped) fine projection:
//   target intake (binding-19 burn rate -> composite leaf target)
//   gather (fine upper faces + lower sidecar + coarse faces -> composite flux)
//   shared projection (the PCG candidate, warm, explicit budget)
//   scatter (projected flux -> fine faces, lower sidecar, coarse faces)
//   lower-plane export (sidecar -> the fine producer's three-layer texture)
//   ghost fill (coarse site velocities -> ghost A; ghost B stays zero)
// The exterior has no transport of its own: its velocities are whatever the
// last projection left on its faces. Solids: the fine producer's effective
// mask, plus an optional synthetic wall slab in the exterior.
// Machinery: Sexy Fireman's composite grid, storage bridge, producer intake
// and PCG candidate, unchanged. Nothing here is a landing of her integration.
import { createCompositeProducerLayout } from './volume-composite-producer.mjs';
import { createCompositeProducerGPU } from './volume-composite-producer-gpu.mjs';
import { createCompositeStorageLayout } from './volume-composite-storage.mjs';
import { createCompositeStorageGPU, createCompositeLowerFaceGPU } from './volume-composite-storage-gpu.mjs';
import { createCompositePCGGPU } from './volume-composite-pcg-gpu.mjs';

export const JOINED_EXTERIOR_ROUTE = 'joined-exterior-quiescent-pressure-only-v0';

// Exterior shape for a fine box of `fineDims` cells at `ratio`: `extent`
// coarse cells across and deep, tall enough to hold the box with one coarse
// cell below and at least one above; the box is centred in x and z.
export function resolveJoinedExteriorGeometry({ fineDims, pitch, ratio, extent }) {
  if (!Number.isInteger(ratio) || ratio < 1) return { admitted: false, reason: 'integer-ratio-required' };
  if (!Number.isInteger(extent) || extent < 4) return { admitted: false, reason: 'extent-below-4' };
  if (fineDims.some(d => d % ratio !== 0)) return { admitted: false, reason: `fine-dims-${fineDims.join('x')}-not-multiples-of-ratio-${ratio}` };
  const fineCoarse = fineDims.map(d => d / ratio);
  if (extent < fineCoarse[0] + 2 || extent < fineCoarse[2] + 2) return { admitted: false, reason: `extent-${extent}-too-small-for-fine-${fineCoarse.join('x')}-plus-margins` };
  const shape = [extent, Math.max(extent, fineCoarse[1] + 2), extent];
  const origin = [Math.floor((extent - fineCoarse[0]) / 2), 1, Math.floor((extent - fineCoarse[2]) / 2)];
  const cellWidth = pitch * ratio;
  return {
    admitted: true, reason: null, shape, origin, fineCoarse, cellWidth,
    geometry: { shape, min: [0, 0, 0], cellWidth, fine: { min: origin.map(v => v * cellWidth), max: origin.map((v, a) => (v + fineCoarse[a]) * cellWidth), ratio } },
    // The fine producer's ghost geometry: exterior origin in fine cells
    // relative to the fine box, exterior cell width in fine cells.
    ghosts: { originFine: origin.map(v => -v * ratio), cellWidthFine: ratio, dims: shape, finePitchLocal: pitch },
  };
}

// Synthetic exterior solids: an axis-aligned slab `wall` = { axis, at, thickness }
// in coarse cells, spanning the other two axes; null means no exterior solids.
export function joinedExteriorSolids(shape, wall) {
  const count = shape[0] * shape[1] * shape[2];
  const cells = new Uint8Array(count);
  if (wall) {
    const { axis, at, thickness = 1 } = wall;
    if (![0, 1, 2].includes(axis) || !Number.isInteger(at) || !Number.isInteger(thickness) || thickness < 1) throw new Error('wall needs integer axis 0..2, at, thickness >= 1');
    for (let z = 0; z < shape[2]; z++) for (let y = 0; y < shape[1]; y++) for (let x = 0; x < shape[0]; x++) {
      const q = [x, y, z];
      if (q[axis] >= at && q[axis] < at + thickness) cells[x + shape[0] * (y + shape[1] * z)] = 1;
    }
  }
  return { shape: shape.slice(), cells, revision: wall ? `wall:${wall.axis}:${wall.at}:${wall.thickness ?? 1}` : 'none' };
}

export function createJoinedExterior(device, { extent, ratio = 4, wall = null, budget = 32, tolerance = 1e-3 } = {}) {
  if (!Number.isInteger(budget) || budget < 1) throw new Error('positive integer budget required');
  let built = null, destroyed = false, lastStep = null;
  const destroyBuilt = () => { if (!built) return; for (const r of built.owned) r.destroy?.(); built = null; };
  const key = producer => JSON.stringify({ dims: producer.dims, pitch: producer.pitch, solid: producer.solidMask?.revision ?? 'disabled', allocation: producer.allocation ?? null, buffers: producer.fluidBuffers?.map(b => b.label ?? '?'), lower: producer.lowerFaceTexture?.label ?? null, extent, ratio, wall });

  // Builds the composite around the producer's current grid. Runs outside
  // encoding (it allocates and uploads); the caller binds the ghost geometry
  // it returns before the next step.
  const prepare = producer => {
    if (destroyed) throw new Error('joined exterior destroyed');
    const k = key(producer);
    if (built && built.key === k) return { rebuilt: false, ...built.summary };
    destroyBuilt();
    const g = resolveJoinedExteriorGeometry({ fineDims: producer.dims, pitch: producer.pitch, ratio, extent });
    if (!g.admitted) { built = { key: k, owned: [], refused: g.reason, summary: { admitted: false, reason: g.reason } }; return { rebuilt: true, admitted: false, reason: g.reason }; }
    if (!producer.fluidBuffers || producer.fluidBuffers.length !== 2 || !producer.lowerFaceTexture || !producer.burnRateTexture) {
      built = { key: k, owned: [], refused: 'producer-resources-missing', summary: { admitted: false, reason: 'producer-resources-missing' } };
      return { rebuilt: true, admitted: false, reason: 'producer-resources-missing' };
    }
    const fineCount = producer.dims[0] * producer.dims[1] * producer.dims[2];
    const fineSolids = producer.solidMask
      ? { shape: producer.dims.slice(), cells: Uint8Array.from(producer.solidMask.cells, v => (v ? 1 : 0)), revision: `fine:${producer.solidMask.revision}` }
      : { shape: producer.dims.slice(), cells: new Uint8Array(fineCount), revision: 'fine:disabled' };
    const coarseSolids = joinedExteriorSolids(g.shape, wall);
    const owned = [];
    try {
      const layout = createCompositeProducerLayout({ geometry: g.geometry, fineSolids, coarseSolids });
      const grid = layout.grid;
      const storage = createCompositeStorageLayout(grid);
      if (storage.fineLength * 4 !== producer.fluidBuffers[0].size) throw new Error(`fine buffer ${producer.fluidBuffers[0].size} bytes does not match the composite's ${storage.fineLength * 4}`);
      const alloc = (label, size) => { const b = device.createBuffer({ label, size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }); owned.push(b); return b; };
      const coarse = alloc('joined exterior coarse sites', storage.coarseLength * 4);
      const lower = alloc('joined exterior lower sidecar', storage.lowerLength * 4);
      const solver = createCompositePCGGPU(device, grid, { tolerance }); owned.push(solver);
      const intake = createCompositeProducerGPU(device, layout); owned.push(intake);
      const bridges = producer.fluidBuffers.map(fine => { const b = createCompositeStorageGPU(device, storage, { fine, coarse, lower, flux: solver.fluxBuffer }); owned.push(b); return b; });
      const lowerExport = createCompositeLowerFaceGPU(device, { dims: producer.dims, lowerBuffer: lower, lowerFaceTexture: producer.lowerFaceTexture });
      // Ghost A from the coarse sites: her coarse storage is 8 floats per
      // (N+1)^3 site, lower-face velocity in local units at 0..2; ghost A is
      // (vx, vy, vz, soot) per padded site, same site order.
      const sites = (g.shape[0] + 1) * (g.shape[1] + 1) * (g.shape[2] + 1);
      const ghostModule = device.createShaderModule({ label: 'joined exterior ghost fill', code: /* wgsl */`
const SITES: u32 = ${sites}u; const SX: u32 = ${g.shape[0] + 1}u; const SY: u32 = ${g.shape[1] + 1}u;
@group(0) @binding(0) var<storage, read> coarse: array<f32>;
@group(0) @binding(1) var ghostA: texture_storage_3d<rgba32float, write>;
@group(0) @binding(2) var ghostB: texture_storage_3d<rgba32float, write>;
@compute @workgroup_size(64) fn fill(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x; if (i >= SITES) { return; }
  let p = vec3<i32>(i32(i % SX), i32((i / SX) % SY), i32(i / (SX * SY)));
  textureStore(ghostA, p, vec4<f32>(coarse[i * 8u], coarse[i * 8u + 1u], coarse[i * 8u + 2u], 0.0));
  textureStore(ghostB, p, vec4<f32>(0.0));
}` });
      const ghostPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: ghostModule, entryPoint: 'fill' } });
      const ghostGroup = textures => device.createBindGroup({ layout: ghostPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: coarse } }, { binding: 1, resource: textures.a.createView() }, { binding: 2, resource: textures.b.createView() }] });
      const summary = { admitted: true, reason: null, route: JOINED_EXTERIOR_ROUTE, shape: g.shape, origin: g.origin, fineCoarse: g.fineCoarse, cellWidth: g.cellWidth, ratio, extent, cells: grid.cells.length, faces: grid.faces.length, budget, tolerance, solids: { fine: fineSolids.revision, coarse: coarseSolids.revision, exteriorSolidCells: coarseSolids.cells.reduce((s, v) => s + v, 0) }, solver: 'gpu-composite-pcg-candidate' };
      built = { key: k, owned, layout, storage, grid, solver, intake, bridges, lowerExport, ghostPipeline, ghostGroup, sites, ghosts: g.ghosts, solidRevisions: { fine: fineSolids.revision, coarse: coarseSolids.revision }, summary, steps: 0 };
      return { rebuilt: true, ...summary, ghosts: g.ghosts };
    } catch (e) { for (const r of owned) r.destroy?.(); built = { key: k, owned: [], refused: e.message, summary: { admitted: false, reason: e.message } }; return { rebuilt: true, admitted: false, reason: e.message }; }
  };

  // Fills the ghosts from the current (initially zero) exterior so the first
  // fine step has a bound generation; submits its own encoder.
  const seedGhosts = producer => {
    if (!built?.solver) return false;
    const textures = producer.ghosts?.textures; if (!textures) return false;
    const e = device.createCommandEncoder({ label: 'joined exterior ghost seed' });
    const pass = e.beginComputePass(); pass.setPipeline(built.ghostPipeline); pass.setBindGroup(0, built.ghostGroup(textures)); pass.dispatchWorkgroups(Math.ceil(built.sites / 64)); pass.end();
    device.queue.submit([e.finish()]);
    return true;
  };

  // One joined step on the caller's encoder. Returns whether the exterior
  // stepped; a refusal names why and leaves the fine state untouched.
  const step = (encoder, producer) => {
    if (destroyed) throw new Error('joined exterior destroyed');
    if (!built || built.key !== key(producer)) { lastStep = { stepped: false, reason: 'exterior-not-prepared-for-current-producer' }; return lastStep; }
    if (!built.solver) { lastStep = { stepped: false, reason: built.refused }; return lastStep; }
    const textures = producer.ghosts?.textures;
    if (!textures) { lastStep = { stepped: false, reason: 'ghost-textures-missing' }; return lastStep; }
    const bridge = built.bridges[producer.fluidReadIndex];
    built.intake.encode(encoder, { targetTexture: producer.burnRateTexture, solidRevisions: built.solidRevisions });
    bridge.encodeGather(encoder, { interfaceSource: 'fine' });
    built.solver.encodeGPU(encoder, { targetBuffer: built.intake.targetBuffer, iterations: budget });
    bridge.encodeScatter(encoder);
    built.lowerExport.encode(encoder);
    const pass = encoder.beginComputePass({ label: 'joined exterior ghost fill' });
    pass.setPipeline(built.ghostPipeline); pass.setBindGroup(0, built.ghostGroup(textures)); pass.dispatchWorkgroups(Math.ceil(built.sites / 64)); pass.end();
    built.steps += 1;
    lastStep = { stepped: true, reason: null, steps: built.steps, budget };
    return lastStep;
  };

  return {
    prepare, seedGhosts, step,
    get ghosts() { return built?.ghosts ?? null; },
    receipt() { return { route: JOINED_EXTERIOR_ROUTE, extent, ratio, wall, budget, tolerance, prepared: Boolean(built?.solver), ...(built?.summary ?? {}), lastStep, steps: built?.steps ?? 0 }; },
    // Solve receipt from the last encoded step (maps a buffer; not for the frame loop).
    async probe() { if (!built?.solver) return { status: 'unprepared' }; const r = await built.solver.readback(); return { status: 'sampled', converged: r.converged, iterations: r.receipt.iterations, maxDivergenceError: r.receipt.maxDivergenceError, cells: r.receipt.cells, faces: r.receipt.faces, warm: r.receipt.warmStartRequested }; },
    destroy() { if (!destroyed) { destroyBuilt(); destroyed = true; } },
  };
}
