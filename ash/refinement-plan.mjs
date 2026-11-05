import {patchLayout} from './gpu-plan.mjs';
import {slidingThreshold} from './sliding.mjs';

const align = (n, multiple) => Math.ceil(n / multiple) * multiple;
const inside = (q, low, high) => q.every((v, axis) => v >= low[axis] && v < high[axis]);
const linear = (c, dims) => c[0] + dims[0] * (c[1] + dims[1] * c[2]);
const coordinates = (i, dims) => [i % dims[0], Math.floor(i / dims[0]) % dims[1], Math.floor(i / (dims[0] * dims[1]))];

// Resolution changes only storage and ownership. All material quantities use
// the volume of one finest cell, including coarse cells whose capacity is eight.
export function createRefinementLayout({cellSize, bounds, tileSize = 16, refinement}) {
  if (refinement?.ratio !== 2 || !Array.isArray(refinement.regions)) {
    throw Error('Ash refinement requires ratio 2 and explicit regions');
  }
  const base = patchLayout({cellSize: cellSize * 2, bounds, tileSize});
  const dims = base.dims.map(n => n * 2);
  const origin = [...base.origin];
  const effectiveBounds = {min: origin, max: dims.map((n, axis) => origin[axis] + n * cellSize)};
  const regions = [{scale: 2, low: [0, 0, 0], high: dims, layout: base}];
  for (const box of refinement.regions) {
    if (!box || ![box.min, box.max].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) {
      throw Error('Invalid ash fine region bounds');
    }
    const limits = [box.min, box.max].map(point => point.map((v, axis) => (v - origin[axis]) / cellSize));
    if (limits.some(point => point.some(v => Math.abs(v / 2 - Math.round(v / 2)) > 1e-6))) {
      throw Error('Ash fine regions must align to coarse cell boundaries');
    }
    const [low, high] = limits.map(point => point.map(Math.round));
    if (low.some((n, axis) => n < 0 || high[axis] > dims[axis] || high[axis] <= n)) {
      throw Error('Ash fine region must lie inside the field');
    }
    if (regions.slice(1).some(r => low.every((v, axis) => v < r.high[axis] && high[axis] > r.low[axis]))) {
      throw Error('Ash fine regions overlap');
    }
    const localBounds = {min: low.map((n, axis) => origin[axis] + n * cellSize), max: high.map((n, axis) => origin[axis] + n * cellSize)};
    regions.push({scale: 1, low, high, layout: patchLayout({cellSize, bounds: localBounds, tileSize})});
  }
  let count = 0, tileCount = 0, faceWords = 0;
  const tiles = [];
  for (const [regionId, region] of regions.entries()) {
    region.offset = align(count, 64);
    region.tileOffset = align(tileCount, 8);
    count = region.offset + region.layout.count;
    tileCount = region.tileOffset + region.layout.tiles.count;
    for (let native = 0; native < region.layout.tiles.count; native++) {
      const c = coordinates(native, region.layout.tiles.dims);
      const low = c.map((n, axis) => region.low[axis] + n * tileSize * region.scale);
      const high = low.map((n, axis) => Math.min(n + tileSize * region.scale, region.high[axis]));
      // Coarse top surfaces use finest-width quads. Interface side faces also
      // subdivide, so both resolutions share the same vertices along a seam.
      const interfaceTile = regionId === 0 && regions.slice(1).some(r => low.every((v, axis) => v <= r.high[axis] && high[axis] >= r.low[axis]));
      const capacity = tileSize ** 3 * (region.scale === 1 ? 6 : interfaceTile ? 24 : 9);
      tiles[region.tileOffset + native] = {region: regionId, coord: c, low, high, faceOffset: faceWords, faceCapacity: capacity, subdivide: interfaceTile};
      faceWords += capacity;
    }
  }
  const p = {cellSize, bounds: effectiveBounds, origin, dims, count, regions,
    refinement: structuredClone(refinement), tiles: {width: tileSize, count: tileCount, cellsPerTile: tileSize ** 3, groupsPerTile: Math.ceil(tileSize ** 3 / 64)}, faceWords};
  // Reserve only the faces this static ownership topology can emit. Covered
  // coarse cells own no material or faces, and padded tile cells need no slots.
  faceWords = 0;
  for (const tile of tiles) {
    if (!tile) continue;
    const region = regions[tile.region];
    let capacity = 0;
    for (let z = tile.low[2]; z < tile.high[2]; z += region.scale) {
      for (let y = tile.low[1]; y < tile.high[1]; y += region.scale) {
        for (let x = tile.low[0]; x < tile.high[0]; x += region.scale) {
          const q = [x, y, z];
          if (tile.region === 0 && refinementIndex(p, q) >= regions[1]?.offset) continue;
          if (region.scale === 1) { capacity += 5; continue; }
          capacity += 4; // Four shared-grid top quads.
          for (const axis of [0, 2]) for (const sign of [-1, 1]) {
            const neighbor = [...q]; neighbor[axis] += sign < 0 ? -1 : 2;
            const j = refinementIndex(p, neighbor);
            capacity += j >= 0 && refinementCell(p, j).size === 1 ? 4 : 2;
          }
        }
      }
    }
    tile.faceOffset = faceWords;
    tile.faceCapacity = capacity;
    faceWords += capacity;
  }
  p.faceWords = Math.max(1, faceWords);
  const neighbors = [];
  const tileRecords = [];
  for (let tile = 0; tile < tileCount; tile++) {
    const record = tiles[tile];
    if (!record) { tileRecords.push({region: -1, neighbors: [], faceOffset: 0, faceCapacity: 0}); continue; }
    const affected = new Set();
    for (const region of regions) {
      const width = tileSize * region.scale;
      const low = record.low.map((v, axis) => Math.max(0, Math.floor((v - 2 - region.low[axis]) / width)));
      const high = record.high.map((v, axis) => Math.min(region.layout.tiles.dims[axis] - 1, Math.floor((v + 2 - region.low[axis]) / width)));
      for (let z = low[2]; z <= high[2]; z++) for (let y = low[1]; y <= high[1]; y++) for (let x = low[0]; x <= high[0]; x++) {
        affected.add(region.tileOffset + linear([x, y, z], region.layout.tiles.dims));
      }
    }
    tileRecords.push({...record, neighbors: [...affected], neighborOffset: neighbors.length});
    neighbors.push(...affected);
  }
  p.tileRecords = tileRecords;
  p.tileNeighbors = neighbors;
  return p;
}

export function refinementIndex(p, q) {
  if (!inside(q, [0, 0, 0], p.dims)) return -1;
  let owner = p.regions[0];
  for (let region = 1; region < p.regions.length; region++) {
    if (inside(q, p.regions[region].low, p.regions[region].high)) { owner = p.regions[region]; break; }
  }
  return owner.offset + linear(q.map((v, axis) => Math.floor((v - owner.low[axis]) / owner.scale)), owner.layout.dims);
}

export function refinementCell(p, i) {
  const region = p.regions.find(r => i >= r.offset && i < r.offset + r.layout.count);
  if (!region) return {coord: [0, 0, 0], size: 0, owned: false, tile: -1};
  const native = coordinates(i - region.offset, region.layout.dims);
  const coord = native.map((n, axis) => region.low[axis] + n * region.scale);
  const tileCoord = native.map(n => Math.floor(n / p.tiles.width));
  return {coord, size: region.scale, owned: refinementIndex(p, coord) === i,
    tile: region.tileOffset + linear(tileCoord, region.layout.tiles.dims)};
}

// Each coarse face meets either one coarse neighbor or four fine neighbors.
// The returned face area is shared by both endpoints of the physical exchange.
export function refinementNeighbors(p, i) {
  const c = refinementCell(p, i);
  if (!c.owned) return [];
  const result = [];
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
    const tangent = [0, 1, 2].filter(a => a !== axis);
    const q = [...c.coord];
    q[axis] += sign < 0 ? -1 : c.size;
    const first = refinementIndex(p, q);
    if (first < 0) continue;
    const finer = refinementCell(p, first).size < c.size;
    const samples = finer ? c.size : 1;
    for (let v = 0; v < samples; v++) for (let u = 0; u < samples; u++) {
      const point = [...q]; point[tangent[0]] += u; point[tangent[1]] += v;
      const j = refinementIndex(p, point);
      result.push({index: j, axis, area: finer ? 1 : Math.min(c.size, refinementCell(p, j).size) ** 2});
    }
  }
  return result;
}

export function refinementFlux(p, values, i, j, axis, area, {solid = [], gravity = true, sliding = {}} = {}) {
  const a = refinementCell(p, i), b = refinementCell(p, j);
  const va = a.size ** 3, vb = b.size ** 3, ma = values[i], mb = values[j];
  if (solid[i] || solid[j]) {
    if (solid[i] === 1 || solid[j] === 1) return 0;
    if (solid[i] === 2 && solid[j] === 2) {
      const amount = .5 * area * (ma / va - mb / vb);
      return amount >= 0 ? Math.min(amount, ma, vb - mb) : -Math.min(-amount, mb, va - ma);
    }
    return solid[i] ? Math.min(ma * area / (a.size * a.size), (vb - mb) * area / (b.size * b.size)) : -Math.min(mb * area / (b.size * b.size), (va - ma) * area / (a.size * a.size));
  }
  if (axis === 1 && gravity) {
    return a.coord[1] > b.coord[1] ? Math.min(ma * area / (a.size * a.size), (vb - mb) * area / (b.size * b.size)) : -Math.min(mb * area / (b.size * b.size), (va - ma) * area / (a.size * a.size));
  }
  const fillA = ma / va, fillB = mb / vb;
  const midpoint = a.coord.map((n, k) => p.origin[k] + (n + a.size * .5 + b.coord[k] + b.size * .5) * .5 * p.cellSize);
  const threshold = slidingThreshold(midpoint, sliding) * (a.size + b.size) * .5;
  const headA = gravity ? a.coord[1] + fillA * a.size : fillA * Math.max(a.size, b.size);
  const headB = gravity ? b.coord[1] + fillB * b.size : fillB * Math.max(a.size, b.size);
  const lower = Math.max(a.coord[1], b.coord[1]);
  const difference = gravity ? Math.max(headA, lower) - Math.max(headB, lower) : headA - headB;
  if (Math.abs(difference) <= threshold) return 0;
  const release = sliding.release ?? 0;
  const offered = .5 * area * (Math.abs(difference) - threshold * (1 - release));
  if (difference > 0) return Math.min(offered, ma, vb - mb, gravity ? Math.max(0, headA - lower) * a.size ** 2 : ma);
  return -Math.min(offered, mb, va - ma, gravity ? Math.max(0, headB - lower) * b.size ** 2 : mb);
}

// Deterministic numerical oracle. The serving implementation performs the same
// offer / capacity limiting / gather operation entirely on the shared GPU.
export function referenceRefinementStep(p, values, options = {}) {
  const incoming = new Float64Array(p.count), outgoing = new Float64Array(p.count), edges = [];
  const axes = options.axes ?? [0, 1, 2];
  for (let i = 0; i < p.count; i++) for (const n of refinementNeighbors(p, i)) {
    if (n.index <= i || !axes.includes(n.axis)) continue;
    const amount = refinementFlux(p, values, i, n.index, n.axis, n.area, options);
    const from = amount >= 0 ? i : n.index, to = amount >= 0 ? n.index : i;
    edges.push({from, to, amount: Math.abs(amount)});
    outgoing[from] += Math.abs(amount); incoming[to] += Math.abs(amount);
  }
  const out = Float64Array.from(values);
  for (const edge of edges) {
    const fromFactor = outgoing[edge.from] ? Math.min(1, values[edge.from] / outgoing[edge.from]) : 1;
    const free = refinementCell(p, edge.to).size ** 3 - values[edge.to];
    const toFactor = incoming[edge.to] ? Math.min(1, free / incoming[edge.to]) : 1;
    const amount = edge.amount * Math.min(fromFactor, toFactor);
    out[edge.from] -= amount; out[edge.to] += amount;
  }
  return Float32Array.from(out);
}
