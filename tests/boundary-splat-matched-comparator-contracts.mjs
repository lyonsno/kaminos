import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const coreSource = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const witnessUrl = new URL('../volume-boundary-splat-comparator-witness.mjs', import.meta.url);
const witness = existsSync(witnessUrl) ? readFileSync(witnessUrl, 'utf8') : '';

assert.match(
  coreSource,
  /async function sampleBoundarySplatMatchedComparatorCost/,
  'runtime must expose a frozen-simulator matched control/treatment cost sampler',
);
assert.match(
  coreSource,
  /sampleBoundarySplatMatchedComparatorCost,/,
  'matched comparator cost sampling must be reachable from the live prototype',
);
assert.match(
  coreSource,
  /BOUNDARY_SPLAT_MATCHED_COMPARATOR_IDENTITY\s*=\s*'boundary-splat-matched-comparator-v0'/,
  'runtime must publish a stable matched-comparator identity',
);

const matchedCostSource = coreSource.match(
  /async function sampleBoundarySplatMatchedComparatorCost\(options = \{\}\) \{[\s\S]*?\n  async function primeBoundarySplatLiveHistory/,
)?.[0] || '';
assert.match(matchedCostSource, /controlMode[\s\S]*treatmentMode/, 'caller must name both comparator allocation modes');
assert.match(matchedCostSource, /advanceSimulation:\s*false/, 'matched cost rows must never advance the simulator');
assert.match(matchedCostSource, /simulatorPreserved/, 'matched cost evidence must prove simulator preservation');
assert.match(matchedCostSource, /framePreserved/, 'matched cost evidence must prove frame preservation');
assert.match(matchedCostSource, /sampleBoundarySplatDrawState\(\)/, 'each cost row must retain fresh physical draw authority');
assert.match(matchedCostSource, /gpu-indirect-command-buffer-post-submit-readback-v0/, 'matched cost rows must require physical command authority');
assert.match(matchedCostSource, /controlsSnapshot = controlsBefore/, 'matched cost sampling must restore ambient live controls');
assert.match(matchedCostSource, /resumeRenderLoopAfterSampling\s*=\s*raf\s*!==\s*0\s*&&\s*!boundarySplatWitnessPaused/, 'direct cost sampling must observe an actually scheduled loop and exact-frame custody');
assert.match(matchedCostSource, /resumeRenderLoopAfterSampling[\s\S]*requestAnimationFrame\(render\)/, 'direct cost sampling must restart only a loop it paused');
assert.doesNotMatch(coreSource, /cancelAnimationFrame\(raf\);\n(?!\s*raf\s*=\s*0;)/, 'every RAF cancellation must zero its token so loop ownership cannot be inferred from stale ids');

assert.equal(existsSync(witnessUrl), true, 'the Greenroom matched-state comparator witness must exist');
assert.match(witness, /captureBoundarySplatWitnessFrame/, 'witness must pause one exact live source before either variant');
assert.match(witness, /renderFrozenScaleToCanvas/, 'witness must render both variants from the frozen source socket');
assert.match(witness, /sampleBoundarySplatMatchedComparatorCost/, 'witness must collect matched timestamp-backed cost evidence');
assert.match(witness, /controlMode[\s\S]*treatmentMode/, 'report must preserve explicit control and treatment identities');
assert.match(witness, /sameStateCaptureId/, 'both variants must carry one same-state capture identity');
assert.match(witness, /simStepCount/, 'variant validation must bind simulator identity');
assert.match(witness, /frameCount/, 'variant validation must bind frame identity');
assert.match(witness, /historyWriteSlot/, 'variant validation must bind history identity');
assert.match(witness, /boundarySplatIndirectCommandAgreement/, 'visual acceptance must require physical draw agreement');
assert.match(witness, /boundarySplatProjectedSizeBins/, 'report must group allocation evidence by projected flame size');
assert.match(witness, /requestedEffectiveRouteAgreement/, 'report must preserve bidirectional requested/effective route agreement');
assert.match(witness, /lastTrustworthyEvidence/, 'failure before primary output must leave durable phase evidence');
assert.match(witness, /blank-or-partial-comparator-canvas/, 'blank or partial visual output must fail loud');
assert.match(witness, /stale-or-default-comparator-config/, 'stale/default controls must fail before visual acceptance');
assert.match(witness, /fallback-route/, 'fallback rendering must be rejected');
assert.match(witness, /sameBrowserTargetPreserved/, 'the existing persistent browser target must survive the witness');
assert.match(witness, /comparisonSurfaceImage/, 'witness must retain an inspectable screenshot of the generated comparator UI');
assert.match(witness, /comparison-surface\.png/, 'comparator UI evidence must have a stable image name');
assert.match(witness, /sourceFrozen\s*=\s*true/, 'witness must record successful source-freeze custody');
assert.match(witness, /bestEffortResumeAfterFailure/, 'post-freeze failure cleanup must attempt to resume the existing live loop');
assert.match(witness, /cleanupFailure/, 'cleanup failure must be recorded without replacing the primary failure');
assert.doesNotMatch(witness, /spawn\(/, 'the comparator must never launch a second browser');
assert.doesNotMatch(witness, /slice\(0,\s*\d+\)/, 'the comparator must not hide caller-owned samples behind a cap');

const physicalValidationIndex = witness.indexOf('validateVariantCapture(capture');
const screenshotIndex = witness.indexOf('const image = await captureCanvas()', physicalValidationIndex);
assert.ok(physicalValidationIndex >= 0, 'variant physical evidence must be validated');
assert.ok(
  screenshotIndex > physicalValidationIndex,
  'variant physical evidence must be validated before its screenshot is accepted',
);

assert.match(witness, /data-view="side-by-side"/, 'comparison surface must expose untouched side-by-side images');
assert.match(witness, /data-view="wipe"/, 'comparison surface must expose a wipe view');
assert.match(witness, /data-view="blink"/, 'comparison surface must expose a blink view');
assert.match(witness, /data-view="residual"/, 'comparison surface must expose an amplified residual locator');
assert.match(witness, /residualGain/, 'residual amplification must expose its effective gain');
assert.match(witness, /Raw A[\s\S]*Raw B/, 'amplified diagnostics must retain direct access to untouched evidence');
assert.match(witness, /class="tag a">A<[\s\S]*class="tag b">B</, 'primary side-by-side view must visibly label the randomized A/B halves');
assert.match(witness, /capture\.boundarySplatHistoryWriteSlot\s*!==\s*frozen\.historyWriteSlot/, 'each accepted variant must enforce frozen history-slot equality');
assert.match(witness, /crypto\.getRandomValues/, 'A/B presentation must randomize labels in the browser');
assert.match(witness, /blindOrder:\s*comparisonState\.blindOrder/, 'the report must retain the effective randomized assignment for later decoding');
assert.match(witness, /invalid-blind-order/, 'partial or invalid randomized assignment must fail loud');

console.log('boundary splat matched comparator contracts passed');
