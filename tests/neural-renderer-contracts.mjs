import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const trainer = readFileSync(new URL('../volume-residual-upscale-mlx.py', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../volume-residual-greenroom-runner.py', import.meta.url), 'utf8');

assert.match(
  trainer,
  /class TeacherUNetDirectRenderer\(nn\.Module\)/,
  'offline ceiling probe exposes a direct-rendering teacher U-Net instead of forcing every model through a bounded residual head',
);
assert.match(
  trainer,
  /teacher-unet-direct/,
  'trainer CLI and model factory expose the direct-rendering architecture by stable identity',
);
assert.match(
  trainer,
  /def apply_direct_rgb_logits\(/,
  'direct renderer uses an identity-anchored unconstrained RGB-logit output path',
);
assert.match(
  trainer,
  /mx\.log\(clipped_base\s*\/\s*\(1\.0\s*-\s*clipped_base\)\)/,
  'direct renderer starts from the low image in logit space rather than a gray or random frame',
);
assert.match(
  trainer,
  /sidecar-rgba/,
  'trainer exposes baked boundary-sidecar support as explicit model input',
);
assert.match(
  trainer,
  /feature-sidecar-rgba/,
  'trainer can concatenate shader-material features and baked sidecar support for structural rendering',
);
assert.match(
  trainer,
  /np\.concatenate\(\[material_feature_image, sidecar_support_image\], axis=2\)/,
  'combined structural mode preserves both material and sidecar channels instead of substituting one for the other',
);
assert.match(
  trainer,
  /boundary-sidecar-support-plus-shader-material-feature-v0/,
  'reports name the combined structural input authority explicitly',
);
assert.match(
  runner,
  /--feature-input-mode/,
  'Greenroom runner forwards structural input mode to the trainer',
);
assert.match(
  runner,
  /MODEL_ARCHITECTURES\s*=\s*\[[^\]]*"teacher-unet-direct"[^\]]*\]/,
  'Greenroom runner accepts the direct-rendering architecture identity before forwarding it',
);

console.log('neural renderer contracts passed');
