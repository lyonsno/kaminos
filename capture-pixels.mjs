import assert from 'node:assert/strict';

export function assertCapturePixels({ width, height, channels, pixels }, capture) {
  assert.ok(width === capture.width && height === capture.height && pixels.length === width * height * channels,
    'Capture dimensions differ from PNG');
  let first, varying = false;
  for (let i = 0; i < pixels.length; i += channels) {
    if (channels === 4 && pixels[i + 3] === 0) continue;
    const color = pixels[i] * 65536 + pixels[i + 1] * 256 + pixels[i + 2];
    if (first === undefined) first = color;
    else if (first !== color) { varying = true; break; }
  }
  assert.ok(varying, 'Capture is empty or uniform; inspect the rendered scene');
}
