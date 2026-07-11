import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const witnessPath = `${root}/volume-witness.mjs`;
const corpusPath = `${root}/volume-render-pair-corpus.mjs`;
const trainerPath = `${root}/volume-residual-upscale-mlx.py`;
const runnerPath = `${root}/volume-residual-greenroom-runner.py`;

const witness = fs.readFileSync(witnessPath, 'utf8');
const corpus = fs.readFileSync(corpusPath, 'utf8');
const trainer = fs.readFileSync(trainerPath, 'utf8');
const runner = fs.readFileSync(runnerPath, 'utf8');

assert.match(
  witness,
  /BOUNDARY_SIDECAR_SUPPORT_AUXILIARY_CAPTURE_AUTHORITY\s*=\s*'boundary-sidecar-support-canvas-capture-v0'/,
  'witness must name boundary-sidecar support auxiliary capture authority separately from Flow Debug',
);

assert.match(
  witness,
  /renderScaleBoundarySidecarSupportCaptures/,
  'witness must parse boundary-sidecar-support auxiliary captures from render-scale auxiliary modes',
);

assert.match(
  witness,
  /function captureBoundarySidecarSupportAuxiliary\(/,
  'witness must capture frozen-state boundary sidecar support as an auxiliary image',
);

assert.match(
  witness,
  /boundarySidecarSupport[\s\S]*captureBoundarySidecarSupportAuxiliary/,
  'witness must store boundarySidecarSupport under auxiliaryCaptures for low render-scale samples',
);

assert.match(
  corpus,
  /BOUNDARY_SIDECAR_SUPPORT_AUXILIARY_AUTHORITY\s*=\s*'boundary-sidecar-support-canvas-capture-v0'/,
  'render pair corpus must preserve boundary-sidecar support auxiliary authority in the manifest',
);

assert.match(
  corpus,
  /key:\s*'boundarySidecarSupport'[\s\S]*channelLayout:\s*'boundary-sidecar-support-rgba'/,
  'render pair corpus must advertise boundarySidecarSupport channel layout separately from flowDebug',
);

assert.match(
  trainer,
  /BOUNDARY_SIDECAR_SUPPORT_AUXILIARY_INPUT_AUTHORITY\s*=\s*"boundary-sidecar-support-canvas-capture-v0"/,
  'trainer must know the boundary-sidecar support auxiliary authority',
);

assert.match(
  trainer,
  /--sidecar-sampling-mode[\s\S]*choices=\["off", "support"\]/,
  'trainer must expose sidecar support crop sampling as an explicit mode',
);

assert.match(
  trainer,
  /sidecarSupportPixels/,
  'trainer reports must expose sidecar support pixel counts so empty masks fail visibly',
);

assert.match(
  trainer,
  /sidecar_sampling_pixels\(/,
  'trainer must derive crop pixels from sidecar support auxiliary captures',
);

assert.match(
  runner,
  /--sidecar-sampling-mode/,
  'Greenroom runner must forward sidecar sampling mode',
);

assert.match(
  runner,
  /--sidecar-sampling-probability/,
  'Greenroom runner must forward sidecar sampling probability',
);
