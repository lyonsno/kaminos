import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildGeneratedPoseTemporalCliplets } from '../motion-core.js';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function poseSample(frame, phaseLabel, rootZ, compression = 0.1) {
  return {
    frame,
    sourceFrame: frame,
    time: Number((frame / 30).toFixed(5)),
    phaseLabel,
    root: [0, 0, rootZ],
    head: [0, 1.5 - compression * 0.1, rootZ + 0.08],
    chest: [0, 1.1 - compression * 0.06, rootZ + 0.03],
    leftHand: [-0.24, 1.0, rootZ + 0.02],
    rightHand: [0.24, 1.0, rootZ + 0.02],
    leftFoot: [-0.16, 0.05, rootZ - 0.03],
    rightFoot: [0.16, 0.05, rootZ - 0.03],
    headRoot: [0, 1.5 - compression * 0.1, 0.08],
    chestRoot: [0, 1.1 - compression * 0.06, 0.03],
    handSpan: 0.48,
    stanceWidth: 0.32,
    bboxVolume: 1.1 + compression,
    bowCompression: compression,
  };
}

const startleSamples = [
  poseSample(0, 'enter', 0.00, 0.08),
  poseSample(1, 'enter', 0.06, 0.08),
  poseSample(2, 'notice', 0.09, 0.18),
  poseSample(3, 'notice', 0.10, 0.24),
  poseSample(4, 'brake', 0.09, 0.86),
  poseSample(5, 'brake', 0.07, 0.82),
  poseSample(6, 'escape', -0.10, 0.42),
  poseSample(7, 'escape', -0.30, 0.30),
  poseSample(8, 'escape', -0.48, 0.20),
  poseSample(9, 'settle', -0.50, 0.13),
  poseSample(10, 'settle', -0.50, 0.11),
];

const impactSamples = [
  poseSample(0, 'enter', 0.00, 0.08),
  poseSample(1, 'commit', 0.10, 0.12),
  poseSample(2, 'commit', 0.24, 0.16),
  poseSample(3, 'brake', 0.27, 0.82),
  poseSample(4, 'commit', 0.34, 0.24),
  poseSample(5, 'brake', 0.35, 0.86),
  poseSample(6, 'settle', 0.36, 0.18),
  poseSample(7, 'recover', 0.35, 0.14),
  poseSample(8, 'settle', 0.35, 0.12),
];

const shockTrainSamples = [
  poseSample(0, 'enter', 0.00, 0.08),
  poseSample(1, 'commit', 0.10, 0.12),
  poseSample(2, 'commit', 0.22, 0.14),
  poseSample(3, 'notice', 0.23, 0.20),
  poseSample(4, 'brake', 0.22, 0.82),
  poseSample(5, 'notice', 0.23, 0.24),
  poseSample(6, 'brake', 0.21, 0.86),
  poseSample(7, 'notice', 0.22, 0.22),
  poseSample(8, 'brake', 0.20, 0.78),
  poseSample(9, 'brake', 0.18, 0.72),
];

const bridgeStartleSamples = [
  poseSample(0, 'enter', 0.00, 0.08),
  poseSample(1, 'commit', 0.12, 0.12),
  poseSample(2, 'notice', 0.14, 0.22),
  poseSample(3, 'notice', 0.15, 0.24),
  poseSample(4, 'commit', 0.18, 0.20),
  poseSample(5, 'commit', 0.22, 0.22),
  poseSample(6, 'brake', 0.21, 0.84),
  poseSample(7, 'brake', 0.20, 0.80),
];

const startleCliplets = buildGeneratedPoseTemporalCliplets({
  schema: 'kaminos.generated-pose-temporal.v0',
  id: 'synthetic_startle_recoil_source',
  label: 'Synthetic Startle Recoil Source',
  intent: 'a man notices something, startles backwards, and recovers',
  sourceKind: 'motion-panel-generated-pose-temporal',
  sourceStatus: 'test-fixture',
  sourceModel: 'contract-synthetic',
  sourceRoute: 'tests/generated-motion-smart-phrase-contracts.mjs:startle',
  sourceFrameStride: 1,
  rawFrameCount: startleSamples.length,
  fps: 30,
  duration: startleSamples.at(-1).time,
  temporalSamples: startleSamples,
});

const impactCliplets = buildGeneratedPoseTemporalCliplets({
  schema: 'kaminos.generated-pose-temporal.v0',
  id: 'synthetic_approach_impact_source',
  label: 'Synthetic Approach Impact Source',
  intent: 'a man approaches, hits resistance, compresses, and settles',
  sourceKind: 'motion-panel-generated-pose-temporal',
  sourceStatus: 'test-fixture',
  sourceModel: 'contract-synthetic',
  sourceRoute: 'tests/generated-motion-smart-phrase-contracts.mjs:impact',
  sourceFrameStride: 1,
  rawFrameCount: impactSamples.length,
  fps: 30,
  duration: impactSamples.at(-1).time,
  temporalSamples: impactSamples,
});

const shockTrainCliplets = buildGeneratedPoseTemporalCliplets({
  schema: 'kaminos.generated-pose-temporal.v0',
  id: 'synthetic_shock_train_source',
  label: 'Synthetic Shock Train Source',
  intent: 'a man startles repeatedly without a clean escape label',
  sourceKind: 'motion-panel-generated-pose-temporal',
  sourceStatus: 'test-fixture',
  sourceModel: 'contract-synthetic',
  sourceRoute: 'tests/generated-motion-smart-phrase-contracts.mjs:shock-train',
  sourceFrameStride: 1,
  rawFrameCount: shockTrainSamples.length,
  fps: 30,
  duration: shockTrainSamples.at(-1).time,
  temporalSamples: shockTrainSamples,
});

const bridgeStartleCliplets = buildGeneratedPoseTemporalCliplets({
  schema: 'kaminos.generated-pose-temporal.v0',
  id: 'synthetic_bridge_startle_source',
  label: 'Synthetic Bridge Startle Source',
  intent: 'a man hesitates, commits awkwardly, then brakes hard',
  sourceKind: 'motion-panel-generated-pose-temporal',
  sourceStatus: 'test-fixture',
  sourceModel: 'contract-synthetic',
  sourceRoute: 'tests/generated-motion-smart-phrase-contracts.mjs:bridge-startle',
  sourceFrameStride: 1,
  rawFrameCount: bridgeStartleSamples.length,
  fps: 30,
  duration: bridgeStartleSamples.at(-1).time,
  temporalSamples: bridgeStartleSamples,
});

const startleBeat = startleCliplets.segments.find(segment => segment.labelGuess === 'startle-recoil / escape');
assert.ok(startleBeat, 'notice-brake-escape raw sequence should coalesce into a named startle/recoil beat');
assert.ok(startleBeat.rawSegmentIds.length >= 3, 'startle/recoil beat keeps notice, brake, and escape raw children');
assert.ok(startleBeat.coalescing.reasons.includes('named-startle-recoil'), 'startle/recoil beat records named coalescing reason');

const recoverBeat = startleCliplets.segments.find(segment => segment.labelGuess === 'recover-settle / return');
assert.ok(recoverBeat, 'settle/recover tail should have a named recovery phrase');
assert.ok(recoverBeat.coalescing.reasons.includes('named-recover-settle'), 'recovery phrase records named coalescing reason');

const impactBeat = impactCliplets.segments.find(segment => segment.labelGuess === 'approach-impact / compress');
assert.ok(impactBeat, 'approach-brake alternation should be named as an approach/impact beat');
assert.ok(impactBeat.rawSegmentIds.length >= 3, 'approach/impact beat keeps its raw approach and brake children');
assert.ok(impactBeat.coalescing.reasons.includes('named-approach-impact'), 'approach/impact beat records named coalescing reason');

const shockTrainBeat = shockTrainCliplets.segments.find(segment => segment.labelGuess === 'startle-recoil / escape');
assert.ok(shockTrainBeat, 'repeated hesitate/brake shock trains should still produce a named startle/recoil phrase');
assert.ok(shockTrainBeat.rawSegmentIds.length >= 4, 'shock-train phrase keeps the repeated raw hesitation/brake children');
assert.ok(shockTrainBeat.coalescing.reasons.includes('named-startle-recoil'), 'shock-train phrase records startle/recoil reason');

const bridgeStartleBeat = bridgeStartleCliplets.segments.find(segment => segment.labelGuess === 'startle-recoil / escape');
assert.ok(bridgeStartleBeat, 'hesitate-approach-brake bridge should still produce a named startle/recoil phrase');
assert.ok(bridgeStartleBeat.rawSegmentIds.length >= 3, 'bridge startle phrase keeps hesitation, approach, and brake raw children');

assert.match(index, /id="motion-panel-phrase-preview"/, 'Motion panel exposes a phrase preview surface');
assert.match(index, /function renderMotionPanelPhrasePreview/, 'browser renders a phrase preview from generated cliplets');
assert.match(index, /motion-panel-phrase-chip/, 'phrase preview uses visible phrase chips');
assert.match(index, /rawSegmentIds/, 'phrase preview has access to raw child evidence');
assert.match(index, /renderMotionPanelPhrasePreview\(motionTemporalState\.generatedMotionCliplets\)/, 'dropdown changes refresh phrase preview active state');
