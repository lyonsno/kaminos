#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const contractPath = join(root, 'volume-nonridge-source-basis-capture.mjs');
const witnessPath = join(root, 'volume-nonridge-source-basis-capture-witness.mjs');
const corePath = join(root, 'volume-core.js');
const packerPath = join(root, 'volume-nonridge-source-basis-corpus.py');

assert.ok(existsSync(contractPath), 'full-grid Non-Ridge source-basis capture contract exists');
assert.ok(existsSync(witnessPath), 'full-grid Non-Ridge source-basis browser witness exists');
assert.ok(existsSync(packerPath), 'the exact Vivisector corpus packer is present on the integration branch');

const {
  CAUSAL_CONTROL_ORDER,
  CURRENT16_ORDER,
  SOURCE_BASIS_GPU_ROW_FLOATS,
  SOURCE_BASIS_ORDER,
  TARGET_ORDER,
  buildVivisectorControlDesign,
  buildFullGridWorldPositions,
} = await import(contractPath);

assert.deepEqual(CAUSAL_CONTROL_ORDER, [
  'support.thermal', 'support.reaction', 'support.front', 'support.interface',
  'boundary.gradientGain', 'boundary.cut', 'boundary.softness', 'boundary.coreRejection',
  'topology.gain', 'curl.gain', 'divergence.gain',
  'ridge.gain', 'ridge.cut', 'tip.breakup', 'topology.erosion',
]);
assert.equal(CURRENT16_ORDER.length, 16);
assert.equal(SOURCE_BASIS_GPU_ROW_FLOATS, 33, 'full-grid rows preserve the 29-float prefix and append four Ridge coefficients');
assert.deepEqual(SOURCE_BASIS_ORDER, [
  'front.topology', 'velocity.x', 'velocity.y', 'velocity.z',
  'support.reaction', 'support.interface', 'flow.curlMagnitude', 'flow.divergence',
]);
assert.deepEqual(TARGET_ORDER, [
  'candidate.nonRidgeMembership',
  'nonRidge.emission.r', 'nonRidge.emission.g', 'nonRidge.emission.b', 'nonRidge.extinction',
  'ridge.emission.r', 'ridge.emission.g', 'ridge.emission.b', 'ridge.extinction',
]);

const ranges = Object.fromEntries(CAUSAL_CONTROL_ORDER.map((name, index) => [name, [index, index + 1]]));
const design = buildVivisectorControlDesign({ seed: 7162026, settingCount: 17, controlRanges: ranges });
assert.equal(design.length, 17);
assert.deepEqual(design, buildVivisectorControlDesign({ seed: 7162026, settingCount: 17, controlRanges: ranges }));
for (const name of CAUSAL_CONTROL_ORDER) {
  const values = design.map(setting => setting[name]);
  assert.ok(values.includes(ranges[name][0]), `${name} includes its exact minimum`);
  assert.ok(values.includes(ranges[name][1]), `${name} includes its exact maximum`);
  assert.equal(new Set(values).size, design.length, `${name} preserves one space-filling level per setting`);
}

const campaignDesign = buildVivisectorControlDesign();
assert.equal(
  campaignDesign[2]['boundary.gradientGain'],
  0.25,
  'setting-c receives setting-m\'s low gradient level under the measured one-black correction',
);
assert.equal(
  campaignDesign[12]['boundary.gradientGain'],
  3.25,
  'setting-m receives setting-c\'s high gradient level under the measured one-black correction',
);
for (const name of CAUSAL_CONTROL_ORDER) {
  assert.equal(
    new Set(campaignDesign.map(setting => setting[name])).size,
    campaignDesign.length,
    `${name} remains a complete Latin-hypercube column after correction`,
  );
}

const positions = buildFullGridWorldPositions({ shape: [2, 2, 2], origin: [-1, -1, -1], spacing: [1, 1, 1] });
assert.deepEqual(Array.from(positions), [
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5,
  -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
  -0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
], 'world positions are unique x-fastest cell centers');

const core = readFileSync(corePath, 'utf8');
const contract = readFileSync(contractPath, 'utf8');
const witness = readFileSync(witnessPath, 'utf8');
assert.match(core, /NONRIDGE_SOURCE_BASIS_CAPTURE_IDENTITY/, 'core names the source-basis capture identity');
assert.match(core, /applyDebugNonRidgeCausalControls/, 'core exposes explicit bounded causal-control application');
assert.match(core, /beginDebugNonRidgeSourceBasisCapture/, 'core exposes full-grid capture begin custody');
assert.match(core, /readDebugNonRidgeSourceBasisCaptureChunk/, 'core exposes uncapped chunked source-basis reads');
assert.match(core, /releaseDebugNonRidgeSourceBasisCapture/, 'core exposes explicit full-grid capture release custody');
assert.match(core, /fullGridCapture[\s\S]*GRID[\s\S]*cellIndex/, 'shader capture visits exact grid cells rather than visible ray samples');
assert.match(core, /nonRidgeMembership[\s\S]*nonRidgeEmissionCoefficient[\s\S]*nonRidgeExtinctionCoefficient/, 'membership and positive optical targets come from the exact local partition');
assert.match(core, /writeNonRidgeSourceBasisCaptureRow\([\s\S]*ridgeOwnedEmissionCoefficient[\s\S]*ridgeOwnedExtinctionCoefficient/, 'full-grid rows retain exact Ridge coefficients from the same local partition invocation');
assert.match(core, /sourceBasisReaction[\s\S]*sourceBasisInterface[\s\S]*sourceBasisCurl[\s\S]*sourceBasisDivergence/, 'source basis is written from independent local fields');
assert.match(core, /nonRidgeSourceBasisControlsActive[\s\S]*boundaryControlUniformAuthority/, 'source-basis capture owns the boundary-control uniform mapping independently of presentation mode');
assert.match(core, /sourceBasisGpuControlReceipt[\s\S]*uniforms\[280\][\s\S]*uniforms\[299\]/, 'GPU-effective receipts come from the actual shader uniform payload');
assert.match(core, /sourceBasisGpuControlReceipt[\s\S]*'optics\.raymarchFireAuthority':\s*1\s*-\s*uniforms\[316\]/, 'GPU-effective receipts expose the fire-authority payload that gates source coefficient capture');
assert.match(core, /const sourceBasisRaymarchFireAuthority = nonRidgeSourceBasisControlsActive[\s\S]*\? 1[\s\S]*:\s*selectiveCompositionDefinition\.raymarchFireAuthority[\s\S]*uniforms\[316\] = 1 - sourceBasisRaymarchFireAuthority/, 'source-basis capture owns full Raymarch fire authority independently of presentation composition');
assert.match(core, /captureOpticalAuthoritySubstitutions[\s\S]*optics\.raymarchFireAuthority[\s\S]*nonridge-source-basis-capture-fire-authority-substitution/, 'capture rejects hidden fire-authority substitution instead of exporting a zero optical corpus');
assert.match(core, /sourceBasisControlApplicationVerification[\s\S]*beginDebugNonRidgeSourceBasisCapture[\s\S]*nonridge-source-basis-capture-requires-control-application/, 'capture revalidates its own applied CPU and GPU control authority instead of trusting caller order');
assert.match(core, /rendererPassReceipt:[\s\S]*boundaryControlUniformAuthority[\s\S]*gpuEffectiveControls/, 'full-grid pass receipt binds the shader-effective control payload used by capture');
assert.match(core, /const failed = \(failurePhase[\s\S]*clearNonRidgeSourceBasisControlAuthority/, 'failed captures restore ordinary presentation-owned uniform authority');
assert.match(core, /nonRidgeSourceBasisControlsActive = true;[\s\S]*try \{[\s\S]*updateUniforms\(performance\.now\(\)\)[\s\S]*catch \(error\)[\s\S]*clearNonRidgeSourceBasisControlAuthority/, 'control application cleans up capture authority when uniform upload throws');
assert.match(core, /sourceBasisControlApplicationVerification[\s\S]*catch \(error\)[\s\S]*nonridge-source-basis-capture-uniform-update-failed/, 'capture-time uniform revalidation converts thrown updates into a cleanup-bearing failed receipt');
assert.match(core, /prior-nonridge-source-basis-session-not-released[\s\S]*heldSession:[\s\S]*nonRidgeSourceBasisPublicSession/, 'duplicate begin preserves the held captured session for read and release');
assert.match(core, /releaseDebugNonRidgeSourceBasisCapture[\s\S]*clearNonRidgeSourceBasisControlAuthority/, 'capture release restores ordinary presentation-owned uniform authority');
assert.match(core, /struct NonRidgeOpticalCaptureHeader[\s\S]*startCell:\s*u32/, 'capture header carries the global starting cell for exact bounded dispatches');
assert.match(core, /fullGridCapture[\s\S]*cellIndex >= nonRidgeOpticalCaptureHeader\.startCell[\s\S]*cellIndex - nonRidgeOpticalCaptureHeader\.startCell/, 'chunked full-grid writes preserve contiguous global cell identity while indexing the bounded target buffer locally');
assert.match(core, /maxStorageBufferBindingSize[\s\S]*maxChunkRows[\s\S]*Math\.floor\([\s\S]*NONRIDGE_SOURCE_BASIS_ROW_STRIDE_BYTES/, 'source-basis begin derives a device-binding-safe chunk capacity without reducing full-grid row authority');
assert.doesNotMatch(core, /full-grid-row-bytes-exceed-device-binding-limit/, 'full-grid source-basis capture no longer rejects grids whose aggregate rows exceed one storage binding');
assert.match(core, /async function readDebugNonRidgeSourceBasisCaptureChunk[\s\S]*startCell[\s\S]*runNonRidgeOpticalCapturePass\([\s\S]*mode:\s*3[\s\S]*readNonRidgeOpticalCaptureRows/, 'each requested source-basis chunk is materialized from the frozen GPU state on demand');
assert.match(core, /runNonRidgeOpticalCapturePass\(\{ mode, capacity, startCell = 0[\s\S]*new Uint32Array\(\[0, capacity, mode, 0, startCell/, 'the full-grid pass transmits bounded global cell range metadata to the shader');

assert.match(witness, /kaminos\.volume\.nonridge-source-setting-captures\.v0/, 'witness writes the exact capture-manifest schema');
assert.match(witness, /integration-positive-nonridge-randomized-source-captures-v0/, 'witness names Integration capture authority');
assert.match(witness, /retain-all-admitted-settings-and-rows-uncapped-v0/, 'witness cannot hide a setting or row cap');
assert.match(witness, /exactly-one-measured-all-target-zero-control-v0/, 'witness declares the one-black learner-slate policy');
assert.match(contract, /single-axis-setting-transposition-v0/, 'design contract names the deterministic measured correction');
assert.match(witness, /designCorrection:[\s\S]*SOURCE_BASIS_DESIGN_CORRECTION/, 'witness emits the deterministic measured design correction');
assert.match(witness, /frozenStateArtifact[\s\S]*generationHash[\s\S]*simStepHash/, 'witness binds the frozen state hash chain');
assert.match(witness, /requestedControls[\s\S]*effectiveControls[\s\S]*gpuEffectiveControls/, 'witness keeps all three control authority receipts');
assert.match(witness, /gpuControlSubstitutions[\s\S]*boundaryControlUniformAuthority/, 'witness rejects shader-effective control drift even when CPU controls look exact');
assert.match(witness, /worldPosition[\s\S]*current16[\s\S]*sourceComplete[\s\S]*sourceBasis[\s\S]*targets/, 'witness emits every packer artifact separately');
assert.match(witness, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'pre-manifest failures remain durable');
assert.match(witness, /volume-nonridge-source-basis-corpus\.py/, 'witness validates its output with the unmodified Vivisector packer');

console.log('volume Non-Ridge source-basis capture contracts passed');
