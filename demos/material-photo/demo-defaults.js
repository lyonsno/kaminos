// Noah's exported material-photograph-preset (6).json, October 12.
export const DEFAULT_PRESET={
  "schema": "kaminos.material-photo-preset.v1",
  "settings": {
    "gain": 1,
    "radius": 4,
    "thickness": 0.06,
    "slices": 12,
    "steps": 12,
    "denoise": 0.001,
    "aoStrength": 1,
    "expFactor": 2,
    "screenSpaceSampling": true,
    "linearThickness": false,
    "backfaceLighting": 0.3,
    "depthPhi": 0.5,
    "normalPhi": 5,
    "lumaPhi": 5
  },
  "light": {
    "x": 0.9762524801587303,
    "y": 0.03689236111111113
  },
  "camera": {
    "orbit": [
      -0.20766499955689163,
      -0.09401037635186385
    ]
  },
  "gi": true,
  "glow": false,
  "lighting": {
    "rotation": 163,
    "intensity": 1.5,
    "direct": 0.5
  },
  "contrast": {
    "mode": "manual",
    "roughness": 0.28,
    "metallic": 1
  },
  "diagnostic": "scene",
  "effects": {
    "glowIntensity": 5.05,
    "glowThreshold": 0.37,
    "emissionReflection": 0,
    "bloom": true,
    "bloomIntensity": 1.18,
    "bloomRadius": 0.5,
    "bloomThreshold": 0.61,
    "exposure": 1
  },
  "environment": "warehouse"
};

export function superMatProductProfile(device) {
  const half=device.features.has('shader-f16');
  return {activations:half?'f16':'f32',fuseNorm:half,gemmPrecision:half?'f16-tiles':'f32',attention:'streaming'};
}
