import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const trainerPath = `${root}/volume-residual-upscale-mlx.py`;
const runnerPath = `${root}/volume-residual-greenroom-runner.py`;

const trainer = fs.readFileSync(trainerPath, 'utf8');
const runner = fs.readFileSync(runnerPath, 'utf8');

assert.match(
  trainer,
  /class SmallUNetResidualUpscaler\(nn\.Module\)/,
  'residual trainer must expose a small U-Net architecture for wider spatial-support probes',
);

assert.match(
  trainer,
  /"small-unet"/,
  'residual trainer CLI must accept --model-arch=small-unet',
);

assert.match(
  trainer,
  /nn\.MaxPool2d|nn\.AvgPool2d/,
  'small U-Net must include an encoder downsample path, not just another local 3x3 stack',
);

assert.match(
  trainer,
  /nn\.ConvTranspose2d/,
  'small U-Net must include a learned decoder upsample path for multiscale reconstruction',
);

assert.match(
  trainer,
  /mx\.concatenate\(\[.*skip/s,
  'small U-Net must concatenate decoder activations with encoder skip features',
);

assert.match(
  trainer,
  /detailGate.+small-unet|unetDepth.+small-unet|receptiveField.+small-unet/s,
  'saved model config/report must preserve small-U-Net identity beyond just modelArch',
);

assert.match(
  runner,
  /small-unet/,
  'GPU Greenroom residual route wrapper must allow small-unet probes through to the trainer',
);
