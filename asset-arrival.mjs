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

// Camera pose that puts every point inside the screen window
// {left, right, bottom, top} (NDC) as tightly as possible, looking along
// `direction` (from the scene toward the camera). Closed form: on each screen
// axis the widest perspective spread of the points sets the distance, and the
// camera slides sideways so the points sit centred in the window. Fitting the
// asset's own vertices rather than its box keeps irregular shapes from
// arriving small, and an off-centre window keeps them clear of overlays.
export function computeAssetArrivalFraming({
  points,
  direction = assetArrivalViewDirection(),
  fovDeg,
  aspect,
  window = { left: -0.8, right: 0.8, bottom: -0.8, top: 0.8 },
  up = [0, 1, 0],
}) {
  const count = Math.floor(points.length / 3);
  if (!count) return null;
  const normalize = v => { const length = Math.hypot(...v); return v.map(value => value / length); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const back = normalize(direction), right = normalize(cross(up, back)), cameraUp = cross(back, right);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) for (let axis = 0; axis < 3; axis++) {
    const value = points[3 * i + axis];
    if (value < min[axis]) min[axis] = value;
    if (value > max[axis]) max[axis] = value;
  }
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const t = Math.tan(fovDeg * Math.PI / 360), s = t * aspect;
  const { left, right: windowRight, bottom, top } = window;
  let maxX = -Infinity, minX = Infinity, maxY = -Infinity, minY = Infinity, maxZ = -Infinity, minZ = Infinity, radius = 0;
  for (let i = 0; i < count; i++) {
    const q = [points[3 * i] - center[0], points[3 * i + 1] - center[1], points[3 * i + 2] - center[2]];
    const x = q[0] * right[0] + q[1] * right[1] + q[2] * right[2];
    const y = q[0] * cameraUp[0] + q[1] * cameraUp[1] + q[2] * cameraUp[2];
    const z = q[0] * back[0] + q[1] * back[1] + q[2] * back[2];
    // A point stays inside the window when x + windowEdge * s * z is bounded by
    // the camera's sideways offset plus windowEdge * s * distance.
    maxX = Math.max(maxX, x + windowRight * s * z); minX = Math.min(minX, x + left * s * z);
    maxY = Math.max(maxY, y + top * t * z); minY = Math.min(minY, y + bottom * t * z);
    maxZ = Math.max(maxZ, z); minZ = Math.min(minZ, z);
    radius = Math.max(radius, Math.hypot(...q));
  }
  let distance = Math.max((maxX - minX) / ((windowRight - left) * s), (maxY - minY) / ((top - bottom) * t));
  distance = Math.max(distance, maxZ + 1e-6 * Math.max(radius, 1e-9));
  if (!Number.isFinite(distance) || distance <= 0) return null;
  const sideways = ((maxX - windowRight * s * distance) + (minX - left * s * distance)) / 2;
  const lift = ((maxY - top * t * distance) + (minY - bottom * t * distance)) / 2;
  const target = center.map((value, axis) => value + right[axis] * sideways + cameraUp[axis] * lift);
  return {
    target,
    position: target.map((value, axis) => value + back[axis] * distance),
    distance,
    near: Math.max(0.001, (distance - maxZ) / 10),
    far: (distance - minZ) + radius * 2,
  };
}

// Window for an arrival: symmetric margin, with the top lowered to clear an
// overlay whose bottom edge sits at overlayTopNdc.
// Margin 0.62: an upright object fills about 62% of the viewport height.
export const ASSET_ARRIVAL_SCREEN_MARGIN = 0.62;

export function assetArrivalFramingWindow({ overlayTopNdc = 1, margin = ASSET_ARRIVAL_SCREEN_MARGIN, overlayGap = 0.05 } = {}) {
  return { left: -margin, right: margin, bottom: -margin, top: Math.min(margin, overlayTopNdc - overlayGap) };
}
