// kaminos-test: node
import assert from 'node:assert/strict';
import {createTrellisImageGenerationAdapter} from '../models/trellis2/trellis-generation.js';
import {route,pixelValues,prefixWeights,dinoLayerWeights} from '../models/trellis2/tests/dinov3-serving-contracts.mjs';
import {models} from '../models/trellis2/tests/generation-composition-contracts.mjs';
assert.throws(()=>createTrellisImageGenerationAdapter({route,pixelValues,prefixWeights,
  loadLayerWeights:async()=>dinoLayerWeights,models,pipelineType:'1024_cascade'}),
  /1024.*pixel|highResolutionPixelValues/,
  'Cascade must reject missing 1024 image input before executing any model, rather than reuse 512 conditioning.');
console.log('Cascade rejects missing high-resolution pixels before GPU work.');

await import('../models/trellis2/tests/image-generation-contracts.mjs');
await import('../models/trellis2/tests/generation-streamed-composition-contracts.mjs');
await import('../models/trellis2/tests/generation-checkpoint-loading-contracts.mjs');
await import('../models/trellis2/tests/generation-result-contracts.mjs');
await import('../models/trellis2/tests/generation-input-contracts.mjs');
await import('../models/trellis2/tests/generation-checkpoint-staging-contracts.mjs');
await import('../models/trellis2/tests/generation-fields-only-contracts.mjs');
