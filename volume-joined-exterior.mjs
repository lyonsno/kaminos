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
export const JOINED_EXTERIOR_OUTER_ROUTE = 'joined-exterior-on-outer-smoke-v0';

// Exterior shape for a fine box of `fineDims` cells at `ratio`: `extent`
// coarse cells across and deep, tall enough to hold the box with one coarse
// cell below and at least one above; the box is centred in x and z.
export function resolveJoinedExteriorGeometry({ fineDims, pitch, ratio, extent }) {
  if (!Number.isInteger(ratio) || ratio < 1) return { admitted: false, reason: 'integer-ratio-required' };
  // `extent`: coarse cells across (x and z; height at least the box plus one
  // cell above and below), or an explicit [x, y, z] shape.
  const ext = Array.isArray(extent) ? extent : [extent, extent, extent];
  if (ext.length !== 3 || ext.some(n => !Number.isInteger(n) || n < 4)) return { admitted: false, reason: 'extent-below-4' };
  if (fineDims.some(d => d % ratio !== 0)) return { admitted: false, reason: `fine-dims-${fineDims.join('x')}-not-multiples-of-ratio-${ratio}` };
  const fineCoarse = fineDims.map(d => d / ratio);
  if (ext[0] < fineCoarse[0] + 2 || ext[2] < fineCoarse[2] + 2) return { admitted: false, reason: `extent-${ext.join('x')}-too-small-for-fine-${fineCoarse.join('x')}-plus-margins` };
  const shape = [ext[0], Math.max(ext[1], fineCoarse[1] + 2), ext[2]];
  const origin = [Math.floor((shape[0] - fineCoarse[0]) / 2), 1, Math.floor((shape[2] - fineCoarse[2]) / 2)];
  const cellWidth = pitch * ratio;
  return {
    admitted: true, reason: null, shape, origin, fineCoarse, cellWidth,
    geometry: { shape, min: [0, 0, 0], cellWidth, fine: { min: origin.map(v => v * cellWidth), max: origin.map((v, a) => (v + fineCoarse[a]) * cellWidth), ratio } },
    // The fine producer's ghost geometry: exterior origin in fine cells
    // relative to the fine box, exterior cell width in fine cells.
    ghosts: { originFine: origin.map(v => -v * ratio), cellWidthFine: ratio, dims: shape, finePitchLocal: pitch },
  };
}

// Geometry on Sexy Fireman's exterior smoke lattice (volume-outer-smoke.mjs):
// shape [g, 2g, g], local min -E, cell width 2E/g, fine box [-1, 1] x
// [-1, 2 nearHeightRatio - 1] x [-1, 1]. The composite needs a whole number of
// fine cells per exterior cell and the fine box on exterior cell faces.
export function resolveOuterLatticeGeometry({ fineDims, pitch, outer }) {
  const cw = outer.cellWidth, ratioExact = cw / pitch, ratio = Math.round(ratioExact);
  if (Math.abs(ratioExact - ratio) > 1e-6 || ratio < 1) return { admitted: false, reason: `outer-cell-${cw.toFixed(5)}-not-whole-fine-cells-${ratioExact.toFixed(4)}` };
  if (fineDims.some(d => d % ratio !== 0)) return { admitted: false, reason: `fine-dims-${fineDims.join('x')}-not-multiples-of-ratio-${ratio}` };
  const top = -1 + 2 * fineDims[1] / fineDims[0];
  const originExact = [-1, -1, -1].map((v, a) => (v - outer.min[a]) / cw), origin = originExact.map(Math.round);
  if (originExact.some((v, a) => Math.abs(v - origin[a]) > 1e-6)) return { admitted: false, reason: 'fine-box-not-on-outer-cell-faces' };
  const fineCoarse = fineDims.map(d => d / ratio), shape = outer.shape.slice();
  if (origin.some((o, a) => o < 1 || o + fineCoarse[a] > shape[a] - 1)) return { admitted: false, reason: `fine-box-not-inside-outer-with-margin:${JSON.stringify({ origin, fineCoarse, shape, top })}` };
  return {
    admitted: true, reason: null, shape, origin, fineCoarse, cellWidth: cw, ratio, lattice: 'outer-smoke',
    geometry: { shape, min: outer.min.slice(), cellWidth: cw, fine: { min: [-1, -1, -1], max: [1, top, 1], ratio } },
    ghosts: { originFine: origin.map(v => -v * ratio), cellWidthFine: ratio, dims: shape, finePitchLocal: pitch },
  };
}

// Synthetic exterior solids: an axis-aligned slab `wall` = { axis, at, thickness }
// in coarse cells, spanning the other two axes; null means no exterior solids.
// A wall may also be given relative to the fine box: { side: '+x'|'-x'|'+z'|'-z',
// gap, thickness } in coarse cells, resolved against the exterior geometry.
export function resolveJoinedExteriorWall(wall, g) {
  if (!wall) return null;
  if (wall.side) {
    const axis = wall.side.endsWith('x') ? 0 : 2, positive = wall.side.startsWith('+'), gap = wall.gap ?? 2, thickness = wall.thickness ?? 2;
    const at = positive ? g.origin[axis] + g.fineCoarse[axis] + gap : g.origin[axis] - gap - thickness;
    if (at < 0 || at + thickness > g.shape[axis]) return { axis, at, thickness, outside: true };
    return { axis, at, thickness, side: wall.side, gap };
  }
  return { axis: wall.axis, at: wall.at, thickness: wall.thickness ?? 1 };
}
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

export function createJoinedExterior(device, { extent, ratio = 4, wall = null, budget = 32, tolerance = 1e-3, outer = null } = {}) {
  if (!Number.isInteger(budget) || budget < 1) throw new Error('positive integer budget required');
  let built = null, destroyed = false, lastStep = null, paused = false;
  const destroyBuilt = () => { if (!built) return; for (const r of built.owned) r.destroy?.(); built = null; };
  const key = producer => JSON.stringify({ dims: producer.dims, pitch: producer.pitch, solid: producer.solidMask?.revision ?? 'disabled', allocation: producer.allocation ?? null, buffers: producer.fluidBuffers?.map(b => b.label ?? '?'), lower: producer.lowerFaceTexture?.label ?? null, extent, ratio, wall, outer: outer ? [outer.shape, outer.min, outer.cellWidth] : null });

  // Builds the composite around the producer's current grid. Runs outside
  // encoding (it allocates and uploads); the caller binds the ghost geometry
  // it returns before the next step.
  const prepare = producer => {
    if (destroyed) throw new Error('joined exterior destroyed');
    const k = key(producer);
    if (built && built.key === k) return { rebuilt: false, ...built.summary };
    destroyBuilt();
    const g = outer ? resolveOuterLatticeGeometry({ fineDims: producer.dims, pitch: producer.pitch, outer }) : resolveJoinedExteriorGeometry({ fineDims: producer.dims, pitch: producer.pitch, ratio, extent });
    if (!g.admitted) { built = { key: k, owned: [], refused: g.reason, summary: { admitted: false, reason: g.reason } }; return { rebuilt: true, admitted: false, reason: g.reason }; }
    if (!producer.fluidBuffers || producer.fluidBuffers.length !== 2 || !producer.lowerFaceTexture || !producer.burnRateTexture) {
      built = { key: k, owned: [], refused: 'producer-resources-missing', summary: { admitted: false, reason: 'producer-resources-missing' } };
      return { rebuilt: true, admitted: false, reason: 'producer-resources-missing' };
    }
    const fineCount = producer.dims[0] * producer.dims[1] * producer.dims[2];
    const fineSolids = producer.solidMask
      ? { shape: producer.dims.slice(), cells: Uint8Array.from(producer.solidMask.cells, v => (v ? 1 : 0)), revision: `fine:${producer.solidMask.revision}` }
      : { shape: producer.dims.slice(), cells: new Uint8Array(fineCount), revision: 'fine:disabled' };
    const slab = resolveJoinedExteriorWall(wall, g);
    if (slab?.outside) { built = { key: k, owned: [], refused: 'wall-outside-exterior', summary: { admitted: false, reason: `wall-outside-exterior:${JSON.stringify(slab)}` } }; return { rebuilt: true, admitted: false, reason: 'wall-outside-exterior' }; }
    const coarseSolids = joinedExteriorSolids(g.shape, slab);
    const owned = [];
    try {
      const layout = createCompositeProducerLayout({ geometry: g.geometry, fineSolids, coarseSolids });
      const grid = layout.grid;
      const storage = createCompositeStorageLayout(grid);
      if (storage.fineLength * 4 !== producer.fluidBuffers[0].size) throw new Error(`fine buffer ${producer.fluidBuffers[0].size} bytes does not match the composite's ${storage.fineLength * 4}`);
      const alloc = (label, size) => { const b = device.createBuffer({ label, size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST }); owned.push(b); return b; };
      const coarse = outer ? null : alloc('joined exterior coarse sites', storage.coarseLength * 4);
      const lower = alloc('joined exterior lower sidecar', storage.lowerLength * 4);
      const solver = createCompositePCGGPU(device, grid, { tolerance }); owned.push(solver);
      const intake = createCompositeProducerGPU(device, layout); owned.push(intake);
      const bridgeCache = new Map();
      const bridgeFor = (fine, coarseBuffer) => { const k = `${producer.fluidBuffers.indexOf(fine)}:${coarseBuffer.label}`; let b = bridgeCache.get(k); if (!b) { b = createCompositeStorageGPU(device, storage, { fine, coarse: coarseBuffer, lower, flux: solver.fluxBuffer }); owned.push(b); bridgeCache.set(k, b); } return b; };
      if (coarse) producer.fluidBuffers.forEach(fine => bridgeFor(fine, coarse));
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
  textureStore(ghostB, p, select(vec4<f32>(0.0), vec4<f32>(coarse[i * 8u + 4u], coarse[i * 8u + 5u], 0.0, 0.0), ${outer ? 'true' : 'false'}));
}` });
      const ghostPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: ghostModule, entryPoint: 'fill' } });
      const ghostGroup = (textures, coarseBuffer = coarse) => device.createBindGroup({ layout: ghostPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: coarseBuffer } }, { binding: 1, resource: textures.a.createView() }, { binding: 2, resource: textures.b.createView() }] });
      const summary = { admitted: true, reason: null, route: outer ? JOINED_EXTERIOR_OUTER_ROUTE : JOINED_EXTERIOR_ROUTE, lattice: outer ? 'outer-smoke' : 'own', shape: g.shape, origin: g.origin, fineCoarse: g.fineCoarse, cellWidth: g.cellWidth, ratio: g.ratio ?? ratio, extent: outer ? null : extent, cells: grid.cells.length, faces: grid.faces.length, budget, tolerance, solids: { fine: fineSolids.revision, coarse: coarseSolids.revision, wall: slab, exteriorSolidCells: coarseSolids.cells.reduce((s, v) => s + v, 0) }, solver: 'gpu-composite-pcg-candidate' };
      built = { key: k, owned, layout, storage, grid, solver, intake, bridgeFor, coarse, lowerExport, ghostPipeline, ghostGroup, sites, ghosts: g.ghosts, solidRevisions: { fine: fineSolids.revision, coarse: coarseSolids.revision }, summary, steps: 0 };
      return { rebuilt: true, ...summary, ghosts: g.ghosts };
    } catch (e) { for (const r of owned) r.destroy?.(); built = { key: k, owned: [], refused: e.message, summary: { admitted: false, reason: e.message } }; return { rebuilt: true, admitted: false, reason: e.message }; }
  };

  // Fills the ghosts from the current (initially zero) exterior so the first
  // fine step has a bound generation; submits its own encoder.
  const seedGhosts = producer => {
    if (!built?.solver || !built.coarse) return false;
    const textures = producer.ghosts?.textures; if (!textures) return false;
    const e = device.createCommandEncoder({ label: 'joined exterior ghost seed' });
    const pass = e.beginComputePass(); pass.setPipeline(built.ghostPipeline); pass.setBindGroup(0, built.ghostGroup(textures)); pass.dispatchWorkgroups(Math.ceil(built.sites / 64)); pass.end();
    device.queue.submit([e.finish()]);
    return true;
  };

  // One joined step on the caller's encoder. Returns whether the exterior
  // stepped; a refusal names why and leaves the fine state untouched.
  const step = (encoder, producer, coarseBuffer = null) => {
    if (destroyed) throw new Error('joined exterior destroyed');
    if (!built || built.key !== key(producer)) { lastStep = { stepped: false, reason: 'exterior-not-prepared-for-current-producer' }; return lastStep; }
    if (!built.solver) { lastStep = { stepped: false, reason: built.refused }; return lastStep; }
    const textures = producer.ghosts?.textures;
    if (!textures) { lastStep = { stepped: false, reason: 'ghost-textures-missing' }; return lastStep; }
    const coarseNow = coarseBuffer ?? built.coarse;
    if (!coarseNow) { lastStep = { stepped: false, reason: 'outer-state-buffer-required' }; return lastStep; }
    const bridge = built.bridgeFor(producer.fluidBuffers[producer.fluidReadIndex], coarseNow);
    built.intake.encode(encoder, { targetTexture: producer.burnRateTexture, solidRevisions: built.solidRevisions });
    bridge.encodeGather(encoder, { interfaceSource: 'fine' });
    built.solver.encodeGPU(encoder, { targetBuffer: built.intake.targetBuffer, iterations: budget });
    bridge.encodeScatter(encoder);
    built.lowerExport.encode(encoder);
    const pass = encoder.beginComputePass({ label: 'joined exterior ghost fill' });
    pass.setPipeline(built.ghostPipeline); pass.setBindGroup(0, built.ghostGroup(textures, coarseNow)); pass.dispatchWorkgroups(Math.ceil(built.sites / 64)); pass.end();
    built.lastCoarse = coarseNow;
    built.steps += 1;
    lastStep = { stepped: true, reason: null, steps: built.steps, budget };
    return lastStep;
  };

  return {
    prepare, seedGhosts, step,
    get ghosts() { return built?.ghosts ?? null; },
    get usesOuter() { return Boolean(outer); },
    receipt() { return { route: JOINED_EXTERIOR_ROUTE, extent, ratio, wall, budget, tolerance, prepared: Boolean(built?.solver), ...(built?.summary ?? {}), lastStep, steps: built?.steps ?? 0 }; },
    // Solve receipt from the last encoded step (maps a buffer; not for the frame loop).
    get paused() { return paused; },
    // What the exterior carries after the last step: coarse face velocities
    // and the fine box's lower boundary faces (side/bottom inflow), in the
    // producers' units (coarse local units; fine cells per reference tick).
    async stats() {
      if (!built?.solver) return { status: 'unprepared' };
      if (!built.steps) return { status: 'no-step-yet' };
      paused = true;
      try {
        await device.queue.onSubmittedWorkDone();
        const read = async (buffer, length) => { const dst = device.createBuffer({ size: length * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); try { const e = device.createCommandEncoder(); e.copyBufferToBuffer(buffer, 0, dst, 0, length * 4); device.queue.submit([e.finish()]); await dst.mapAsync(GPUMapMode.READ); return new Float32Array(dst.getMappedRange().slice(0)); } finally { dst.destroy(); } };
        const coarseBuf = built.coarse ?? built.lastCoarse;
        const lowerBuf = built.owned.find(b => b.label === 'joined exterior lower sidecar');
        const coarse = await read(coarseBuf, built.storage.coarseLength), lower = await read(lowerBuf, built.storage.lowerLength);
        const summarize = values => { let max = 0, sum = 0, n = 0, nonzero = 0; for (const v of values) { const a = Math.abs(v); if (!Number.isFinite(a)) return { nonfinite: true }; max = Math.max(max, a); sum += a; n++; if (a > 1e-7) nonzero++; } return { max, mean: n ? sum / n : 0, nonzero, of: n }; };
        const coarseFaces = []; for (let i = 0; i < coarse.length; i += 8) coarseFaces.push(coarse[i], coarse[i + 1], coarse[i + 2]);
        const offs = built.storage.lowerOffsets;
        const planes = ['x', 'y', 'z'].map((axis, a) => ({ axis, ...summarize(lower.subarray(offs[a], offs[a + 1])) }));
        const smoke = [], heat = [], outside = [];
        const S = built.summary.shape.map(n => n + 1), o = built.summary.origin, f = built.summary.fineCoarse;
        for (let i = 0, site = 0; i < coarse.length; i += 8, site++) {
          smoke.push(coarse[i + 4]); heat.push(coarse[i + 5]);
          const q = [site % S[0], Math.floor(site / S[0]) % S[1], Math.floor(site / (S[0] * S[1]))];
          if (q.every((v, a) => v < S[a] - 1) && q.some((v, a) => v < o[a] || v >= o[a] + f[a])) outside.push(coarse[i + 4]);
        }
        return { status: 'sampled', steps: built.steps, coarse: summarize(coarseFaces), lowerPlanes: planes, exteriorSmoke: summarize(smoke), exteriorHeat: summarize(heat), smokeOutsideFineBox: summarize(outside) };
      } finally { paused = false; }
    },
    // Pauses the joined step (the core skips the whole sim step while paused)
    // so the readback sees one encoded solve, then resumes.
    async probe() {
      if (!built?.solver) return { status: 'unprepared' };
      if (!built.steps) return { status: 'no-step-yet' };
      paused = true;
      try {
        await device.queue.onSubmittedWorkDone();
        const r = await built.solver.readback();
        return { status: 'sampled', converged: r.converged, iterations: r.receipt.iterations, budget, maxDivergenceError: r.receipt.maxDivergenceError, cells: r.receipt.cells, faces: r.receipt.faces, warm: r.receipt.warmStartRequested, steps: built.steps };
      } finally { paused = false; }
    },
    destroy() { if (!destroyed) { destroyBuilt(); destroyed = true; } },
  };
}
