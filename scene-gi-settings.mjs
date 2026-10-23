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
  const settings = {expFactor:2,screenSpaceSampling:false,linearThickness:false,backfaceLighting:1,depthPhi:.1,normalPhi:5,lumaPhi:5};
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
