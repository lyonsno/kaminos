import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../boundary-splat-radiance-mlx.py', import.meta.url), 'utf8').catch(() => '');

assert.match(script, /SCHEMA\s*=\s*["']kaminos\.boundary-splat-radiance-training\.v0/, 'radiance trainer declares a durable report schema');
assert.match(script, /kaminos-boundary-splat-supervision-corpus-v0/, 'radiance trainer accepts only the fixed-candidate supervision corpus');
assert.match(script, /live-simulator-frozen-state-candidate-raymarch-v0/, 'radiance trainer requires frozen-state live-simulator authority');
assert.match(script, /candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0/, 'radiance trainer accepts only the exact candidate-support-gated intrinsic unit-gain native raymarch target decomposition');
assert.match(script, /BOUNDARY_SPLAT_SUPERVISION_CANDIDATE_ORDER/, 'radiance trainer preserves the exact candidate layout');
assert.match(script, /candidateCount.*strideFloats|strideFloats.*candidateCount/s, 'radiance trainer verifies the complete uncapped candidate payload');
assert.match(script, /live-support-h64-v0\/model-artifact\.json/, 'radiance trainer warm-starts the proven live-support attribute head');
assert.match(script, /\.at\[[^\]]+\]\.add\(/s, 'radiance trainer uses differentiable additive splat accumulation');
assert.match(script, /viewProjection/, 'radiance trainer projects candidates with the captured camera');
assert.match(script, /cameraRight/, 'radiance trainer preserves the captured horizontal camera basis');
assert.match(script, /cameraUp/, 'radiance trainer preserves the captured vertical camera basis');
assert.match(script, /preview-initial\.png/, 'radiance trainer emits an inspectable warm-start preview');
assert.match(script, /preview-trained\.png/, 'radiance trainer emits an inspectable trained preview');
assert.match(script, /failurePhase/, 'radiance trainer writes phase-specific failures');
assert.match(script, /except\s+BaseException\s+as\s+error/, 'radiance trainer durably records interruption and cancellation before propagating them');
assert.match(script, /"errorType"\s*:\s*type\(error\)\.__name__/, 'interrupted reports preserve the exact terminating exception class');
assert.match(script, /compile-boundary-splat-attribute-model\.mjs/, 'radiance trainer compiles a browser-consumable artifact');
assert.match(
  script,
  /"requestedSteps"\s*:\s*args\.steps[\s\S]*"steps"\s*:\s*0\s+if\s+args\.probe_only\s+else\s+args\.steps/,
  'probe receipts distinguish requested optimization steps from zero effective steps',
);
assert.match(script, /--depth-bins/, 'radiance trainer exposes explicit depth-bin count');
assert.match(script, /mx\.exp\(-optical_depth\)/, 'depth-binned compositor converts accumulated opacity into bounded optical transmittance');
assert.match(script, /for\s+bin_index\s+in\s+reversed\(range\(depth_bins\)\)/, 'depth-binned compositor applies far-to-near alpha-over ordering');
assert.match(script, /depth-binned-alpha-over-v0/, 'training receipt identifies optical compositor authority');
assert.match(script, /fragment_local\s*=\s*geometry\["fragmentLocal"\]/, 'radiance trainer preserves per-fragment coordinates for differentiable footprint evaluation');
assert.match(script, /radius\s*=\s*attributes\[splat_indices,\s*4:6\]/, 'predicted anisotropic radius outputs participate in rendering');
assert.match(script, /radius2\s*=\s*mx\.sum\(mx\.square\(fragment_local\s*\/\s*radius\),\s*axis=1\)/, 'radiance trainer recomputes each Gaussian kernel from predicted radius');
assert.doesNotMatch(script, /"kernels"\s*:\s*mx\.array/, 'radiance trainer does not freeze warm-start Gaussian kernels outside the gradient path');
assert.match(script, /--edge-weight/, 'radiance trainer exposes target-gradient supervision strength');
assert.match(script, /prediction\[:,\s*1:,\s*:\]\s*-\s*prediction\[:,\s*:-1,\s*:\]/, 'radiance trainer differentiates horizontal image structure');
assert.match(script, /prediction\[1:,\s*:,\s*:\]\s*-\s*prediction\[:-1,\s*:,\s*:\]/, 'radiance trainer differentiates vertical image structure');
assert.match(script, /"initialPixelLoss"/, 'radiance receipts preserve pixel loss independently from the edge-aware objective');
assert.match(script, /"trainedEdgeLoss"/, 'radiance receipts report final target-gradient mismatch');
assert.match(script, /--candidate-table-oracle/, 'radiance trainer exposes a non-deployable per-candidate representational oracle');
assert.match(script, /class\s+CandidateAttributeTable\(nn\.Module\)/, 'candidate oracle owns independently trainable attributes per splat');
assert.match(script, /per-candidate-free-attribute-oracle-v0/, 'candidate oracle receipts distinguish diagnostic authority from deployable MLP authority');
assert.match(script, /candidate oracle requires exactly one corpus frame/, 'candidate oracle rejects ambiguous cross-frame candidate identity');
assert.match(script, /--context-mode/, 'radiance trainer exposes explicit spatial conditioning rather than silently changing the live feature contract');
assert.match(script, /choices=\["none", "world-xyz", "world-fourier", "world-grid-neighborhood"\]/, 'spatial conditioning distinguishes pointwise position from explicit local-grid neighborhood context');
assert.match(script, /--fourier-frequencies/, 'Fourier conditioning exposes its exact frequency ladder');
assert.match(script, /--hidden-size/, 'spatial trainer exposes an explicit hidden-width experiment control');
assert.match(script, /--spatial-mixing/, 'spatial trainer exposes an explicit learned mixing family instead of conflating it with handcrafted context');
assert.match(script, /--freeze-base/, 'message ablations can prevent the pointwise path from absorbing the spatial gradient');
assert.match(script, /"basePathFrozen"/, 'training receipts preserve whether only the message path was trainable');
assert.match(script, /six-neighbor-hidden-residual/, 'learned spatial mixing has a stable model-family identity');
assert.match(script, /zero-delta-active-six-neighbor-hidden-residual-v0/, 'learned mixing starts as an exact no-op while retaining trainable internal features');
assert.match(script, /mx\.sin\(positions[^\n]+frequency[^\n]+2\.0[^\n]+np\.pi\)/, 'Fourier conditioning includes signed sine phase channels');
assert.match(script, /mx\.cos\(positions[^\n]+frequency[^\n]+2\.0[^\n]+np\.pi\)/, 'Fourier conditioning includes cosine phase channels');
assert.match(script, /expanded_weight\[:,\s*:base_input_size\]\s*=\s*np\.asarray\(base_model\.hidden\.weight\)/, 'spatial model preserves every proven input weight exactly across successive context expansions');
assert.match(script, /expanded_weight\[:,\s*base_input_size:\]\s*=\s*0\.0/, 'new spatial channels begin as an exact zero-delta extension of the warm head');
assert.match(script, /shared-position-conditioned-feature-mlp-v0/, 'spatial receipts distinguish the experimental model authority');
assert.match(script, /shared-local-grid-conditioned-feature-mlp-v0/, 'local-grid receipts distinguish neighborhood-conditioned authority from position-only authority');
assert.match(script, /"deployable":\s*False/, 'spatial artifacts cannot masquerade as browser-deployable models');
assert.match(script, /"contextMode"/, 'training receipts preserve the effective context mode');
assert.match(
  script,
  /artifact\.get\("schema"\)\s*==\s*SPATIAL_MODEL_SCHEMA/,
  'radiance trainer accepts its own experimental spatial artifact as an explicit continuation checkpoint',
);
assert.match(
  script,
  /warm start context mode[^\n]+does not match requested context mode/,
  'spatial continuation rejects context-mode drift instead of silently changing the model input contract',
);
assert.match(
  script,
  /warm start Fourier frequencies[^\n]+do not match requested Fourier frequencies/,
  'spatial continuation rejects Fourier-ladder drift instead of loading semantically incompatible weights',
);
assert.match(
  script,
  /initial_attributes\s*=\s*\[[\s\S]*encode_candidate_inputs\([\s\S]*warm_context_mode[\s\S]*warm_frequencies/,
  'radius preservation and continuation receipts derive their initial attributes from the actual resumed spatial model inputs',
);
assert.match(
  script,
  /"continuation"\s*:\s*schema\s*in\s*\(SPATIAL_MODEL_SCHEMA,\s*GRID_MESSAGE_MODEL_SCHEMA\)/,
  'training receipts say explicitly when optimization continued from either experimental spatial checkpoint family',
);
assert.match(script, /world-grid-neighborhood/, 'radiance trainer exposes local-grid optical context as a distinct experimental family');
assert.match(script, /neighbor\.occupancy\.x-/, 'local-grid context records missing and present six-neighbor support explicitly');
assert.match(script, /zero-delta-local-grid-context-expansion-v0/, 'local-grid context starts as an exact zero-delta extension of the proven Fourier head');
assert.match(script, /zero-delta-active-hidden-width-expansion-v0/, 'wider spatial heads begin as exact zero-output-delta extensions with active new hidden features');
assert.match(script, /args\.context_mode in \("world-fourier", "world-grid-neighborhood"\)/, 'local-grid receipts preserve the Fourier frequency contract used by their encoder');

console.log('boundary splat radiance training contracts passed');
