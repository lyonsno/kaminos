export function resolveSceneGISettings(value = {}) {
  const settings = {mode:'gtao', view:'scene', gain:1, radius:4, thickness:.3, slices:3, steps:8, denoise:3, ...value};
  if (!['gtao','combined'].includes(settings.mode)) throw new Error('Invalid scene GI mode');
  if (!['scene','ao','gi'].includes(settings.view)) throw new Error('Invalid scene GI view');
  for (const key of ['gain','radius','thickness','slices','steps','denoise']) {
    if (!Number.isFinite(settings[key]) || settings[key] < 0) throw new Error(`Invalid scene GI ${key}`);
  }
  for (const key of ['radius','thickness','slices','steps']) {
    if (settings[key] === 0) throw new Error(`Scene GI ${key} must be positive`);
  }
  for (const key of ['slices','steps']) {
    if (!Number.isInteger(settings[key])) throw new Error(`Scene GI ${key} must be integral`);
  }
  return settings;
}

export function sceneGIReceives(material) {
  return material.transparent !== true && (material.isMeshStandardNodeMaterial === true || material.isMeshPhysicalNodeMaterial === true);
}
