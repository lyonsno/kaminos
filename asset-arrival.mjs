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
    up: [...up],
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

// Where an appended asset lands on the floor: the orbit pivot when nothing is there,
// otherwise the nearest spot clear of the scene's objects. Rings widen from the pivot;
// on each ring, spots beside the view come first, then in front, then behind, so the
// new object is seen next to what you are looking at rather than inside or behind it.
// footprint: placed [width, depth]; obstacles: world boxes; viewDirection: scene to camera.
export function chooseAppendAnchor({ footprint, pivot, obstacles = [], viewDirection = [0, 0, 1], margin = 0.15, maxRadius = 30 }) {
  const [w, d] = footprint;
  const clear = ([x, z]) => obstacles.every(o =>
    x + w / 2 + margin <= o.min[0] || x - w / 2 - margin >= o.max[0] || z + d / 2 + margin <= o.min[2] || z - d / 2 - margin >= o.max[2]);
  if (clear(pivot)) return { anchor: [...pivot], reason: 'pivot-clear' };
  let vx = viewDirection[0], vz = viewDirection[2];
  const length = Math.hypot(vx, vz) || 1; vx /= length; vz /= length;
  const step = Math.max(0.1, Math.min(w, d) / 2);
  const angles = Array.from({ length: 24 }, (_, i) => i * Math.PI / 12)
    .map(a => ({ a, toward: Math.cos(a) * vx + Math.sin(a) * vz }))
    .sort((p, q) => (Math.abs(p.toward) - Math.abs(q.toward)) || (q.toward - p.toward));
  for (let r = step; r <= maxRadius; r += step) {
    for (const { a } of angles) {
      const spot = [pivot[0] + r * Math.cos(a), pivot[1] + r * Math.sin(a)];
      if (clear(spot)) return { anchor: spot, reason: 'nearest-clear' };
    }
  }
  return { anchor: [...pivot], reason: 'no-clear-spot' };
}

// The floor point appends start from: the centre of what is already in the scene, so a
// new object lands beside it even when the orbit pivot has been moved away (for example
// toward the camera). An empty scene keeps the pivot.
export function appendArrivalPivot(obstacles, pivot) {
  if (!obstacles.length) return [...pivot];
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (const o of obstacles) { min[0] = Math.min(min[0], o.min[0]); min[1] = Math.min(min[1], o.min[2]); max[0] = Math.max(max[0], o.max[0]); max[1] = Math.max(max[1], o.max[2]); }
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
}

// Floor obstacles for an append: scene objects other than cameras and lights (hidden
// objects excluded), plus the fire's simulation box whenever a simulation is active.
// The box's outline is an editor helper; hiding it does not remove the fire.
export function arrivalObstacleBoxes({ objects = [], domain = null }) {
  const boxes = objects.filter(o => o.box && !['camera', 'light'].includes(o.type) && o.visible !== false).map(o => o.box);
  if (domain?.active && domain.box) boxes.push(domain.box);
  return boxes;
}

// Inspect material samples ({ color: [r, g, b], roughness, metalness, weight })
// from an arrived asset to classify its surface response for optional arrival tuning.
export function inspectArrivalMaterialProfile(samples = []) {
  let totalWeight = 0, lumSum = 0, roughSum = 0, metalSum = 0, sampleCount = 0;
  for (const sample of Array.isArray(samples) ? samples : []) {
    if (!sample || typeof sample !== 'object') continue;
    const w = Number.isFinite(sample.weight) && sample.weight > 0 ? sample.weight : 1;
    const c = Array.isArray(sample.color) && sample.color.length >= 3 ? sample.color : [0.5, 0.5, 0.5];
    const r = Number.isFinite(c[0]) ? Math.max(0, Math.min(1, c[0])) : 0.5;
    const g = Number.isFinite(c[1]) ? Math.max(0, Math.min(1, c[1])) : 0.5;
    const b = Number.isFinite(c[2]) ? Math.max(0, Math.min(1, c[2])) : 0.5;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const rough = Number.isFinite(sample.roughness) ? Math.max(0, Math.min(1, sample.roughness)) : 0.55;
    const metal = Number.isFinite(sample.metalness) ? Math.max(0, Math.min(1, sample.metalness)) : 0.0;
    lumSum += lum * w;
    roughSum += rough * w;
    metalSum += metal * w;
    totalWeight += w;
    sampleCount += 1;
  }
  if (!totalWeight) {
    return { kind: 'balanced', meanLuminance: 0.35, meanRoughness: 0.55, meanMetalness: 0.05, sampleCount: 0 };
  }
  const round3 = v => Math.round(v * 1000) / 1000;
  const meanLuminance = lumSum / totalWeight;
  const meanRoughness = roughSum / totalWeight;
  const meanMetalness = metalSum / totalWeight;
  let kind = 'balanced';
  if (meanMetalness >= 0.45 && meanLuminance < 0.25) kind = 'dark-metallic';
  else if (meanMetalness >= 0.45 || (meanRoughness <= 0.32 && meanLuminance >= 0.22)) kind = 'specular-metallic';
  else if (meanLuminance >= 0.58 && meanRoughness >= 0.6 && meanMetalness < 0.25) kind = 'bright-matte';
  return {
    kind,
    meanLuminance: round3(meanLuminance),
    meanRoughness: round3(meanRoughness),
    meanMetalness: round3(meanMetalness),
    sampleCount,
  };
}

function eulerXYZFromMinusZToDirection([dx, dy, dz]) {
  const len = Math.hypot(dx, dy, dz) || 1;
  const x = dx / len, y = dy / len, z = dz / len;
  const dot = -z;
  let qx, qy, qz, qw;
  if (dot < -0.999999) {
    qx = 0; qy = 1; qz = 0; qw = 0;
  } else {
    qx = y; qy = -x; qz = 0; qw = 1 + dot;
    const qlen = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= qlen; qy /= qlen; qz /= qlen; qw /= qlen;
  }
  const m11 = 1 - 2 * (qy * qy + qz * qz);
  const m12 = 2 * (qx * qy - qz * qw);
  const m13 = 2 * (qx * qz + qy * qw);
  const m22 = 1 - 2 * (qx * qx + qz * qz);
  const m23 = 2 * (qy * qz - qx * qw);
  const m32 = 2 * (qy * qz + qx * qw);
  const m33 = 1 - 2 * (qx * qx + qy * qy);
  const ry = Math.asin(Math.max(-1, Math.min(1, m13)));
  const rx = Math.abs(m13) < 0.9999999 ? Math.atan2(-m23, m33) : Math.atan2(m32, m22);
  const rz = Math.abs(m13) < 0.9999999 ? Math.atan2(-m12, m11) : 0;
  return [rx, ry, rz];
}

export const DEFAULT_STUDIO_LOOK_ID = 'sculptural-studio';

export const STUDIO_LOOK_LIBRARY = Object.freeze({
  'sculptural-studio': Object.freeze({
    id: 'sculptural-studio',
    label: 'Sculptural Studio',
    description: 'Warm three-quarter key and cool grazing rim on a neutral cyclorama',
    environment: Object.freeze({
      name: 'studio',
      exposure: 1.15,
      intensity: 1.15,
      rotation: 0,
      showBackground: true,
      backgroundBlur: 0.55,
      backgroundBrightness: 0.78,
      backgroundContrast: 1.05,
      ground: Object.freeze({ visible: true, height: -0.85, color: '#ece9e2', roughness: 0.78 }),
    }),
    opticalFinish: Object.freeze({ floorReflection: 0.28, glintStrength: 0.16, glintThreshold: 1.35 }),
    keyLight: Object.freeze({ azimuthDeg: -34, elevationDeg: 42, distanceScale: 4.2, color: '#fff1e0', intensity: 95, angle: 62, penumbra: 0.9 }),
    rimLight: Object.freeze({ azimuthDeg: 148, elevationDeg: 28, distanceScale: 4.4, color: '#cfe2ff', intensity: 58, angle: 66, penumbra: 0.92 }),
  }),
  'obsidian-stage': Object.freeze({
    id: 'obsidian-stage',
    label: 'Obsidian Stage',
    description: 'High-contrast dark stage with warm amber key and crisp icy rim',
    environment: Object.freeze({
      name: 'studio',
      exposure: 1.08,
      intensity: 0.95,
      rotation: 0.45,
      showBackground: true,
      backgroundBlur: 0.65,
      backgroundBrightness: 0.34,
      backgroundContrast: 1.14,
      ground: Object.freeze({ visible: true, height: -0.85, color: '#26282d', roughness: 0.58 }),
    }),
    opticalFinish: Object.freeze({ floorReflection: 0.58, glintStrength: 0.24, glintThreshold: 1.2 }),
    keyLight: Object.freeze({ azimuthDeg: -38, elevationDeg: 38, distanceScale: 4.1, color: '#ffe4c4', intensity: 118, angle: 54, penumbra: 0.88 }),
    rimLight: Object.freeze({ azimuthDeg: 142, elevationDeg: 24, distanceScale: 4.2, color: '#9ecbff', intensity: 82, angle: 58, penumbra: 0.9 }),
  }),
  'warm-gallery': Object.freeze({
    id: 'warm-gallery',
    label: 'Warm Gallery',
    description: 'Golden-hour gallery key with soft warm limestone floor',
    environment: Object.freeze({
      name: 'sunset',
      exposure: 1.12,
      intensity: 1.08,
      rotation: 0.2,
      showBackground: true,
      backgroundBlur: 0.58,
      backgroundBrightness: 0.76,
      backgroundContrast: 1.06,
      ground: Object.freeze({ visible: true, height: -0.85, color: '#eee5d8', roughness: 0.82 }),
    }),
    opticalFinish: Object.freeze({ floorReflection: 0.22, glintStrength: 0.14, glintThreshold: 1.4 }),
    keyLight: Object.freeze({ azimuthDeg: -28, elevationDeg: 36, distanceScale: 4.3, color: '#ffe6c7', intensity: 102, angle: 64, penumbra: 0.92 }),
    rimLight: Object.freeze({ azimuthDeg: 154, elevationDeg: 32, distanceScale: 4.5, color: '#d8e6ff', intensity: 52, angle: 68, penumbra: 0.94 }),
  }),
  'technical-daylight': Object.freeze({
    id: 'technical-daylight',
    label: 'Technical Daylight',
    description: 'Crisp neutral inspection light with balanced fill',
    environment: Object.freeze({
      name: 'courtyard',
      exposure: 1.1,
      intensity: 1.12,
      rotation: 0,
      showBackground: true,
      backgroundBlur: 0.6,
      backgroundBrightness: 0.82,
      backgroundContrast: 1.02,
      ground: Object.freeze({ visible: true, height: -0.85, color: '#e4e6e9', roughness: 0.74 }),
    }),
    opticalFinish: Object.freeze({ floorReflection: 0.10, glintStrength: 0.08, glintThreshold: 1.6 }),
    keyLight: Object.freeze({ azimuthDeg: -32, elevationDeg: 46, distanceScale: 4.2, color: '#ffffff', intensity: 88, angle: 64, penumbra: 0.88 }),
    rimLight: Object.freeze({ azimuthDeg: 146, elevationDeg: 34, distanceScale: 4.4, color: '#e2eeff', intensity: 64, angle: 66, penumbra: 0.9 }),
  }),
});

export function resolveStudioLook(lookId = DEFAULT_STUDIO_LOOK_ID) {
  if (lookId == null || lookId === '') return STUDIO_LOOK_LIBRARY[DEFAULT_STUDIO_LOOK_ID];
  const look = STUDIO_LOOK_LIBRARY[lookId];
  if (!look) throw new Error(`Unknown Studio look: ${lookId}`);
  return look;
}

export function resolveStudioLookFromSearch(search = '') {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  const requested = params.get('look')?.trim();
  if (!requested || !Object.prototype.hasOwnProperty.call(STUDIO_LOOK_LIBRARY, requested)) return null;
  return requested;
}

export const ARRIVAL_TEXTURE_SLOTS = Object.freeze([
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'clearcoatMap',
  'clearcoatRoughnessMap',
  'clearcoatNormalMap',
  'specularIntensityMap',
  'specularColorMap',
]);

// Upgrade arrived mesh textures to hardware anisotropic filtering (up to 16x)
// so oblique brick, roof plate, and brushed metal textures stay sharp at grazing
// angles, and reversibly apply/restore surface micro-roughness polish when
// optional material-aware arrival tuning is toggled.
export function prepareArrivedMeshMaterials(
  root,
  { maxAnisotropy = 16, materialTuning = false, materialProfile = null, baseEnvMapIntensity = null } = {},
) {
  const targetAnisotropy = Math.max(1, Math.min(16, Math.floor(Number(maxAnisotropy) || 16)));
  const profileKind = materialProfile?.kind ?? 'balanced';
  let materialsVisited = 0;
  let texturesUpdated = 0;
  let materialsPolished = 0;
  const seenMaterials = new Set();
  const seenTextures = new Set();

  root?.traverse?.(child => {
    if (!child?.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material || typeof material !== 'object' || seenMaterials.has(material)) continue;
      seenMaterials.add(material);
      materialsVisited += 1;

      for (const slot of ARRIVAL_TEXTURE_SLOTS) {
        const tex = material[slot];
        if (!tex || typeof tex !== 'object') continue;
        if ((tex.anisotropy ?? 1) < targetAnisotropy) {
          tex.anisotropy = targetAnisotropy;
          tex.needsUpdate = true;
        }
        if (!seenTextures.has(tex)) {
          seenTextures.add(tex);
          texturesUpdated += 1;
        }
      }

      material.userData ??= {};
      if (!material.userData.kaminosArrivalOriginal) {
        material.userData.kaminosArrivalOriginal = {
          roughness: typeof material.roughness === 'number' ? material.roughness : null,
          metalness: typeof material.metalness === 'number' ? material.metalness : null,
          envMapIntensity: typeof material.envMapIntensity === 'number' ? material.envMapIntensity : 1,
        };
      }
      const orig = material.userData.kaminosArrivalOriginal;
      const envBase = Number.isFinite(baseEnvMapIntensity) ? baseEnvMapIntensity : (orig.envMapIntensity ?? 1);
      if (typeof orig.roughness !== 'number') continue;

      if (!materialTuning) {
        material.roughness = orig.roughness;
        if (typeof material.envMapIntensity === 'number' || orig.envMapIntensity != null) {
          material.envMapIntensity = envBase;
        }
        continue;
      }

      const metal = orig.metalness ?? 0;
      let nextRoughness = orig.roughness;
      let nextEnvIntensity = envBase;
      if (profileKind === 'dark-metallic' || metal >= 0.45) {
        nextRoughness = Math.max(0.12, orig.roughness * 0.88);
        nextEnvIntensity = envBase * 1.15;
      } else if (profileKind === 'specular-metallic') {
        nextRoughness = Math.max(0.1, orig.roughness * 0.92);
        nextEnvIntensity = envBase * 1.08;
      } else if (profileKind === 'bright-matte') {
        nextRoughness = Math.min(0.95, Math.max(orig.roughness, 0.62));
        nextEnvIntensity = envBase * 0.92;
      } else if (!material.roughnessMap && orig.roughness >= 0.45 && orig.roughness <= 0.78) {
        nextRoughness = orig.roughness * 0.9;
        nextEnvIntensity = envBase * 1.06;
      }
      material.roughness = Math.round(nextRoughness * 1000) / 1000;
      material.envMapIntensity = Math.round(nextEnvIntensity * 1000) / 1000;
      materialsPolished += 1;
    }
  });

  return {
    maxAnisotropy: targetAnisotropy,
    materialsVisited,
    texturesUpdated,
    materialsPolished,
  };
}

// Plan a two-light studio rig (warm three-quarter Key + cool grazing Rim)
// scaled and aimed at the arriving asset's bounds, with optional material-aware
// tuning adjustments for dark-metallic, specular-metallic, bright-matte, or balanced surfaces.
export function planArrivalStudioLights({
  bounds = null,
  groundY = -0.85,
  materialProfile = null,
  materialTuning = false,
  lookId = DEFAULT_STUDIO_LOOK_ID,
} = {}) {
  const look = resolveStudioLook(lookId);
  const min = Array.isArray(bounds?.min) && bounds.min.length === 3 ? bounds.min : [-0.58, groundY, -0.58];
  const max = Array.isArray(bounds?.max) && bounds.max.length === 3 ? bounds.max : [0.58, groundY + 1.15, 0.58];
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || ASSET_ARRIVAL_TARGET_DIAGONAL;
  const scaleFactor = Math.max(0.5, Math.min(4.0, diagonal / ASSET_ARRIVAL_TARGET_DIAGONAL));
  const target = [
    (min[0] + max[0]) / 2,
    min[1] + 0.46 * (max[1] - min[1]),
    (min[2] + max[2]) / 2,
  ];
  const profileKind = materialProfile?.kind || 'balanced';
  const tuningTable = {
    'dark-metallic': { keyMultiplier: 1.18, rimMultiplier: 1.45, exposureScale: 1.12, envIntensityScale: 1.15, envRotationOffset: 0.35 },
    'specular-metallic': { keyMultiplier: 1.05, rimMultiplier: 1.28, exposureScale: 1.04, envIntensityScale: 1.1, envRotationOffset: 0.25 },
    'bright-matte': { keyMultiplier: 0.78, rimMultiplier: 0.92, exposureScale: 0.92, envIntensityScale: 0.88, envRotationOffset: -0.2 },
    'balanced': { keyMultiplier: 1.04, rimMultiplier: 1.12, exposureScale: 1.02, envIntensityScale: 1.0, envRotationOffset: 0.12 },
  };
  const activeTuning = materialTuning
    ? (tuningTable[profileKind] || tuningTable.balanced)
    : { keyMultiplier: 1, rimMultiplier: 1, exposureScale: 1, envIntensityScale: 1, envRotationOffset: 0 };

  const buildSpotRecord = ({ id, label, role, azimuthDeg, elevationDeg, distance, color, intensity, angle, penumbra }) => {
    const az = azimuthDeg * Math.PI / 180;
    const el = elevationDeg * Math.PI / 180;
    const offset = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const position = target.map((t, i) => Math.round((t + offset[i] * distance) * 1000) / 1000);
    const rotation = eulerXYZFromMinusZToDirection(offset.map(v => -v));
    return {
      id,
      type: 'light',
      source: 'kaminos:scene-spot-light',
      label,
      fileName: 'Spot light',
      transform: { position, rotation, scale: [1, 1, 1] },
      light: {
        kind: 'spot',
        role,
        enabled: true,
        color,
        intensity: Math.round(intensity * 100) / 100,
        angle,
        penumbra,
        aimDistance: Math.round(distance * 1000) / 1000,
      },
    };
  };

  const distanceScale = scaleFactor * scaleFactor;
  const keySpec = look.keyLight;
  const rimSpec = look.rimLight;
  const keyRecord = buildSpotRecord({
    id: '@studio-key-light',
    label: 'Studio key light',
    role: 'key',
    azimuthDeg: keySpec.azimuthDeg,
    elevationDeg: keySpec.elevationDeg,
    distance: keySpec.distanceScale * scaleFactor,
    color: keySpec.color,
    intensity: keySpec.intensity * distanceScale * activeTuning.keyMultiplier,
    angle: keySpec.angle,
    penumbra: keySpec.penumbra,
  });
  const rimRecord = buildSpotRecord({
    id: '@studio-rim-light',
    label: 'Studio rim light',
    role: 'rim',
    azimuthDeg: rimSpec.azimuthDeg,
    elevationDeg: rimSpec.elevationDeg,
    distance: rimSpec.distanceScale * scaleFactor,
    color: rimSpec.color,
    intensity: rimSpec.intensity * distanceScale * activeTuning.rimMultiplier,
    angle: rimSpec.angle,
    penumbra: rimSpec.penumbra,
  });

  return {
    lookId: look.id,
    lookLabel: look.label,
    target,
    profileKind,
    materialTuning: Boolean(materialTuning),
    opticalFinish: look.opticalFinish,
    environmentDelta: {
      exposureScale: activeTuning.exposureScale,
      envIntensityScale: activeTuning.envIntensityScale,
      envRotationOffset: activeTuning.envRotationOffset,
    },
    lights: [keyRecord, rimRecord],
  };
}

function formatMegabytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0.0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatElapsedSeconds(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0.0s';
  return `${(ms / 1000).toFixed(1)}s`;
}

const PHASE_LABELS = Object.freeze({
  downloading: 'Downloading',
  parsing: 'Parsing geometry',
  'preparing-materials': 'Preparing materials & textures',
  'compiling-shaders': 'Compiling WebGPU shaders',
  'environment-hdr': 'Loading HDR environment',
  'applying-look': 'Applying Studio look',
});

export function createLoadingTelemetryTracker({
  stallThresholdMs = 5000,
  onChange = null,
} = {}) {
  const operations = new Map();
  let lastCompleted = null;
  const lastCompletedById = {};
  let lastFailed = null;
  const nowMs = customNow => (Number.isFinite(customNow) ? customNow : Date.now());

  function buildItemSnapshot(item, currentNow) {
    const elapsedMs = Math.max(0, currentNow - item.startedAtMs);
    const silentMs = Math.max(0, currentNow - item.lastProgressAtMs);
    const stalled = silentMs >= stallThresholdMs;
    const progressRatio =
      Number.isFinite(item.totalBytes) && item.totalBytes > 0 && Number.isFinite(item.loadedBytes)
        ? Math.max(0, Math.min(1, item.loadedBytes / item.totalBytes))
        : null;
    const phaseText = PHASE_LABELS[item.phase] || item.phase || 'Loading';
    let detail = phaseText;
    if (progressRatio !== null) {
      const pct = Math.round(progressRatio * 100);
      detail = `${phaseText} ${(item.loadedBytes / (1024 * 1024)).toFixed(1)} / ${formatMegabytes(item.totalBytes)} (${pct}%)`;
    } else if (Number.isFinite(item.loadedBytes) && item.loadedBytes > 0) {
      detail = `${phaseText} ${formatMegabytes(item.loadedBytes)}`;
    }
    const elapsedText = formatElapsedSeconds(elapsedMs);
    const summary = stalled
      ? `⚠ Stalled (${formatElapsedSeconds(silentMs)} no progress) · ${item.label} · ${detail} · ${elapsedText}`
      : `${item.label} · ${detail} · ${elapsedText}`;
    return {
      id: item.id,
      label: item.label,
      phase: item.phase,
      loadedBytes: item.loadedBytes,
      totalBytes: item.totalBytes,
      progressRatio,
      startedAtMs: item.startedAtMs,
      lastProgressAtMs: item.lastProgressAtMs,
      elapsedMs,
      silentMs,
      stalled,
      summary,
    };
  }

  function read(customNow) {
    const t = nowMs(customNow);
    const list = Array.from(operations.values()).map(item => buildItemSnapshot(item, t));
    // Prioritize asset or stalled operations first
    list.sort((a, b) => {
      if (a.stalled !== b.stalled) return a.stalled ? -1 : 1;
      const aPriority = a.id === 'asset' ? 0 : a.id === 'look-switch' ? 1 : 2;
      const bPriority = b.id === 'asset' ? 0 : b.id === 'look-switch' ? 1 : 2;
      return aPriority - bPriority;
    });
    const primary = list[0] ?? null;
    return {
      active: list.length > 0,
      stalled: list.some(item => item.stalled),
      primary,
      operations: list,
      summary: primary ? primary.summary : (lastFailed ? `Failed · ${lastFailed.label}: ${lastFailed.error}` : ''),
      lastCompleted: lastCompleted ? { ...lastCompleted } : null,
      lastCompletedById: { ...lastCompletedById },
      lastFailed: lastFailed ? { ...lastFailed } : null,
    };
  }

  function notify(customNow) {
    const state = read(customNow);
    onChange?.(state);
    return state;
  }

  return {
    start(id, { label = id, phase = 'downloading', loadedBytes = 0, totalBytes = 0, now } = {}) {
      const t = nowMs(now);
      operations.set(id, {
        id,
        label,
        phase,
        loadedBytes: Number.isFinite(loadedBytes) ? loadedBytes : 0,
        totalBytes: Number.isFinite(totalBytes) ? totalBytes : 0,
        startedAtMs: t,
        lastProgressAtMs: t,
      });
      lastFailed = null;
      return notify(t);
    },
    progress(id, { label, phase, loadedBytes, totalBytes, now } = {}) {
      const t = nowMs(now);
      const existing = operations.get(id);
      if (!existing) {
        return this.start(id, { label: label || id, phase: phase || 'downloading', loadedBytes, totalBytes, now: t });
      }
      if (label !== undefined) existing.label = label;
      if (phase !== undefined) existing.phase = phase;
      if (Number.isFinite(loadedBytes)) existing.loadedBytes = loadedBytes;
      if (Number.isFinite(totalBytes)) existing.totalBytes = totalBytes;
      existing.lastProgressAtMs = t;
      return notify(t);
    },
    complete(id, { now } = {}) {
      const t = nowMs(now);
      const existing = operations.get(id);
      if (existing) {
        const receipt = {
          id: existing.id,
          label: existing.label,
          phase: 'settled',
          loadedBytes: existing.loadedBytes,
          totalBytes: existing.totalBytes,
          durationMs: Math.max(0, t - existing.startedAtMs),
          completedAtMs: t,
        };
        lastCompletedById[existing.id] = receipt;
        if (existing.id === 'asset' || !lastCompletedById.asset || t - lastCompletedById.asset.completedAtMs > 4000) {
          lastCompleted = receipt;
        }
        operations.delete(id);
      }
      return notify(t);
    },
    fail(id, error, { now } = {}) {
      const t = nowMs(now);
      const existing = operations.get(id);
      lastFailed = {
        id,
        label: existing?.label ?? id,
        error: String(error?.message || error || 'unknown error'),
        failedAtMs: t,
      };
      operations.delete(id);
      return notify(t);
    },
    read,
    tick(now) {
      return notify(now);
    },
  };
}
