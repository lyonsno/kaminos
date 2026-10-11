// Noah's exported material-photograph-preset.json, October 11.
export const DEFAULT_PRESET={
  schema:'kaminos.material-photo-preset.v1',
  settings:{gain:50,radius:1,thickness:.1,slices:8,steps:10,denoise:1,aoStrength:.5,
    expFactor:1,screenSpaceSampling:true,linearThickness:false,backfaceLighting:1,depthPhi:.5,normalPhi:5,lumaPhi:5},
  light:{x:.9997602257733113,y:.02189728206183767},
  camera:{orbit:[-.018604133702531615,.0029375503220611795]},
  gi:true,glow:true,lighting:{rotation:146,intensity:2,direct:3},
  contrast:{mode:'manual',roughness:.49,metallic:.83},diagnostic:'scene',environment:'warehouse',
};

export function superMatProductProfile(device) {
  const half=device.features.has('shader-f16');
  return {activations:half?'f16':'f32',fuseNorm:half,gemmPrecision:half?'f16-tiles':'f32',attention:'streaming'};
}
