import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../boundary-splat-radiance-mlx.py', import.meta.url), 'utf8').catch(() => '');

assert.match(script, /--optical-decoder/, 'radiance trainer exposes an explicit optical decoder family');
assert.match(
  script,
  /choices=\["none",\s*"screen-unet"\]/,
  'screen-global decoding is opt-in and cannot silently replace splat-attribute training',
);
assert.match(
  script,
  /class\s+ScreenResidualUnet\(nn\.Module\)/,
  'screen-global probe uses a learned multiscale convolutional decoder rather than another pointwise head',
);
assert.match(
  script,
  /screen-rgb-luma-gradient-v0/,
  'optical decoder receipts preserve the exact deterministic screen input contract',
);
assert.match(
  script,
  /--optical-feature-mode[\s\S]*choices=\["screen-only",\s*"projected-native"\]/,
  'projected native conditioning is an explicit optical input mode rather than a silent contract change',
);
assert.match(
  script,
  /candidate-attached-native-fields-weight-normalized-screen-projection-v0/,
  'projected native receipts identify candidate-authoritative screen projection rather than flow-debug or target leakage',
);
assert.match(
  script,
  /def\s+project_native_feature_planes\([^)]*geometry[^)]*attributes[^)]*\):[\s\S]*geometry\["features"\][\s\S]*geometry\["pixelIndices"\][\s\S]*geometry\["splatIndices"\][\s\S]*\.at\[pixel_indices\]\.add/,
  'native optical planes are rasterized from exact candidate fields through the existing splat footprint membership',
);
assert.match(
  script,
  /feature_sum\s*\/\s*mx\.maximum\(weight_sum/,
  'overlapping native candidate features are weight-normalized instead of brightening with candidate count',
);
assert.match(
  script,
  /active_decoder\(\s*base_predictions\[frame_index\],\s*optical_feature_planes\[frame_index\],\s*optical_control_conditions\[frame_index\],\s*\)/,
  'the training objective consumes projected native planes and the explicit per-frame condition vector',
);
assert.doesNotMatch(
  script,
  /screen_decoder_inputs\([^)]*flow_debug|ScreenResidualUnet[\s\S]{0,2500}flow_debug/i,
  'display-only flow debug cannot enter the optical decoder input path',
);
assert.match(
  script,
  /mx\.stop_gradient\(base_prediction\)/,
  'screen-global training freezes the proven splat raster instead of laundering attribute-head updates into the result',
);
assert.match(
  script,
  /output\.weight\s*=\s*mx\.zeros_like\(self\.output\.weight\)/,
  'the optical residual path begins as an exact zero-delta extension',
);
assert.match(
  script,
  /screen-global-multiscale-residual-unet-v0/,
  'reports distinguish global optical authority from splat-attribute authority',
);
assert.match(
  script,
  /"opticalDecoder"\s*:\s*args\.optical_decoder/,
  'training receipts preserve the effective optical decoder family',
);
assert.match(
  script,
  /"opticalInputAuthority"\s*:\s*\(\s*model_receipt\["inputAuthority"\]/,
  'training receipts preserve the exact mode-dependent optical input authority',
);
assert.match(
  script,
  /"deployable"\s*:\s*False/,
  'the offline ceiling probe cannot masquerade as browser-deployable',
);
assert.match(
  script,
  /screen-unet requires an explicit disjoint frame holdout/,
  'the richer decoder refuses train-frame evaluation that could counterfeit generalization',
);
assert.match(
  script,
  /--partial-flow-debug-gain/,
  'optical evaluation exposes the operator-requested partial flow-debug witness gain',
);
assert.match(
  script,
  /0\.5\s*<=\s*args\.partial_flow_debug_gain\s*<=\s*0\.75/,
  'nonzero partial flow-debug gain is constrained to the witnessed lawful range',
);
assert.match(
  script,
  /partial flow-debug witness requires a verified same-state flow-debug artifact/,
  'requesting the diagnostic fails loud rather than silently omitting missing flow-debug evidence',
);
assert.match(
  script,
  /flow-debug-interface-canvas-capture-v0/,
  'optical receipts preserve the established flow-debug shader authority',
);
assert.match(
  script,
  /display-only-linear-mix-v0/,
  'partial flow-debug composition cannot masquerade as a renderer, simulator, or model input change',
);
assert.match(
  script,
  /"reference"[\s\S]*"control"[\s\S]*"predicted"/,
  'partial flow-debug output preserves all three semantic comparison roles',
);
assert.match(
  script,
  /"requestedGain"\s*:\s*args\.partial_flow_debug_gain[\s\S]*"effectiveGain"/,
  'training receipts preserve requested and effective diagnostic gain',
);
assert.match(
  script,
  /--optical-roi-mode[\s\S]*choices=\["full-frame",\s*"candidate-flame-bounds"\]/,
  'optical training exposes candidate-derived flame-local normalization as an explicit mode',
);
assert.match(
  script,
  /projected-live-candidate-fire-support-bounds-v0/,
  'candidate flame crops carry a source-authoritative receipt rather than target-image authority',
);
assert.match(
  script,
  /def\s+resolve_optical_roi\([^)]*frame[^)]*max_radius[^)]*mode[^)]*\):[\s\S]*fire\.energy[\s\S]*fire\.temperature[\s\S]*fire\.emission[\s\S]*project_points/,
  'flame-local bounds derive from projected live candidate fire channels',
);
assert.doesNotMatch(
  script,
  /def\s+resolve_optical_roi\([^)]*\):[\s\S]{0,5000}targetPath/,
  'the ROI resolver cannot inspect target pixels and leak the answer into crop selection',
);
assert.match(
  script,
  /candidate-flame-bounds produced no valid projected fire support/,
  'missing candidate flame support fails loud instead of silently reverting to full-frame supervision',
);
assert.match(
  script,
  /target image dimensions[^\n]+source viewport/,
  'ROI target loading rejects viewport mismatch rather than training against a misregistered crop',
);
assert.match(
  script,
  /\.crop\(tuple\(roi\["sourceBounds"\]\)\)\.resize/,
  'target supervision is cropped to the exact candidate-derived source bounds before resizing',
);
assert.match(
  script,
  /"opticalRoiMode"\s*:\s*args\.optical_roi_mode/,
  'training receipts preserve the requested optical ROI mode',
);
assert.match(
  script,
  /"opticalRois"\s*:\s*\[geometry\["roi"\]\s+for\s+geometry\s+in\s+geometries\]/,
  'reports preserve every frame crop and effective ROI authority instead of only the first frame',
);
assert.match(
  script,
  /"frameId"\s*:\s*frame\["id"\][\s\S]*"sameStateCaptureId"\s*:\s*frame\["sameStateCaptureId"\]/,
  'each ROI receipt remains attributable to its exact frozen simulator state',
);
assert.match(
  script,
  /"frameSizes"\s*:\s*\[\[geometry\["width"\],\s*geometry\["height"\]\]\s+for\s+geometry\s+in\s+geometries\]/,
  'render receipts preserve variable candidate-local frame dimensions instead of laundering the first frame as global',
);

console.log('boundary splat optical decoder contracts passed');
