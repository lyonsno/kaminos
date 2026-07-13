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
  /"opticalInputAuthority"\s*:\s*OPTICAL_INPUT_AUTHORITY/,
  'training receipts preserve the exact optical input authority',
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

console.log('boundary splat optical decoder contracts passed');
