import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const trainer = readFileSync(`${root}/volume-residual-upscale-mlx.py`, 'utf8');
const greenroomRunner = readFileSync(`${root}/volume-residual-greenroom-runner.py`, 'utf8');

assert.match(
  trainer,
  /choices=\["off", "active-edge-band", "soft-active-edge-band"\]/,
  'residual trainer must expose a soft active-edge-band application mode instead of only a hard binary mask',
);
assert.match(
  trainer,
  /--residual-mask-feather-radius/,
  'residual trainer must expose a caller-controlled residual mask feather radius',
);
assert.match(
  trainer,
  /--residual-smoothness-loss-weight/,
  'residual trainer must expose residual smoothness pressure for artifact/ring suppression',
);
assert.match(
  trainer,
  /def feather_residual_mask\(/,
  'residual trainer must implement an actual soft-mask feathering function',
);
assert.match(
  trainer,
  /def residual_smoothness_loss_value\(/,
  'residual trainer must implement smoothness loss on the learned residual, not merely report a knob',
);
assert.match(
  trainer,
  /"residualMaskFeatherRadius":/,
  'model artifacts and reports must preserve the effective residual mask feather radius',
);
assert.match(
  trainer,
  /"residualSmoothnessLossWeight":/,
  'model artifacts and reports must preserve the residual smoothness loss weight',
);
assert.match(
  trainer,
  /--residual-color-mode/,
  'residual trainer must expose residual color mode so chromatic rings can be suppressed separately from luma edge correction',
);
assert.match(
  trainer,
  /--chroma-residual-scale/,
  'residual trainer must expose chroma residual scale for luma/chroma residual probes',
);
assert.match(
  trainer,
  /--chroma-residual-loss-weight/,
  'residual trainer must expose chroma residual loss pressure for active edge-band ring suppression',
);
assert.match(
  trainer,
  /choices=\["center", "foreground", "edge-band", "full-frame"\]/,
  'residual trainer must expose explicit full-frame preview mode instead of relying on oversized crop accidents',
);
assert.match(
  trainer,
  /--preview-frame-count/,
  'residual trainer must expose a preview frame count for product-view multi-frame witnesses',
);
assert.match(
  trainer,
  /def constrain_residual_color\(/,
  'residual trainer must implement color-space residual constraining, not merely report a color knob',
);
assert.match(
  trainer,
  /def chroma_residual_loss_value\(/,
  'residual trainer must implement chroma residual loss on the learned residual',
);
assert.match(
  trainer,
  /"residualColorMode":/,
  'model artifacts and reports must preserve the residual color mode',
);
assert.match(
  trainer,
  /"chromaResidualScale":/,
  'model artifacts and reports must preserve the chroma residual scale',
);
assert.match(
  trainer,
  /"chromaResidualLossWeight":/,
  'model artifacts and reports must preserve the chroma residual loss weight',
);
assert.match(
  trainer,
  /"fullFramePreview":/,
  'reports must preserve full-frame preview identity when product-view evidence is requested',
);
assert.match(
  trainer,
  /"previewFrames":/,
  'reports must preserve all emitted preview frame artifacts, not only a single representative crop',
);
assert.match(
  greenroomRunner,
  /--residual-mask-feather-radius/,
  'Greenroom wrapper must pass residual mask feather radius through to the MLX trainer',
);
assert.match(
  greenroomRunner,
  /--residual-smoothness-loss-weight/,
  'Greenroom wrapper must pass residual smoothness weight through to the MLX trainer',
);
assert.match(
  greenroomRunner,
  /--residual-color-mode/,
  'Greenroom wrapper must pass residual color mode through to the MLX trainer',
);
assert.match(
  greenroomRunner,
  /--chroma-residual-scale/,
  'Greenroom wrapper must pass chroma residual scale through to the MLX trainer',
);
assert.match(
  greenroomRunner,
  /--chroma-residual-loss-weight/,
  'Greenroom wrapper must pass chroma residual loss weight through to the MLX trainer',
);
assert.match(
  greenroomRunner,
  /--preview-frame-count/,
  'Greenroom wrapper must pass preview frame count through to the MLX trainer',
);
