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
  /class TeacherUNetLinearRenderer\(nn\.Module\)/,
  'offline learnability probe exposes a zero-initialized linear RGB correction head without sigmoid saturation',
);
assert.match(
  trainer,
  /class TeacherUNetAbsoluteRenderer\(nn\.Module\)/,
  'offline ceiling probe can predict absolute RGB through a normally initialized output head',
);
assert.match(
  trainer,
  /teacher-unet-linear-direct/,
  'trainer CLI and model factory expose the linear direct-rendering architecture by stable identity',
);
assert.match(
  trainer,
  /teacher-unet-absolute-rgb/,
  'trainer CLI and model factory expose the absolute RGB architecture by stable identity',
);
assert.match(
  trainer,
  /--train-crop-mode[\s\S]*choices=\["sampled", "fixed-material", "fixed-target-fire"\]/,
  'trainer exposes an explicit deterministic fixed-material crop mode for honest one-pair memorization probes',
);
assert.match(
  trainer,
  /def fixed_material_crop_origin\(/,
  'fixed-material crop identity is calculated by a dedicated deterministic helper',
);
assert.match(
  trainer,
  /def fixed_target_fire_crop_origin\(/,
  'offline ceiling probe can select a labeled target-derived bright-flame crop without feeding target pixels to the model',
);
assert.match(
  trainer,
  /previewMode\s*==\s*"fixed-material"[\s\S]*fixed_material_crop_origin/,
  'preview witness can render the exact deterministic material crop used for memorization training',
);
assert.match(
  trainer,
  /previewMode\s*==\s*"fixed-target-fire"[\s\S]*fixed_target_fire_crop_origin/,
  'preview witness can render the exact target-derived fire crop used by the offline ceiling assay',
);
assert.match(
  trainer,
  /trainCropMode=args\.trainCropMode/,
  'training sampler receives the requested crop mode instead of silently retaining random crop movement',
);
assert.match(
  trainer,
  /evaluationCropMode=args\.trainCropMode/,
  'evaluation samples use the same crop identity as a fixed-crop training assay',
);
assert.match(
  trainer,
  /"gradientL2":\s*gradient_l2/,
  'training checkpoints report gradient magnitude so a disconnected optimization path cannot masquerade as model incapacity',
);
assert.match(
  trainer,
  /"predictionCorrectionAbsMax":\s*correction_abs_max/,
  'training checkpoints report produced correction magnitude so identity collapse is directly observable',
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
  /previous-rgb-feature-sidecar-rgba/,
  'offline renderer can condition on truthful previous low RGB plus current material and sidecar channels',
);
assert.match(
  trainer,
  /def attach_previous_low_rgb_features\(/,
  'temporal input attachment is explicit and sequence-index aware',
);
assert.match(
  trainer,
  /previous-low-rgb-plus-boundary-sidecar-plus-shader-material-v0/,
  'reports name previous-low temporal conditioning authority explicitly',
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
  trainer,
  /args\.featureInputMode\s+not in\s+\{"feature-rgba",\s*"feature-sidecar-rgba"\}/,
  'material-focus supervision remains available when sidecar channels are appended after shader-material channels',
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
assert.match(
  runner,
  /MODEL_ARCHITECTURES\s*=\s*\[[^\]]*"teacher-unet-linear-direct"[^\]]*\]/,
  'Greenroom runner accepts the linear direct-rendering architecture identity before forwarding it',
);
assert.match(
  runner,
  /MODEL_ARCHITECTURES\s*=\s*\[[^\]]*"teacher-unet-absolute-rgb"[^\]]*\]/,
  'Greenroom runner accepts the absolute RGB architecture identity before forwarding it',
);
assert.match(
  runner,
  /--train-crop-mode/,
  'Greenroom runner forwards deterministic training crop identity to the trainer',
);

console.log('neural renderer contracts passed');
