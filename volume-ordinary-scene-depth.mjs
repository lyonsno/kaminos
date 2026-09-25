// Ordinary emissive raymarch depth input. Native texture stays borrowed;
// the host renders it with this same camera immediately before each frame.
export function validateOrdinarySceneDepth(source, {device, camera}) {
  if (!source?.texture) throw new Error('ordinary-scene-depth-missing');
  if (source.device !== device) throw new Error('ordinary-scene-depth-device-mismatch');
  if (source.camera !== camera) throw new Error('ordinary-scene-depth-camera-mismatch');
  if (!(source.texture.sampleCount >= 1)) throw new Error('ordinary-scene-depth-sample-count');
  if (!['depth16unorm','depth24plus','depth32float'].includes(source.texture.format)) {
    throw new Error('ordinary-scene-depth-format');
  }
  if (!(source.texture.width > 0 && source.texture.height > 0)) throw new Error('ordinary-scene-depth-size');
  return source.texture;
}

// VSOut.uv is bottom-up NDC-derived; WebGPU texture rows are top-down.
// Coordinates are normalized so volume render scale and scene DPR may differ.
export function ordinarySceneDepthPixel(uv, size) {
  return [Math.max(0,Math.min(size[0]-1,Math.floor(uv[0]*size[0]))),
    Math.max(0,Math.min(size[1]-1,Math.floor((1-uv[1])*size[1])))];
}
