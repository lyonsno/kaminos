export function resolveSceneGISettings(value = {}) {
  // Noah's accepted broad-GI profile, October16; explicit scene values win.
  const settings = {mode:'combined', view:'scene', gain:5, radius:20,
    thickness:7, slices:3, steps:3, denoise:1, resolutionScale:1, temporal:true, temporalRefine:true, temporalWeight:.9, bounceFeedback:false};
  for (const key of Object.keys(settings)) if (Object.hasOwn(value,key)) settings[key]=value[key];
  if (!['gtao','combined'].includes(settings.mode)) throw new Error('Invalid scene GI mode');
  if (!['scene','ao','gi','incoming'].includes(settings.view)) throw new Error('Invalid scene GI view');
  for (const key of ['gain','radius','thickness','slices','steps','denoise','resolutionScale']) {
    if (!Number.isFinite(settings[key]) || settings[key] < 0) throw new Error(`Invalid scene GI ${key}`);
  }
  if(typeof settings.temporalRefine !== 'boolean')throw new Error('Invalid scene GI temporalRefine');
  if(typeof settings.temporal !== 'boolean')throw new Error('Invalid scene GI temporal');
  if(typeof settings.bounceFeedback !== 'boolean')throw new Error('Invalid scene GI bounceFeedback');
  if(!Number.isFinite(settings.temporalWeight)||settings.temporalWeight<0||settings.temporalWeight>=1)throw new Error('Scene GI temporalWeight must be in [0, 1)');
  for (const key of ['radius','thickness','slices','steps','resolutionScale']) {
    if (settings[key] === 0) throw new Error(`Scene GI ${key} must be positive`);
  }
  for (const key of ['slices','steps']) {
    if (!Number.isInteger(settings[key])) throw new Error(`Scene GI ${key} must be integral`);
  }
  return settings;
}

export function sceneGIReceives(material) {
  return material.transparent !== true && (material.isMeshStandardNodeMaterial === true || material.isMeshPhysicalNodeMaterial === true ||
    material.isMeshStandardMaterial === true || material.isMeshPhysicalMaterial === true);
}

export function resolveSceneGIEstimatorSettings(value = {}) {
  const settings = {expFactor:2,screenSpaceSampling:false,linearThickness:false,backfaceLighting:.2,depthPhi:.1,normalPhi:5,lumaPhi:5,mipSampling:false,perspectiveReconstruction:false};
  for (const key of Object.keys(settings)) if (Object.hasOwn(value,key)) settings[key]=value[key];
  for (const key of ['expFactor','depthPhi','normalPhi','lumaPhi']) {
    if (!Number.isFinite(settings[key]) || settings[key] <= 0) throw new Error(`Invalid scene GI ${key}`);
  }
  if (!Number.isFinite(settings.backfaceLighting) || settings.backfaceLighting < 0) throw new Error('Invalid scene GI backfaceLighting');
  for (const key of ['screenSpaceSampling','linearThickness','mipSampling','perspectiveReconstruction']) if (typeof settings[key] !== 'boolean') throw new Error(`Invalid scene GI ${key}`);
  return settings;
}

// Scene files, UI edits and agent calls share one complete settings shape.
// Older scenes omit estimator and receive the established defaults.
export function resolveSceneGIControlState(value = {}) {
  return {...resolveSceneGISettings(value), estimator:resolveSceneGIEstimatorSettings(value.estimator)};
}

// Calibrate world-space SSGI horizon radius and surface thickness to the
// active scene bounds and camera distance so crevices, contact shadows, and
// local bounce match the actual geometry scale rather than only a 20m room.
export function calibrateSceneGISettingsForBounds({ boxes = [], cameraDistance = null, current = {} } = {}) {
  const base = resolveSceneGIControlState(current);
  const validBoxes = (Array.isArray(boxes) ? boxes : []).filter(box =>
    Array.isArray(box?.min) && Array.isArray(box?.max) &&
    box.min.length === 3 && box.max.length === 3 &&
    box.min.every((v, i) => Number.isFinite(v) && Number.isFinite(box.max[i]) && box.max[i] >= v));
  const diagonals = validBoxes
    .map(b => Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]))
    .filter(d => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);
  if (!diagonals.length) return base;
  const unionMin = [Infinity, Infinity, Infinity], unionMax = [-Infinity, -Infinity, -Infinity];
  for (const b of validBoxes) {
    for (let i = 0; i < 3; i++) {
      if (b.min[i] < unionMin[i]) unionMin[i] = b.min[i];
      if (b.max[i] > unionMax[i]) unionMax[i] = b.max[i];
    }
  }
  const unionDiagonal = Math.hypot(unionMax[0] - unionMin[0], unionMax[1] - unionMin[1], unionMax[2] - unionMin[2]);
  const medianDiagonal = diagonals[Math.floor((diagonals.length - 1) / 2)];
  const geomRadius = 0.65 * unionDiagonal;
  const viewRadius = Number.isFinite(cameraDistance) && cameraDistance > 0 ? 0.52 * cameraDistance : geomRadius;
  const rawRadius = 0.65 * geomRadius + 0.35 * viewRadius;
  const radius = Math.round(Math.max(0.25, Math.min(25, rawRadius)) * 100) / 100;
  const rawThickness = 0.14 * medianDiagonal;
  const thickness = Math.round(Math.max(0.08, Math.min(Math.min(2.5, radius * 0.45), rawThickness)) * 100) / 100;
  const bounceFeedback = Object.hasOwn(current, 'bounceFeedback')
    ? Boolean(current.bounceFeedback) && base.temporal !== false
    : base.temporal !== false;
  return resolveSceneGIControlState({ ...base, radius, thickness, bounceFeedback });
}
