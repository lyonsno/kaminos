import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const trainerPath = `${root}/volume-residual-upscale-mlx.py`;
const runnerPath = `${root}/volume-residual-greenroom-runner.py`;

const trainer = fs.readFileSync(trainerPath, 'utf8');
const runner = fs.readFileSync(runnerPath, 'utf8');

assert.match(
  trainer,
  /--material-focus[\s\S]*choices=\["off", "fire-interface", "smoke"\]/,
  'residual trainer must expose a material-focus switch for separate fire/interface and smoke specialists',
);

assert.match(
  trainer,
  /def material_focus_mask\(/,
  'residual trainer must derive material masks from shader-authority feature channels instead of target RGB heuristics',
);

assert.match(
  trainer,
  /def material_mask_authority\([\s\S]*FEATURE_INPUT_AUTHORITY/,
  'material mask authority helper must use the shader/material feature authority constant',
);

assert.match(
  trainer,
  /"materialMaskAuthority": material_mask_authority/,
  'residual reports must preserve the authority of fire/smoke material masks used for split supervision',
);

assert.match(
  trainer,
  /materialFireCoverage[\s\S]*materialSmokeCoverage/,
  'residual reports must expose fire and smoke material coverage so split runs cannot silently train on empty masks',
);

assert.match(
  runner,
  /--material-focus/,
  'GPU Greenroom residual runner must forward material-focus to the MLX trainer',
);

assert.match(
  trainer,
  /--eval-pair-count/,
  'residual trainer must expose explicit eval pair count for support-scaling experiments',
);

assert.match(
  trainer,
  /--eval-selection[\s\S]*choices=\["tail", "even"\]/,
  'residual trainer must expose stable eval selection modes so larger corpora can hold out representative pairs',
);

assert.match(
  runner,
  /--eval-pair-count/,
  'GPU Greenroom residual runner must forward explicit eval pair count',
);
