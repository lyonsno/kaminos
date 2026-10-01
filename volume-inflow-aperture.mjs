// Inflow aperture coverage map (emitter source law inflow-boundary, slice 2).
//
// The aperture on the floor face is a two-dimensional coverage map, one weight
// in [0, 1] per floor cell, built on the CPU and uploaded as a storage buffer.
// The shader reads the weight; it no longer knows the shape. That makes any
// pattern a function here (ring of jets, concentric rings, slot, spiral, a
// lumpy porous bed, and later anything else), and the per-cell weight is the
// pattern's coverage averaged over a 4 x 4 stratified footprint so a curved edge
// does not become a staircase of whole cells.
//
// Everything is deterministic: a pattern, its parameters and a seed give the
// same map every time. No time, no hash per cell.

export const INFLOW_APERTURE_MAP_IDENTITY = 'kaminos.volume.inflow-aperture-map.v1';

export const INFLOW_APERTURE_PATTERNS = Object.freeze([
  'shape',       // the family's own aperture: annulus (ring), disc (wick, nozzle), rectangle (ribbon)
  'jets',        // `count` discs of the band radius placed on the ring radius (a ring of jet nozzles)
  'concentric',  // `count` nested rings; the inner rings carry `ratio` of the outer flux
  'slot',        // one long rectangle through the centre along the side axis (a flame curtain)
  'spiral',      // an Archimedean spiral of `count` turns out to the ring radius
  'bed',         // a lumpy porous disc out to the ring radius (campfire / coal bed), seeded
]);

const TAU = Math.PI * 2;

function clamp(value, lo, hi) { return Math.min(hi, Math.max(lo, value)); }
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
function finite(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }

// A signed distance through a one-cell smoothstep: 1 inside, 0 outside.
function edge(signedDistance, antialias) {
  return 1 - smoothstep(-0.5 * antialias, 0.5 * antialias, signedDistance);
}

function discDistance(q, radius) { return Math.hypot(q[0], q[1]) - radius; }
function annulusDistance(q, ringRadius, band) { return Math.abs(Math.hypot(q[0], q[1]) - ringRadius) - band; }
function rectangleDistance(q, side, halfLength, halfWidth) {
  const along = Math.abs(q[0] * side[0] + q[1] * side[1]) - halfLength;
  const across = Math.abs(-q[0] * side[1] + q[1] * side[0]) - halfWidth;
  return Math.max(along, across);
}

// Deterministic phases from an integer seed (a small linear congruential walk;
// authored geometry, not forcing).
function seededPhases(seed, count) {
  let state = (Math.floor(Math.abs(finite(seed, 1))) * 2654435761 + 1013904223) >>> 0;
  const phases = [];
  for (let i = 0; i < count; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    phases.push((state / 4294967296) * TAU);
  }
  return phases;
}

export function normalizeInflowApertureSpec(spec = {}) {
  const kind = String(spec.kind ?? 'annulus');
  if (!['disc', 'annulus', 'rectangle'].includes(kind)) throw new Error(`unsupported inflow aperture kind: ${kind}`);
  const pattern = String(spec.pattern ?? 'shape');
  if (!INFLOW_APERTURE_PATTERNS.includes(pattern)) throw new Error(`unsupported inflow aperture pattern: ${pattern}`);
  const center = Array.isArray(spec.center) && spec.center.length === 2 ? spec.center.map(component => finite(component, 0)) : [0, 0];
  const sideRaw = Array.isArray(spec.sideAxis) && spec.sideAxis.length === 2 ? spec.sideAxis.map(component => finite(component, 0)) : [1, 0];
  const sideLength = Math.hypot(sideRaw[0], sideRaw[1]);
  return {
    kind,
    pattern,
    center,
    ringRadius: clamp(finite(spec.ringRadius, 0), 0, 0.95),
    bandHalfWidth: clamp(finite(spec.bandHalfWidth, 0.04), 0.006, 0.5),
    halfLength: clamp(finite(spec.halfLength, 0), 0, 0.95),
    sideAxis: sideLength > 1e-9 ? [sideRaw[0] / sideLength, sideRaw[1] / sideLength] : [1, 0],
    count: clamp(Math.round(finite(spec.count, 12)), 1, 64),
    ratio: clamp(finite(spec.ratio, 0.6), 0, 1),
    seed: clamp(Math.round(finite(spec.seed, 1)), 0, 9999),
    antialias: clamp(finite(spec.antialias, 1 / 32), 1e-4, 0.5),
  };
}

// Continuous coverage (a flux weight in [0, 1]) of the pattern at floor point
// (x, z) in volume units. The family's base geometry sets the scale: the ring
// radius is the pattern's reach, the band half-width its line weight.
export function inflowPatternCoverage(spec, x, z) {
  const s = spec;
  const q = [x - s.center[0], z - s.center[1]];
  const aa = s.antialias;
  const reach = s.kind === 'annulus' ? s.ringRadius : (s.kind === 'rectangle' ? s.halfLength : s.bandHalfWidth);
  switch (s.pattern) {
    case 'shape': {
      if (s.kind === 'annulus') return edge(annulusDistance(q, s.ringRadius, s.bandHalfWidth), aa);
      if (s.kind === 'rectangle') return edge(rectangleDistance(q, s.sideAxis, s.halfLength, s.bandHalfWidth), aa);
      return edge(discDistance(q, s.bandHalfWidth), aa);
    }
    case 'jets': {
      // Discs of the band radius on the reach circle (for a disc family, on a
      // circle at twice the band radius so the jets do not overlap at the centre).
      const circle = s.kind === 'disc' ? s.bandHalfWidth * 2.2 : Math.max(reach, s.bandHalfWidth * 1.5);
      const [phase] = seededPhases(s.seed, 1);
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < s.count; i += 1) {
        const angle = phase + (i / s.count) * TAU;
        const c = [Math.cos(angle) * circle, Math.sin(angle) * circle];
        best = Math.min(best, discDistance([q[0] - c[0], q[1] - c[1]], s.bandHalfWidth * 0.8));
      }
      return edge(best, aa);
    }
    case 'concentric': {
      // `count` rings from 45 % of the reach to the reach; the outermost carries
      // the full flux, the inner ones `ratio` of it.
      const rings = Math.max(1, s.count);
      const outer = Math.max(reach, s.bandHalfWidth * 3);
      const inner = outer * 0.45;
      const band = s.bandHalfWidth * (rings > 2 ? 0.55 : 0.7);
      let weight = 0;
      for (let i = 0; i < rings; i += 1) {
        const radius = rings === 1 ? outer : inner + (outer - inner) * (i / (rings - 1));
        const cover = edge(annulusDistance(q, radius, band), aa);
        const flux = i === rings - 1 ? 1 : s.ratio;
        weight = Math.max(weight, cover * flux);
      }
      return weight;
    }
    case 'slot': {
      const halfLength = Math.max(reach, s.bandHalfWidth * 2);
      return edge(rectangleDistance(q, s.sideAxis, halfLength, s.bandHalfWidth), aa);
    }
    case 'spiral': {
      // Archimedean spiral r = reach * theta / (turns * 2pi); distance taken as
      // the nearest of the spiral's crossings along this point's ray.
      const turns = Math.max(1, s.count);
      const outer = Math.max(reach, s.bandHalfWidth * 3);
      const band = s.bandHalfWidth * 0.6;
      const r = Math.hypot(q[0], q[1]);
      const theta = Math.atan2(q[1], q[0]);
      const pitch = outer / turns;
      let best = Number.POSITIVE_INFINITY;
      for (let k = -1; k <= turns; k += 1) {
        const spiralR = pitch * ((theta + TAU * k) / TAU);
        if (spiralR < 0 || spiralR > outer) continue;
        best = Math.min(best, Math.abs(r - spiralR));
      }
      return edge(best - band, aa);
    }
    case 'bed': {
      // A lumpy porous disc: a low-frequency authored field thresholded inside
      // the reach, so the bed is patchy like a coal bed, not a uniform plate.
      const outer = Math.max(reach, s.bandHalfWidth * 3);
      const phases = seededPhases(s.seed, 6);
      const scale = Math.PI / Math.max(outer, 1e-3);
      let field = 0;
      for (let i = 0; i < 6; i += 1) {
        const direction = phases[i];
        const freq = scale * (1.6 + i * 0.9);
        field += Math.cos((q[0] * Math.cos(direction) + q[1] * Math.sin(direction)) * freq + phases[(i + 3) % 6]) / (1 + i * 0.35);
      }
      const lump = smoothstep(0.05, 0.55, field);
      const diskMask = edge(discDistance(q, outer), aa * 2);
      return clamp(lump * diskMask, 0, 1);
    }
    default:
      return 0;
  }
}

// One floor cell's weight: the coverage averaged over a 4 x 4 stratified set of
// points in the cell's footprint.
export function inflowCellWeight(spec, grid, cellX, cellZ, supersample = 4) {
  const cellWidth = 2 / grid;
  const x0 = cellX * cellWidth - 1;
  const z0 = cellZ * cellWidth - 1;
  let sum = 0;
  for (let sx = 0; sx < supersample; sx += 1) {
    for (let sz = 0; sz < supersample; sz += 1) {
      const x = x0 + ((sx + 0.5) / supersample) * cellWidth;
      const z = z0 + ((sz + 0.5) / supersample) * cellWidth;
      sum += inflowPatternCoverage(spec, x, z);
    }
  }
  return sum / (supersample * supersample);
}

export function buildInflowCoverageMap({ grid, spec, supersample = 4 } = {}) {
  const size = Math.max(4, Math.floor(finite(grid, 64)));
  const normalized = normalizeInflowApertureSpec({ ...spec, antialias: spec?.antialias ?? 2 / size });
  const cells = new Float32Array(size * size);
  let coveredCells = 0;
  let totalCoverage = 0;
  let peak = 0;
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const weight = clamp(inflowCellWeight(normalized, size, x, z, supersample), 0, 1);
      cells[z * size + x] = weight;
      if (weight > 1e-4) coveredCells += 1;
      totalCoverage += weight;
      peak = Math.max(peak, weight);
    }
  }
  return {
    identity: INFLOW_APERTURE_MAP_IDENTITY,
    grid: size,
    pattern: normalized.pattern,
    kind: normalized.kind,
    count: normalized.count,
    ratio: normalized.ratio,
    seed: normalized.seed,
    supersample,
    cells,
    coveredCells,
    totalCoverage,
    peak,
  };
}
