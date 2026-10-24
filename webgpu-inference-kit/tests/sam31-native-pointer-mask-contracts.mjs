// kaminos-test: node
import assert from 'node:assert/strict';
import * as pointer from '../src/sam31-interactive-pointer-phase-program.js';
const shape = { batch: 16, queryTokens: 8, sparsePromptTokens: 2, channels: 256, heads: 8,
  attentionChannels: 128, mlpHidden: 2048, layerCount: 2, imageHeight: 2, imageWidth: 2, imageTokens: 4,
  sourceImageHeight: 28, sourceImageWidth: 28, sourceMaskHeight: 28, sourceMaskWidth: 28,
  promptMaskHeight: 8, promptMaskWidth: 8, decoderMaskHeight: 8, decoderMaskWidth: 8 };
const geometry = pointer.deriveSam31InteractivePointerGeometry(shape);
assert.equal(geometry.maskDownsampleHeight, 7);
assert.equal(geometry.maskDownsampleWidth, 7);
assert.equal(geometry.maskDownsampleLength, 16 * 7 * 7);
assert.equal(geometry.promptMaskLength, 16 * 8 * 8);
const weights = {
  'mask-downsample.weight': new Float32Array(16).fill(1 / 16), 'mask-downsample.bias': new Float32Array(1),
  'prompt.mask_downscaling.0.weight': new Float32Array(16), 'prompt.mask_downscaling.0.bias': new Float32Array(4),
  'prompt.mask_downscaling.1.weight': new Float32Array(4).fill(1), 'prompt.mask_downscaling.1.bias': new Float32Array(4),
  'prompt.mask_downscaling.3.weight': new Float32Array(256), 'prompt.mask_downscaling.3.bias': new Float32Array(16),
  'prompt.mask_downscaling.4.weight': new Float32Array(16).fill(1), 'prompt.mask_downscaling.4.bias': new Float32Array(16),
  'prompt.mask_downscaling.6.weight': new Float32Array(4096), 'prompt.mask_downscaling.6.bias': new Float32Array(256),
  'prompt.not_a_point_embed.weight': new Float32Array(256),
};
const mask = Float32Array.from({ length: 16 * 28 * 28 }, (_, i) => Math.floor(i % 28 / 4));
const result = pointer.encodeSam31InteractiveMaskPromptForTest(mask, weights, geometry);
assert.deepEqual(Array.from(result.maskDownsample.slice(0, 7)), [0, 1, 2, 3, 4, 5, 6]);
assert.deepEqual(Array.from(result.promptMasks.slice(0, 8)), [0, 0.8125, 1.6875, 2.5625, 3.4375, 4.3125, 5.1875, 6]);
assert.equal(result.denseEmbeddings.length, 16 * 256 * 4);
const legacy = pointer.deriveSam31InteractivePointerGeometry({ ...shape, sourceMaskHeight: 32, sourceMaskWidth: 32 });
assert.equal(legacy.maskDownsampleLength, legacy.promptMaskLength, 'fixture geometry remains a no-resize path');
assert.throws(() => pointer.deriveSam31InteractivePointerGeometry({ ...shape, sourceMaskWidth: 34 }), /source mask/);
console.log('SAM3.1 native seed-mask geometry and prompt resize contracts passed (CPU)');
