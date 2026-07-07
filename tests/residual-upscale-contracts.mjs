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
  /--smoke-structure-loss-weight/,
  'residual trainer must expose smoke-structure loss so smoke detail can be rewarded separately from broad RGB MSE',
);
assert.match(
  trainer,
  /--smoke-residual-dc-loss-weight/,
  'residual trainer must expose smoke residual DC loss so broad haze/fade residuals can be penalized',
);
assert.match(
  trainer,
  /--smoke-mask-threshold/,
  'residual trainer must expose a smoke mask threshold for visible cool-smoke region targeting',
);
assert.match(
  trainer,
  /def smoke_structure_loss_value\(/,
  'residual trainer must implement a smoke high-pass/gradient structure loss, not merely report a knob',
);
assert.match(
  trainer,
  /def smoke_residual_dc_loss_value\(/,
  'residual trainer must implement residual DC suppression on smoke regions to fight haze/fade',
);
assert.match(
  trainer,
  /def smoke_region_mask\(/,
  'residual trainer must derive a smoke-region mask instead of applying smoke losses globally',
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
  /"smokeStructureLossWeight":/,
  'model artifacts and reports must preserve smoke structure loss weight',
);
assert.match(
  trainer,
  /"smokeResidualDcLossWeight":/,
  'model artifacts and reports must preserve smoke residual DC loss weight',
);
assert.match(
  trainer,
  /"smokeMaskThreshold":/,
  'model artifacts and reports must preserve the smoke mask threshold',
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
  trainer,
  /"temporalSequencePreview":/,
  'temporal witnesses must preserve a sequence contact-sheet artifact, not only scalar temporal metrics',
);
assert.match(
  trainer,
  /"temporalSequenceFrames":/,
  'temporal witnesses must report the exact rendered frame rows used by the sequence contact sheet',
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
  /--smoke-structure-loss-weight/,
  'Greenroom wrapper must pass smoke structure loss weight through to the MLX trainer',
);
assert.match(
  greenroomRunner,
  /--smoke-residual-dc-loss-weight/,
  'Greenroom wrapper must pass smoke residual DC loss weight through to the MLX trainer',
);
assert.match(
  greenroomRunner,
  /--smoke-mask-threshold/,
  'Greenroom wrapper must pass smoke mask threshold through to the MLX trainer',
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
assert.match(
  trainer,
  /--feature-input-mode/,
  'residual trainer must expose feature-input mode for shader/material-authority feature channels',
);
assert.match(
  trainer,
  /feature-rgba/,
  'residual trainer must support low RGB plus residual feature RGBA as a 7-channel model input',
);
assert.match(
  trainer,
  /aux-rgba/,
  'residual trainer must support low RGB plus auxiliary debug RGBA as a 7-channel model input',
);
assert.match(
  trainer,
  /aux-rgb/,
  'residual trainer must support low RGB plus auxiliary debug RGB without a constant alpha bias channel',
);
assert.match(
  trainer,
  /aux-red-cyan-abs/,
  'residual trainer must support a normalized red/cyan opponent carrier derived from Flow Debug',
);
assert.match(
  trainer,
  /aux-opponent-gradient/,
  'residual trainer must support a normalized Flow Debug opponent-gradient carrier',
);
assert.match(
  trainer,
  /shader-material-authority-residual-feature-v0/,
  'residual trainer must preserve shader/material feature authority instead of treating feature inputs as screen-space proxies',
);
assert.match(
  trainer,
  /flow-debug-interface-canvas-capture-v0/,
  'residual trainer must preserve Flow Debug/interface authority instead of treating auxiliary inputs as residual feature planes',
);
assert.match(
  trainer,
  /featureInputChannels/,
  'residual trainer reports must preserve the effective feature input channel count',
);
assert.match(
  trainer,
  /featurePath/,
  'residual trainer must load per-pair feature images from the corpus rather than synthesizing hidden proxy features',
);
assert.match(
  trainer,
  /auxiliaryCaptures/,
  'residual trainer must load auxiliary debug images from the corpus rather than hiding them behind featurePath',
);
assert.match(
  greenroomRunner,
  /--feature-input-mode/,
  'Greenroom wrapper must pass feature-input mode through to the MLX trainer',
);
