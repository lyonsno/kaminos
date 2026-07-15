import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const trainerPath = `${root}/volume-residual-upscale-mlx.py`;
const runnerPath = `${root}/volume-residual-greenroom-runner.py`;

const trainer = fs.readFileSync(trainerPath, 'utf8');
const runner = fs.readFileSync(runnerPath, 'utf8');

assert.match(
  trainer,
  /--coordinate-input-mode/,
  'residual trainer must expose coordinate conditioning for offline ceiling probes',
);

assert.match(
  trainer,
  /choices=\["off", "xy", "fourier"\]/,
  'coordinate conditioning must distinguish off, raw xy, and Fourier positional channels',
);

assert.match(
  trainer,
  /def coordinate_feature_image/,
  'trainer must derive coordinate features from absolute crop origin and full image dimensions',
);

assert.match(
  trainer,
  /fourierCoordinateFrequencies/,
  'trainer reports must preserve Fourier coordinate frequency count for repeatable ceiling probes',
);

assert.match(
  trainer,
  /top,\s*left,\s*height,\s*width[\s\S]*coordinateInputMode/,
  'patch sampling and preview paths must pass crop origin into coordinate-conditioned model inputs',
);

assert.match(
  runner,
  /--coordinate-input-mode/,
  'GPU Greenroom residual route wrapper must forward coordinate conditioning to the trainer',
);
