export function resolveSceneGISettings(value = {}) {
  // Noah's saved goodcheapgisettings3slices3stepskiln scene, October14.
  const settings = {mode:'combined', view:'scene', gain:3.5, radius:8.364843749999999,
    thickness:6.806132812500005, slices:3, steps:3, denoise:16, resolutionScale:1};
  for (const key of Object.keys(settings)) if (Object.hasOwn(value,key)) settings[key]=value[key];
  if (!['gtao','combined'].includes(settings.mode)) throw new Error('Invalid scene GI mode');
  if (!['scene','ao','gi','incoming'].includes(settings.view)) throw new Error('Invalid scene GI view');
  for (const key of ['gain','radius','thickness','slices','steps','denoise','resolutionScale']) {
    if (!Number.isFinite(settings[key]) || settings[key] < 0) throw new Error(`Invalid scene GI ${key}`);
  }
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
  const settings = {expFactor:2,screenSpaceSampling:false,linearThickness:false,backfaceLighting:0.18003906250000004,depthPhi:.1,normalPhi:5,lumaPhi:5};
  for (const key of Object.keys(settings)) if (Object.hasOwn(value,key)) settings[key]=value[key];
  for (const key of ['expFactor','depthPhi','normalPhi','lumaPhi']) {
    if (!Number.isFinite(settings[key]) || settings[key] <= 0) throw new Error(`Invalid scene GI ${key}`);
  }
  if (!Number.isFinite(settings.backfaceLighting) || settings.backfaceLighting < 0) throw new Error('Invalid scene GI backfaceLighting');
  for (const key of ['screenSpaceSampling','linearThickness']) if (typeof settings[key] !== 'boolean') throw new Error(`Invalid scene GI ${key}`);
  return settings;
}

// Scene files, UI edits and agent calls share one complete settings shape.
// Older scenes omit estimator and receive the established defaults.
export function resolveSceneGIControlState(value = {}) {
  return {...resolveSceneGISettings(value), estimator:resolveSceneGIEstimatorSettings(value.estimator)};
}
