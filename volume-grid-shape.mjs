// Grid shape law for the volume fluid box (emitter report §34).
//
// The fluid box is width x height x width cells at equal pitch: x and z span
// [-1, 1] and y spans [-1, -1 + 2 x height / width] in the box's local frame.
// The height used to be a fixed twice the width; it is now a control in cells.
// 0 keeps twice the width, which is what every saved basin was authored at.
//
// A requested height is clamped to [width, 4 x width] and snapped to the
// nearest admissible height. Admissible means two things at once:
//   - every lattice derived from the box at equal pitch has an integral
//     height: the shared scene-source / emissive lattice (32 wide) and the
//     fire irradiance lattice (32 or 48 wide) are derivedWidth x height /
//     width tall, and createSceneVolumeSource refuses a fractional or
//     mismatched-aspect lattice (review GH-02 of the first cut).
// The admissible step at a width is lcm(width / gcd(width, d)) over the
// derived widths d, retaining the previous four-cell height step where the
// width supports it. Kernels dispatch partial workgroups for other widths.
// Width itself is always admissible (the step divides it),
// so the clamp bounds w, 2w and 4w are admissible too.
//
// Pure functions, no browser: the core, the cockpit receipt and the capture
// gate share this one law.

export const GRID_HEIGHT_AUTO_RATIO = 2;
export const GRID_HEIGHT_MIN_RATIO = 1;
export const GRID_HEIGHT_MAX_RATIO = 4;
export const GRID_HEIGHT_WORKGROUP = 4;
// Widths of the lattices derived from the fluid box at equal pitch. A contract
// holds this list equal to EMISSIVE_LIGHT_GRID plus the supported fire
// irradiance lattice sizes, so adding a lattice size cannot silently break it.
export const GRID_HEIGHT_DERIVED_LATTICE_WIDTHS = Object.freeze([32, 48]);

const gcd = (a, b) => { let x = Math.abs(a), y = Math.abs(b); while (y) [x, y] = [y, x % y]; return x; };
const lcm = (a, b) => a / gcd(a, b) * b;

function validWidth(width) {
  const w = Number(width);
  if (!Number.isSafeInteger(w) || w <= 0) {
    throw new Error(`grid width must be a positive integer: ${width}`);
  }
  return w;
}

export function gridHeightStep(width, derivedWidths = GRID_HEIGHT_DERIVED_LATTICE_WIDTHS) {
  const w = validWidth(width);
  return derivedWidths.reduce((step, d) => lcm(step, w / gcd(w, d)), gcd(w, GRID_HEIGHT_WORKGROUP));
}

export function resolveGridHeight(controls = {}, width, derivedWidths = GRID_HEIGHT_DERIVED_LATTICE_WIDTHS) {
  const w = validWidth(width);
  const step = gridHeightStep(w, derivedWidths);
  // The control is a multiplier on the width (Noah 2026-10-12); no value, a
  // non-positive one, or exactly the auto ratio keeps the saved-basin height.
  const requested = Number(controls?.gridHeightRatio);
  const requestedRatio = Number.isFinite(requested) && requested > 0 && requested !== GRID_HEIGHT_AUTO_RATIO ? requested : null;
  if (requestedRatio === null) {
    return { requestedRatio: null, requestedCells: 0, widthCells: w, heightCells: w * GRID_HEIGHT_AUTO_RATIO, ratio: GRID_HEIGHT_AUTO_RATIO, step, mode: 'auto-twice-width' };
  }
  const requestedCells = Math.round(requestedRatio * w);
  const clamped = Math.min(GRID_HEIGHT_MAX_RATIO * w, Math.max(GRID_HEIGHT_MIN_RATIO * w, requestedCells));
  const heightCells = Math.round(clamped / step) * step;
  const mode = clamped !== requestedCells ? 'requested-clamped' : (heightCells !== requestedCells ? 'requested-snapped' : 'requested');
  return { requestedRatio, requestedCells, widthCells: w, heightCells, ratio: heightCells / w, step, mode };
}

// Height of a lattice `size` wide derived from the box at equal pitch. Exact
// for the box itself and for every derived lattice width (the admissible step
// guarantees integrality); any other width rounds.
export function gridHeightForShape(size, shape) {
  if (!shape) return size * GRID_HEIGHT_AUTO_RATIO;
  if (size === shape.widthCells) return shape.heightCells;
  return Math.round(size * shape.heightCells / shape.widthCells);
}

// The raymarch domain box in the box's local frame: centre and half extents.
// The camera samples exactly this box (review GH-01 of the first cut: the
// shader intersected a fixed y in [-1, 3] whatever the height).
export function raymarchDomainBox(widthCells, heightCells) {
  const halfY = heightCells / widthCells;
  return { center: [0, halfY - 1, 0], half: [1, halfY, 1], min: [-1, -1, -1], max: [1, -1 + 2 * halfY, 1] };
}

// CPU model of the shader's boxHit (slab test) against a domain box: the
// entry and exit distances along the ray, entry > exit meaning a miss.
export function raymarchBoxHitModel(ro, rd, box) {
  let enter = -Infinity, exit = Infinity;
  for (let a = 0; a < 3; a += 1) {
    const o = ro[a] - box.center[a], d = rd[a], b = box.half[a];
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(o) > b) return [Infinity, -Infinity];
      continue;
    }
    const t0 = (-b - o) / d, t1 = (b - o) / d;
    enter = Math.max(enter, Math.min(t0, t1));
    exit = Math.min(exit, Math.max(t0, t1));
  }
  return [enter, exit];
}
