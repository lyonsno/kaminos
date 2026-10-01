const palette = [[25, 24, 55], [83, 45, 110], [161, 65, 108], [232, 120, 83], [252, 237, 156]];
export function similarityColor(t) {
  const x = Math.max(0, Math.min(1, t)) * (palette.length - 1);
  const i = Math.min(palette.length - 2, Math.floor(x));
  return palette[i].map((v, c) => Math.round(v + (palette[i + 1][c] - v) * (x - i)));
}

export function featurePixels(values, width, height) {
  if (values.length !== width * height || !values.every(Number.isFinite)) throw new Error('Invalid feature map');
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pixels = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const color = similarityColor(max === min ? 0 : (values[i] - min) / (1 - min));
    pixels.set([...color, 255], i * 4);
  }
  return { pixels, min, max };
}
