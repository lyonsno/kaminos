#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const runtime = readFileSync(resolve(root, 'native-low-selective-live-runtime.mjs'), 'utf8');
const core = readFileSync(resolve(root, 'volume-core.js'), 'utf8');
const activityTrainerPath = resolve(root, 'volume-exact-basin-activity-head.py');
const activityModelPath = resolve(root, 'models/selective-head-live/exact-basin-160-to-96-activity-v0/manifest.json');
const routePath = resolve(root, 'volume-native64-causal-cue-feedback.html');
const innerRoutePath = resolve(root, 'volume-native-low-selective-live.html');
const witnessPath = resolve(root, 'volume-native64-causal-cue-feedback-witness.mjs');

assert.ok(existsSync(routePath), 'native64 causal cue feedback operator route exists');
assert.ok(existsSync(witnessPath), 'native64 causal cue feedback witness exists');
assert.ok(existsSync(activityTrainerPath), 'phase-aligned flow-activity head trainer exists');
assert.ok(existsSync(activityModelPath), 'browser flow-activity head package exists');

const route = readFileSync(routePath, 'utf8');
const innerRoute = readFileSync(innerRoutePath, 'utf8');
const witness = readFileSync(witnessPath, 'utf8');
const activityTrainer = readFileSync(activityTrainerPath, 'utf8');
const activityModel = JSON.parse(readFileSync(activityModelPath, 'utf8'));
const combined = `${runtime}\n${core}\n${route}\n${witness}\n${activityTrainer}`;
const causalRoutes = `${route}\n${innerRoute}`;

assert.equal(activityModel.schema, 'kaminos.volume.exact-basin-activity-head.v0');
assert.equal(activityModel.identity, 'exact-basin-derived-flow-activity-head-160-to-96-v0');
assert.equal(activityModel.status, 'captured');
assert.equal(activityModel.failurePhase, null);
assert.equal(activityModel.target.identity, 'derived-flow-debug-rgb-norm-activity-v0');
assert.equal(activityModel.source.trainingInputAuthority, 'phase-aligned-high-filtered-to-low-grid-v0');
assert.equal(activityModel.source.nativeDeploymentInputSeenDuringTraining, false);
assert.match(activityModel.packed.sha256, /^[a-f0-9]{64}$/);
assert.match(activityTrainer, /curlMagnitude[\s\S]*divergenceAbs[\s\S]*diagnosticRgbNorm/, 'activity target derives from velocity curl and divergence rather than material carriers');

assert.match(runtime, /NATIVE_LOW_PREDICTED_ACTIVITY_CUE_PROJECTION\s*=\s*'native-low-predicted-front-carrier-activity-max-projection-v0'/, 'runtime names the learned cue projection');
assert.match(runtime, /predictedActivityCueProjectionWgsl/, 'runtime defines a dedicated predicted activity projection kernel');
assert.match(runtime, /predictedFluid[\s\S]*predictedFront[\s\S]*targetActivityCue/, 'cue projection consumes predicted carriers and front and writes the receiver cue');
assert.match(runtime, /for \(var highZ[\s\S]*for \(var highY[\s\S]*for \(var highX/, 'cue projection max-pools the full high-cell footprint instead of one nearest sample');
assert.match(runtime, /proceduralReceiverActivityCue/, 'learned cue projection mirrors the receiver activity semantics');
assert.match(runtime, /encodePredictedActivityCue/, 'shared-device runtime exposes direct GPU cue projection');
assert.match(runtime, /samplePredictedActivityCueStats[\s\S]*diagnosticCpuReadback:\s*true/, 'runtime can diagnose learned cue strength without pretending the readback is a production path');
assert.match(runtime, /NATIVE_LOW_LEARNED_FLOW_ACTIVITY_CUE_PROJECTION\s*=\s*'native-low-learned-flow-activity-head-projection-v0'/, 'runtime names the learned flow-activity projection');
assert.match(runtime, /encodeLearnedFlowActivityCue/, 'shared-device runtime exposes the learned flow-activity projection');
assert.match(runtime, /activityModel[\s\S]*inferActivityHead[\s\S]*targetActivityCue/, 'projection infers activity from current native features and writes the receiver cue');
assert.match(runtime, /runtimeTruthAvailable:\s*false[\s\S]*nativeDeploymentInputSeenDuringTraining:\s*false/, 'activity projection reports product-like runtime truth and native-training limits');

assert.match(core, /NATIVE64_LEARNED_CUE_AUTHORITY\s*=\s*'learned-96-trained-derived-flow-activity-head-v0'/, 'core binds the causal role to the derived flow-activity head rather than the carrier proxy');
assert.match(core, /learnedCueFeedbackEnabled/, 'native-low capture has an explicit learned feedback opt-in');
assert.match(core, /generatedForNextSimulationStep/, 'feedback receipt states that inference generated the next-step cue');
assert.match(core, /appliedCueFrameId[\s\S]*generatedCueFrameId/, 'feedback receipt distinguishes the cue applied this step from the cue generated after it');
assert.match(core, /simulationSteppingReceipt[\s\S]*deterministicNowMs/, 'native source-step receipt preserves the deterministic simulation clock used by the causal assay');
assert.match(core, /appliedCueReceiver[\s\S]*learnedCueDiagnosticStats/, 'causal receipt preserves effective receiver controls and first-cue health diagnostics');
assert.match(core, /learnedFlowActivityModelIdentity[\s\S]*learnedFlowActivityModelSha256/, 'causal receipt preserves exact learned activity model identity and checksum');
assert.match(core, /runtimeTruthAvailable:\s*false/, 'learned feedback receipt forbids runtime truth');
assert.match(core, /NATIVE_LOW_TRANSFER_160_TO_96_DEPLOYMENT_GRID_ROUTE/, 'causal feedback binds the operator-selected 96-trained package route');

assert.match(route, /const CAUSAL_ROLES = Object\.freeze\(\['control', 'self', 'learnedContinuous', 'learnedRelease'\]\)/, 'operator route exposes the four causal discriminant roles');
assert.match(route, /manual_source_grid[\s\S]*64/, 'operator route fixes the causal assay to genuine native64 source state');
assert.match(route, /warmup_steps[\s\S]*release_steps/, 'release role exposes explicit warm-up and release phase boundaries');
assert.match(route, /causal-initial-state-reset-96-to-64-v0[\s\S]*resolution:\s*96[\s\S]*resolution:\s*64[\s\S]*resetSimStepCount[\s\S]*0/, 'every causal role rebuilds to the same native64 step-zero state after acquiring pause custody');
assert.match(route, /causal-deterministic-step-clock-v0[\s\S]*1000\s*\/\s*30/, 'every role drives simulation phase from the same 30 Hz step clock instead of inference wall time');
assert.match(causalRoutes, /causalPreRollSteps[\s\S]*96[\s\S]*causal-unforced-deterministic-preroll-v0/, 'every role receives the same unforced 96-step pre-roll matching the activity model training phase');
assert.match(causalRoutes, /preRollStep[\s\S]*learnedCueFeedbackEnabled:\s*false/, 'pre-roll cannot generate learned feedback');
assert.match(causalRoutes, /causal-unforced-deterministic-preroll-v0[\s\S]*oracleActivityCue:\s*0[\s\S]*oracleActivityCurlNoise:\s*0[\s\S]*oracleActivityVorticity:\s*0/, 'pre-roll cannot apply learned or procedural forcing');
assert.match(route, /forcingPhase[\s\S]*warmup[\s\S]*release/, 'route records effective forcing phase');
assert.match(route, /oracleActivityCurlNoise[\s\S]*oracleActivityVorticity/, 'route preserves independent curl-noise and vorticity gains');
assert.match(route, /causalNativeSourceObjectUrl/, 'operator route displays the causally evolved native source rather than substituting the model-rendered treatment');
assert.match(route, /runtimeTruthAvailable[\s\S]*false[\s\S]*syntheticDownsampleApplied[\s\S]*false/, 'product-like causal roles forbid truth and synthetic source downsampling');

assert.match(witness, /control[\s\S]*self[\s\S]*learnedContinuous[\s\S]*learnedRelease/, 'witness captures all causal roles');
assert.match(witness, /consecutive-native64-simulation-steps-v0/, 'witness requires continuous native64 simulation steps');
assert.match(witness, /assert\.equal\(frame\.sourceStepDelta, 1/, 'witness rejects skipped or repeated simulation steps');
assert.match(witness, /deterministicNowMs[\s\S]*deterministicClockAuthority/, 'witness preserves and validates deterministic simulation phase time');
assert.match(witness, /preRollSteps[\s\S]*firstCapturedSimulationStep/, 'witness proves capture begins after the declared matched-phase pre-roll');
assert.match(witness, /appliedCueFrameId[\s\S]*generatedCueFrameId[\s\S]*forcingPhase/, 'witness preserves feedback timing and forcing phase per frame');
assert.match(witness, /learnedFlowActivityModelIdentity[\s\S]*learnedFlowActivityModelSha256[\s\S]*exact-basin-derived-flow-activity-head-160-to-96-v0/, 'witness rejects missing or substituted learned flow-activity model identity');
assert.match(witness, /requestedBackend[\s\S]*effectiveBackend[\s\S]*requestedRoute[\s\S]*effectiveRoute/, 'witness preserves backend and route identities');
assert.match(witness, /blankFrameRejection[\s\S]*cachedFrameRejection/, 'witness rejects blank and cached output');
assert.match(witness, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'witness writes durable failure phase and last trustworthy evidence');
assert.match(combined, /baa54236f04c28eab278cf60e4a60745cd3c0160a985a9adbb1e06db7958f6e8/, 'causal route binds the exact 96-trained package checksum');

console.log('native64 causal cue feedback contracts passed');
