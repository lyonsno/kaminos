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

assert.match(
  trainer,
  /class TeacherUNetResidualUpscaler\(nn\.Module\)/,
  'residual trainer must expose a larger teacher U-Net for offline ceiling probes beyond browser-sized candidates',
);

assert.match(
  trainer,
  /"teacher-unet"/,
  'residual trainer CLI must accept --model-arch=teacher-unet',
);

assert.match(
  trainer,
  /teacher-unet[\s\S]+unetDepth[\s\S]+3|unetDepth[\s\S]+teacher-unet[\s\S]+3/,
  'saved model config/report must preserve teacher-U-Net depth as a distinct architecture identity',
);

assert.match(
  trainer,
  /teacher-unet[\s\S]+three-level-encoder-decoder-skip|three-level-encoder-decoder-skip[\s\S]+teacher-unet/,
  'teacher U-Net must declare wider multiscale receptive-field authority, not masquerade as small-unet',
);

assert.match(
  runner,
  /teacher-unet/,
  'GPU Greenroom residual route wrapper must allow teacher-unet probes through to the trainer',
);
