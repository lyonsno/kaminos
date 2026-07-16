import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const witnessPath = join(root, 'volume-intrinsic-presentation-witness.mjs');
assert.ok(existsSync(witnessPath), 'dedicated intrinsic presentation witness exists');
const witness = readFileSync(witnessPath, 'utf8');

assert.ok(witness.indexOf('class CdpSocket') < witness.indexOf('\ntry {'), 'CDP infrastructure is initialized before top-level witness execution');
assert.match(witness, /mkdtempSync\('\/tmp\/kaminos-intrinsic-presentation-profile-'/, 'witness launches under an isolated Chrome profile');
assert.match(witness, /--user-data-dir=\$\{userDataDir\}/, 'isolated profile is bound to the launched browser');
assert.match(witness, /Runtime\.exceptionThrown[\s\S]*browserEvents/, 'browser exceptions are preserved instead of decaying into an opaque timeout');
assert.match(witness, /consoleError[\s\S]*type === 'error'[\s\S]*throw new Error/, 'console-level route initialization failures stop admission immediately');
assert.match(witness, /wrapperError:\s*wrapper\?\.error[\s\S]*if \(last\?\.wrapperStatus === 'failed'\)[\s\S]*throw new Error/, 'wrapper-owned admission failures stop immediately with their own error');
assert.match(witness, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'witness tracks failure phase and last trustworthy evidence');
assert.match(witness, /catch \(error\)[\s\S]*writeFileSync\(reportPath/, 'failure before primary output still writes a durable report');
assert.match(witness, /sourceSettingsPreset[\s\S]*sourcePresetAuthority[\s\S]*controlCount/, 'witness preserves complete shared-preset identity');
assert.match(witness, /role=truthHigh[\s\S]*composition=smoke-raymarch-under-splats-v0/, 'witness requires the canonical wrapper-owned Beauty role and composition identity');
assert.match(witness, /__kaminosSelectiveHeadLive[\s\S]*contentWindow\?\.__kaminosVolumePrototype/, 'witness resolves the operator wrapper and its nested renderer without confusing their authorities');
assert.match(witness, /backend\?\.startsWith\('WebGPU'\)/, 'witness admits the effective WebGPU adapter identity without hard-coding one label');
assert.match(witness, /Object\.keys\(sourceReceipt\.preset\?\.domControls \|\| \{\}\)\.length/, 'witness counts authored controls rather than schema-owned route extras');
assert.match(witness, /requestedRoute[\s\S]*effectiveRoute[\s\S]*prototypeIdentity[\s\S]*backend/, 'witness records requested and effective runtime route identity');
assert.match(witness, /setSelectiveHeadLiveCapturePaused\(true\)/, 'witness pauses the live renderer before same-state switching');
assert.match(witness, /sampleFrame\(\{[\s\S]*advanceSim:\s*false[\s\S]*includeRgba:\s*true/, 'witness samples pixels without simulation advance');
assert.match(witness, /captureMode\('beauty'\)[\s\S]*captureMode\('intrinsic'\)[\s\S]*captureMode\('beauty'\)/, 'witness captures Beauty, Intrinsic, and restored Beauty in order');
assert.match(witness, /simStepCount[\s\S]*temporalHistoryResetCount[\s\S]*controlsHash[\s\S]*cameraHash/, 'witness rejects simulation, reset, authored-control, and camera mutation');
assert.match(witness, /beauty\.metrics\.nonblank[\s\S]*intrinsic\.metrics\.nonblank[\s\S]*beautyRestored\.metrics\.nonblank/, 'witness rejects blank output in every compared presentation');
assert.match(witness, /RESTORATION_MAX_CHANNEL_DELTA\s*=\s*1/, 'restored Beauty cannot drift by more than one channel value');
assert.match(witness, /RESTORATION_MAX_MEAN_ABS_CHANNEL_DELTA\s*=\s*1e-6/, 'restored Beauty mean channel drift remains tightly bounded');
assert.match(witness, /RESTORATION_MAX_CHANGED_PIXEL_RATIO\s*=\s*1e-5/, 'restored Beauty changed-pixel ratio remains tightly bounded');
assert.match(
  witness,
  /restorationDelta\.maxChannelDelta[\s\S]*RESTORATION_MAX_CHANNEL_DELTA[\s\S]*restorationDelta\.meanAbsChannelDelta[\s\S]*RESTORATION_MAX_MEAN_ABS_CHANNEL_DELTA[\s\S]*restorationDelta\.changedPixelRatio[\s\S]*RESTORATION_MAX_CHANGED_PIXEL_RATIO/,
  'witness rejects restored Beauty outside every measured pixel-drift bound',
);
assert.match(witness, /const restorationAcceptance = \{[\s\S]*exactPixelHashMatch[\s\S]*restorationAcceptance,/, 'report preserves exact hash equality as a diagnostic beside bounded acceptance');
assert.match(witness, /durationMs/, 'witness measures each presentation capture cost');
assert.match(witness, /function pixelDelta[\s\S]*maxChannelDelta[\s\S]*meanAbsChannelDelta[\s\S]*changedPixelRatio/, 'witness measures restored-Beauty pixel drift before defining acceptance');
assert.match(witness, /const restorationDelta\s*=\s*pixelDelta[\s\S]*restorationDelta,/, 'same-state evidence carries measured Beauty restoration drift');
assert.match(witness, /sample\.volumePresentationReceipt[\s\S]*sample\.selectiveHeadLivePassReceipt/, 'witness preserves effective image-pass receipts, not only switch requests');
assert.match(witness, /volumePresentationReceipt\.application[\s\S]*raymarchApplied[\s\S]*splatsApplied[\s\S]*residualEncoded[\s\S]*residualApplied[\s\S]*featureCaptureEncoded[\s\S]*featureCaptureApplied/, 'witness validates every pass encoded and applied to sampled pixels');
assert.match(witness, /candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0/, 'witness requires the exact intrinsic target identity');
assert.match(witness, /passes\.splats[\s\S]*passes\.residual[\s\S]*passes\.featureCapture/, 'witness rejects hidden splat, residual, or feature-capture application');
assert.match(witness, /function stripEvidencePngData[\s\S]*beauty:[^\n]*stripPngData[\s\S]*intrinsic:[^\n]*stripPngData[\s\S]*beautyRestored:[^\n]*stripPngData/, 'failed witness reports recursively remove nested PNG payloads');

console.log('volume intrinsic presentation witness contracts passed');
