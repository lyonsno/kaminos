export function measureReceiverLightDelta(onImage, mutedImage, region = {}) {
  if (
    onImage?.width !== mutedImage?.width ||
    onImage?.height !== mutedImage?.height ||
    onImage?.channels !== mutedImage?.channels
  ) {
    throw new Error('receiver-light paired captures require matching dimensions and channels');
  }

  const width = Number(onImage.width);
  const height = Number(onImage.height);
  const channels = Number(onImage.channels);
  const xStart = Math.max(0, Math.floor(width * (region.xMin ?? 0)));
  const xEnd = Math.min(width, Math.ceil(width * (region.xMax ?? 1)));
  const yStart = Math.max(0, Math.floor(height * (region.yMin ?? 0)));
  const yEnd = Math.min(height, Math.ceil(height * (region.yMax ?? 1)));
  let changedPixels = 0;
  let positiveLumaPixels = 0;
  let warmPositivePixels = 0;
  let positiveLumaTotal = 0;
  let maxPositiveLumaDelta = 0;

  for (let y = yStart; y < yEnd; y += 1) {
    const onRow = onImage.rows[y];
    const mutedRow = mutedImage.rows[y];
    for (let x = xStart; x < xEnd; x += 1) {
      const index = x * channels;
      const dr = onRow[index] - mutedRow[index];
      const dg = onRow[index + 1] - mutedRow[index + 1];
      const db = onRow[index + 2] - mutedRow[index + 2];
      const lumaDelta = 0.2126 * dr + 0.7152 * dg + 0.0722 * db;
      if (Math.abs(lumaDelta) >= 2) changedPixels += 1;
      if (lumaDelta >= 2) {
        positiveLumaPixels += 1;
        positiveLumaTotal += lumaDelta;
        maxPositiveLumaDelta = Math.max(maxPositiveLumaDelta, lumaDelta);
        if (dr > db + 1 && dg > db) warmPositivePixels += 1;
      }
    }
  }

  return {
    identity: 'receiver-light-paired-delta-v0',
    width,
    height,
    region: { xStart, xEnd, yStart, yEnd },
    sampledPixels: Math.max(0, xEnd - xStart) * Math.max(0, yEnd - yStart),
    changedPixels,
    positiveLumaPixels,
    warmPositivePixels,
    meanPositiveLumaDelta: positiveLumaTotal / Math.max(1, positiveLumaPixels),
    maxPositiveLumaDelta,
  };
}
