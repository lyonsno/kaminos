import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../boundary-splat-radiance-mlx.py', import.meta.url), 'utf8').catch(() => '');

assert.match(script, /SCHEMA\s*=\s*["']kaminos\.boundary-splat-radiance-training\.v0/, 'radiance trainer declares a durable report schema');
assert.match(script, /kaminos-boundary-splat-supervision-corpus-v0/, 'radiance trainer accepts only the fixed-candidate supervision corpus');
assert.match(script, /live-simulator-frozen-state-candidate-raymarch-v0/, 'radiance trainer requires frozen-state live-simulator authority');
assert.match(script, /candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0/, 'radiance trainer accepts only the exact candidate-support-gated intrinsic unit-gain native raymarch target decomposition');
assert.match(script, /--expected-ray-steps/, 'radiance trainer exposes exact teacher ray-step admission');
assert.match(script, /--expected-render-scale/, 'radiance trainer exposes exact teacher render-scale admission');
assert.match(script, /target\.get\("requestedRaySteps"\)\s*!=\s*expected_ray_steps[\s\S]*target\.get\("effectiveRaySteps"\)\s*!=\s*expected_ray_steps/, 'radiance trainer rejects requested or effective teacher step substitution');
assert.match(script, /abs\(float\(target\.get\("renderScale"[^\n]*\)\s*-\s*expected_render_scale\)\s*>\s*0\.001/, 'radiance trainer rejects non-native teacher render scale');
assert.match(script, /from boundary_splat_native_sidecar import/, 'radiance trainer imports the dependency-free native sidecar context adapter');
assert.match(script, /native-sidecar-pyramid/, 'radiance trainer exposes native raw sidecar pyramid conditioning');
assert.match(script, /complete-native-sidecar-multi-radius-axial-context-v0/, 'native sidecar training receipts distinguish complete-grid context from candidate-only adjacency');
assert.match(script, /structuralSupervision/, 'native sidecar conditioning is loaded from verified structural supervision artifacts');
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
assert.match(
  script,
  /initial_evidence\s*=\s*\{[\s\S]*"initialPreview"[\s\S]*"targetPreview"[\s\S]*"evaluationFrames"[\s\S]*write_running_report\(report_path,\s*report,\s*phase,\s*initial_evidence\)/,
  'radiance trainer durably records completed initial previews and held-out metrics before compiling the first training objective',
);
assert.match(
  script,
  /def\s+write_running_report\([^)]*\):[\s\S]*?report\.update\(\{[\s\S]*?"lastTrustworthyEvidence"[\s\S]*?write_json\(path,\s*report\)/,
  'running evidence mutates the canonical report object so handled failures cannot overwrite it with an evidence-free snapshot',
);
assert.match(
  script,
  /initial_evidence\s*=\s*\{[\s\S]*"frameSplitAuthority"[\s\S]*"trainFrameIds"[\s\S]*"evaluationFrameIds"[\s\S]*"evaluationLossAuthority"/,
  'precompile evidence proves the exact train/evaluation custody behind its held-out metrics',
);
assert.match(
  script,
  /phase\s*=\s*"initial-training-loss"[\s\S]*?write_running_report\(report_path,\s*report,\s*phase,\s*initial_evidence\)[\s\S]*?initial_training_loss_value\s*=\s*loss_fn\(trainable_model\)[\s\S]*?nn\.value_and_grad/,
  'radiance trainer writes trustworthy initial evidence before compiling either the first objective or its gradients',
);
assert.match(
  script,
  /training_losses\s*=\s*\[\{"step":\s*0,[^\]]+\}\][\s\S]*?write_running_report\(report_path,\s*report,\s*phase,\s*\{[\s\S]*?"trainingLossTrace":\s*training_losses[\s\S]*?\}\)[\s\S]*?nn\.value_and_grad/,
  'radiance trainer serializes the compiled step-zero loss before gradient compilation can stall or be killed',
);
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
assert.match(script, /--train-frame-indices/, 'radiance trainer exposes explicit training-frame custody');
assert.match(script, /--eval-frame-indices/, 'radiance trainer exposes explicit evaluation-frame custody');
assert.match(script, /explicit-disjoint-frame-holdout-v0/, 'radiance receipts distinguish honest temporal holdout from train-frame evaluation');
assert.match(script, /explicit-single-frame-memorization-oracle-v0/, 'radiance receipts distinguish a same-frame capacity oracle from honest temporal holdout');
assert.match(script, /same-frame-memorization-oracle-v0/, 'radiance receipts label same-frame oracle loss without counterfeit generalization language');
assert.match(script, /"trainFrameIds"/, 'training receipts preserve the exact optimized frame identities');
assert.match(script, /"evaluationFrameIds"/, 'training receipts preserve the exact held-out frame identities');
assert.match(script, /"evaluationFrames"/, 'radiance receipts preserve per-frame held-out optical metrics and previews');
assert.match(script, /"trainingLossTrace"\s*:\s*training_losses/, 'optimization traces contain only the selected training-frame objective');
assert.match(script, /"explicit-disjoint-frame-holdout-v0"\s*:\s*"held-out-frame-mean-v0"/, 'explicit holdout receipts label evaluation loss separately from the optimizer trace');
assert.match(script, /"evaluationLossAuthority"\s*:\s*evaluation_loss_authority\(frame_split\)/, 'all training receipts derive evaluation language from the effective frame-split authority');
assert.match(script, /--optical-condition-mode/, 'optical decoder exposes explicit global conditioning rather than inferring emitter regime accidentally');
assert.match(script, /EMITTER_LIFECYCLE_CONDITION_IDENTITY/, 'mixed-width conditioning requires exact effective emitter and lifecycle custody');
assert.match(script, /EMITTER_LIFECYCLE_CONDITION_ORDER/, 'model receipts preserve the emitter and lifecycle condition order');
assert.match(script, /EMITTER_LIFECYCLE_CONDITION_AUTHORITY/, 'conditioning authority is tied to effective controls on the frozen simulator state');
assert.doesNotMatch(
  script,
  /partial flow-debug witness requires an image-bearing optical or sparse-grid decoder/,
  'display-only partial flow-debug witnessing is not restricted to specific decoder architectures',
);
assert.match(
  script,
  /args\.partial_flow_debug_gain\s*!=\s*0\.0\s+and\s+frame_split\["authority"\]\s*!=\s*"explicit-disjoint-frame-holdout-v0"/,
  'partial flow-debug witnessing always requires explicit disjoint held-out frame custody',
);
assert.match(script, /--candidate-table-oracle/, 'radiance trainer exposes a non-deployable per-candidate representational oracle');
assert.match(script, /class\s+CandidateAttributeTable\(nn\.Module\)/, 'candidate oracle owns independently trainable attributes per splat');
assert.match(script, /per-candidate-free-attribute-oracle-v0/, 'candidate oracle receipts distinguish diagnostic authority from deployable MLP authority');
assert.match(script, /candidate oracle requires exactly one corpus frame/, 'candidate oracle rejects ambiguous cross-frame candidate identity');
assert.match(script, /--context-mode/, 'radiance trainer exposes explicit spatial conditioning rather than silently changing the live feature contract');
assert.match(script, /choices=\["none", "world-xyz", "world-fourier", "world-grid-neighborhood", "world-grid-pyramid", "native-sidecar-pyramid"\]/, 'spatial conditioning distinguishes pointwise position, candidate-grid, and complete native-sidecar context');
assert.match(script, /--fourier-frequencies/, 'Fourier conditioning exposes its exact frequency ladder');
assert.match(script, /--hidden-size/, 'spatial trainer exposes an explicit hidden-width experiment control');
assert.match(script, /--spatial-mixing/, 'spatial trainer exposes an explicit learned mixing family instead of conflating it with handcrafted context');
assert.match(script, /--freeze-base/, 'message ablations can prevent the pointwise path from absorbing the spatial gradient');
assert.match(script, /"basePathFrozen"/, 'training receipts preserve whether only the message path was trainable');
assert.match(script, /six-neighbor-hidden-residual/, 'learned spatial mixing has a stable model-family identity');
assert.match(script, /sparse-grid-residual/, 'pre-raster structural decoding is a distinct learned spatial family');
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
assert.match(script, /grid_neighborhood_feature_names\("neighbor"\)/, 'local-grid context records missing and present six-neighbor support explicitly');
assert.match(script, /GRID_PYRAMID_RADII\s*=\s*\(1,\s*2,\s*4,\s*8\)/, 'multiscale grid context records explicit radius-one through radius-eight support');
assert.match(script, /multi-radius-axial-grid-context-v0/, 'multiscale grid receipts identify their wider receptive-field authority');
assert.match(script, /zero-delta-local-grid-context-expansion-v0/, 'local-grid context starts as an exact zero-delta extension of the proven Fourier head');
assert.match(script, /zero-delta-active-hidden-width-expansion-v0/, 'wider spatial heads begin as exact zero-output-delta extensions with active new hidden features');
assert.match(script, /args\.context_mode in \("world-fourier", "world-grid-neighborhood", "world-grid-pyramid", "native-sidecar-pyramid"\)/, 'grid-context receipts preserve the Fourier frequency contract used by their encoder');

console.log('boundary splat radiance training contracts passed');
