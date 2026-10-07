// Where an imported asset lands. Every import resolves to one arrival:
// 'fresh' (the scene was just cleared: viewer links, plain drops) places the
// asset and frames the camera; 'append' (adding into an existing scene) places
// the asset only and leaves camera, lighting and other objects alone. Scene
// reopen restores authored transforms and has no arrival.

// Ground, AO and GI radii are tuned for objects about this big, so arrivals
// share the convention the old normalization used.
export const ASSET_ARRIVAL_TARGET_DIAGONAL = 2;

// Elevated three-quarter view: front-biased because image-to-3D assets face +Z.
export const ASSET_ARRIVAL_VIEW = Object.freeze({ azimuthDeg: 28, elevationDeg: 18 });

export function resolveAssetArrivalMode({ arrival, normalize, cleared }) {
  if (arrival !== undefined) return arrival || null;
  if (normalize === false) return null;
  return cleared ? 'fresh' : 'append';
}

// bounds: world-space box of the asset as loaded, with its root at
// rootPosition. Uniformly scaling the root by k maps every world point p to
// rootPosition + k * (p - rootPosition), so the placed box is exact for any
// root rotation.
export function computeAssetArrivalPlacement({
  bounds,
  rootPosition = [0, 0, 0],
  groundY = 0,
  anchor = [0, 0],
  targetDiagonal = ASSET_ARRIVAL_TARGET_DIAGONAL,
}) {
  const [min, max] = [bounds.min, bounds.max];
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (!Number.isFinite(diagonal) || diagonal <= 0) return null;
  const scale = targetDiagonal > 0 ? targetDiagonal / diagonal : 1;
  const centerX = (min[0] + max[0]) / 2, centerZ = (min[2] + max[2]) / 2;
  const position = [
    anchor[0] - scale * (centerX - rootPosition[0]),
    groundY - scale * (min[1] - rootPosition[1]),
    anchor[1] - scale * (centerZ - rootPosition[2]),
  ];
  const place = point => point.map((value, axis) => position[axis] + scale * (value - rootPosition[axis]));
  return { scale, position, bounds: { min: place(min), max: place(max) }, sourceDiagonal: diagonal };
}

export function assetArrivalViewDirection({ azimuthDeg, elevationDeg } = ASSET_ARRIVAL_VIEW) {
  const azimuth = azimuthDeg * Math.PI / 180, elevation = elevationDeg * Math.PI / 180;
  return [Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)];
}

// Camera pose that fits every corner of bounds inside a centered screen window
// of half-extent `fill` (NDC), looking along `direction` (from target toward
// the camera). Overlays covering the canvas edges shrink `fill`.
export function computeAssetArrivalFraming({ bounds, direction = assetArrivalViewDirection(), fovDeg, aspect, fill = 0.8, up = [0, 1, 0] }) {
  const { min, max } = bounds;
  const center = [0, 1, 2].map(axis => (min[axis] + max[axis]) / 2);
  const normalize = v => { const length = Math.hypot(...v); return v.map(value => value / length); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const back = normalize(direction);
  const right = normalize(cross(up, back));
  const cameraUp = cross(back, right);
  const tanV = Math.tan(fovDeg * Math.PI / 360) * fill, tanH = tanV * aspect;
  let distance = 0, radius = 0;
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
    const q = [x - center[0], y - center[1], z - center[2]];
    radius = Math.max(radius, Math.hypot(...q));
    const toward = dot(q, back);
    distance = Math.max(distance, toward + Math.abs(dot(q, right)) / tanH, toward + Math.abs(dot(q, cameraUp)) / tanV);
  }
  if (!Number.isFinite(distance) || distance <= 0) return null;
  return {
    target: center,
    position: center.map((value, axis) => value + back[axis] * distance),
    distance,
    near: Math.max(0.001, (distance - radius) / 10),
    far: distance + radius * 3,
  };
}
