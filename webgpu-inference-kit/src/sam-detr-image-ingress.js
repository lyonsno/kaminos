export function createSam3PositionEmbeddingSine({ batch, height, width, channels, temperature = 10000.0, scale = Math.PI * 2 }) {
  if (!Number.isInteger(batch) || batch <= 0) throw new Error('position embedding batch must be positive');
  if (!Number.isInteger(height) || height <= 0) throw new Error('position embedding height must be positive');
  if (!Number.isInteger(width) || width <= 0) throw new Error('position embedding width must be positive');
  if (!Number.isInteger(channels) || channels <= 0 || channels % 4 !== 0) throw new Error('position embedding channels must be a positive multiple of 4');
  const numPosFeats = channels / 2;
  const output = new Float32Array(batch * height * width * channels);
  const eps = 1e-6;
  for (let b = 0; b < batch; b += 1) {
    for (let y = 0; y < height; y += 1) {
      const yEmbed = ((y + 1) / (height + eps)) * scale;
      for (let x = 0; x < width; x += 1) {
        const xEmbed = ((x + 1) / (width + eps)) * scale;
        const base = ((b * height + y) * width + x) * channels;
        for (let d = 0; d < numPosFeats; d += 2) {
          const dim = temperature ** ((2 * Math.floor(d / 2)) / numPosFeats);
          output[base + d] = Math.sin(yEmbed / dim);
          output[base + d + 1] = Math.cos(yEmbed / dim);
          output[base + numPosFeats + d] = Math.sin(xEmbed / dim);
          output[base + numPosFeats + d + 1] = Math.cos(xEmbed / dim);
        }
      }
    }
  }
  return output;
}

export function createSam3DetrImageIngressFromFpnFeatures({ fpnNeckFeatures, levels, sourceLevel = 2, channels }) {
  if (!Array.isArray(fpnNeckFeatures) || fpnNeckFeatures.length <= sourceLevel) throw new Error('FPN neck features must include the requested DETR source level');
  if (!Array.isArray(levels) || levels.length <= sourceLevel) throw new Error('FPN shape levels must include the requested DETR source level');
  const level = levels[sourceLevel];
  if (!level || level.level !== sourceLevel) throw new Error(`FPN level ${sourceLevel} shape metadata is required`);
  const batch = level.batch ?? 1;
  const height = level.height;
  const width = level.width;
  const encoderSrcSource = `browser-fpn-neck-feature-${sourceLevel}`;
  if (!Number.isInteger(channels) || channels <= 0) throw new Error('DETR image ingress channels must be positive');
  const expectedLength = batch * height * width * channels;
  const encoderSrc = new Float32Array(fpnNeckFeatures[sourceLevel]);
  if (encoderSrc.length !== expectedLength) throw new Error(`${encoderSrcSource} length ${encoderSrc.length} does not match ${expectedLength}`);
  const encoderPos = createSam3PositionEmbeddingSine({ batch, height, width, channels });
  return {
    encoderSrc,
    encoderPos,
    sourceLevel,
    encoderSrcSource,
    shape: { batch, height, width, channels, spatialTokens: height * width },
    positionEncoding: {
      type: 'PositionEmbeddingSine',
      numPosFeats: channels / 2,
      temperature: 10000.0,
      normalize: true,
      scale: Math.PI * 2,
      source: 'browser-local-fpn-level-shape',
    },
  };
}
