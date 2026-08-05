import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const witnessUrl = new URL('../volume-layer-coefficient-bilinear-motion-witness.mjs', import.meta.url);
const rendererUrl = new URL('../volume-layer-coefficient-bilinear-motion-render.py', import.meta.url);
const captureUrl = new URL('../volume-layer-coefficient-corpus-witness.mjs', import.meta.url);
const exactCaptureUrl = new URL('../volume-exact-target-capture.mjs', import.meta.url);
const coreUrl = new URL('../volume-core.js', import.meta.url);

const core = readFileSync(coreUrl, 'utf8');
assert.match(core, /'shared-transmittance-contribution-sum':\s*\{[^}]*emissionMask:\s*'ridge-owned-plus-non-ridge'[^}]*extinctionMask:\s*'complete-flame'/, 'core exposes the reviewed exact shared-transmittance target');
assert.match(core, /sharedTransmittanceIdentity:\s*'ridge-plus-non-ridge-extinction-one-running-transmittance-v0'/, 'target receipt names one shared optical recurrence');

assert.ok(existsSync(witnessUrl), 'exact bilinear temporal witness must exist');
assert.ok(existsSync(rendererUrl), 'exact bilinear temporal renderer must exist');

const witness = readFileSync(witnessUrl, 'utf8');
const renderer = readFileSync(rendererUrl, 'utf8');
const capture = readFileSync(captureUrl, 'utf8');
const exactCapture = readFileSync(exactCaptureUrl, 'utf8');

assert.match(witness, /kaminos\.volume\.layer-coefficient-bilinear-motion-witness\.v0/, 'witness publishes a stable schema');
assert.match(witness, /volume-layer-coefficient-corpus-witness\.mjs/, 'wrapper invokes the reviewed single-browser capture engine');
assert.equal((witness.match(/volume-layer-coefficient-corpus-witness\.mjs/g) || []).length, 1, 'wrapper invokes the capture engine exactly once');
assert.match(witness, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'witness writes phase-local durable failure evidence');
assert.match(witness, /unlinkIfExists\(path\)/, 'wrapper removes stale child artifacts before accepting new evidence');
assert.match(witness, /captureReport\.status !== 'captured'/, 'wrapper rejects stale or failed capture reports');
assert.match(witness, /renderReport\.status !== 'complete'/, 'wrapper rejects stale or failed render reports');

assert.match(capture, /single-browser-multi-state-exact-bilinear-motion-v0/, 'one browser owns the complete exact sequence');
assert.match(capture, /adjacent-exact-state-one-trajectory-v0/, 'all motion states share one deterministic replay origin and physical clock');
assert.match(capture, /sampleDeterministicReplayFrame/, 'each sequence member is a deterministic simulator state');
const captureStateStart = capture.indexOf('async function captureState');
const captureStateEnd = capture.indexOf('async function captureMotionTarget', captureStateStart);
const captureState = capture.slice(captureStateStart, captureStateEnd);
assert.match(captureState, /setSelectiveHeadLiveCapturePaused\(true\)/, 'exact state capture pauses the renderer loop before reading the frozen state');
assert.doesNotMatch(captureState, /setActive\(false\)/, 'a frozen state remains active so render-only readback APIs stay available');
assert.match(capture, /captureExactTargetFrame\.toString\(\)/, 'browser execution uses the executable exact-target helper');
assert.match(exactCapture, /let sample = null;[\s\S]*try\s*\{[\s\S]*sample = await prototype\.sampleFrame/, 'successful target capture preserves the sample receipt beyond restoration');
assert.match(capture, /shared-transmittance-contribution-sum/, 'target capture pins the exact shared-transmittance contribution target');
assert.match(exactCapture, /setRaymarchSmokePresentationMode\(['"]off['"]\)/, 'target capture excludes smoke presentation');
assert.match(exactCapture, /sampleFrame\(\{[\s\S]*advanceSim:\s*false[\s\S]*includeRgba:\s*true/, 'target capture reads exact pixels without advancing the simulator');
assert.ok(exactCapture.includes("'exact-target-sample-failed:' + (sample?.reason || 'unknown')"), 'target capture distinguishes an unavailable readback from a genuinely blank image');
assert.match(exactCapture, /exact-target-rgba-missing/, 'target capture rejects missing pixel payloads');
assert.match(exactCapture, /exact-target-blank-image/, 'target capture rejects genuinely blank pixel payloads');
assert.match(capture, /isExactTargetBlankImageError/, 'visible-canvas recovery is restricted to the exact native blank-image failure');
assert.match(capture, /renderExactTargetFrameToVisibleCanvas\.toString\(\)/, 'fallback uses the executable exact frozen visible-canvas helper');
assert.match(capture, /Page\.captureScreenshot/, 'fallback captures the just-rendered visible canvas through CDP');
assert.match(capture, /hideExactTargetCaptureOverlays/, 'fallback suppresses route UI that overlaps the renderer canvas');
assert.match(capture, /restoreExactTargetCaptureOverlays/, 'fallback restores route UI after the canvas screenshot');
assert.match(capture, /finally\s*\{[\s\S]*restoreExactTargetCaptureOverlays/, 'overlay restoration survives screenshot or inspection failure');
assert.match(capture, /cdp-canvas-clip-capture-after-render-only-frozen-sim-state/, 'fallback records weaker but explicit visible-canvas image authority');
assert.match(capture, /nativeReadbackFailure/, 'fallback preserves the native readback defect instead of laundering it');
assert.match(capture, /overlayIsolationReceipt/, 'capture report preserves visible-canvas overlay isolation authority');
assert.match(capture, /overlayRestorationReceipt/, 'capture report proves the hidden route UI was restored');
assert.match(capture, /exact-target-visible-canvas-blank-image/, 'fallback rejects blank visible-canvas pixels');
assert.match(exactCapture, /boundarySplatComposition:\s*['"]raymarch-only-v0['"]/, 'fallback forbids splat contamination of the exact raymarch target');
assert.match(exactCapture, /finally\s*\{[\s\S]*setAppearanceDecompositionMode\(priorAppearanceMode\)[\s\S]*setRaymarchSmokePresentationMode\(priorSmokeMode\)[\s\S]*raySteps:\s*priorRaySteps/, 'target capture restores transient renderer controls even when readback fails');
assert.match(capture, /fixed-held-camera-across-consecutive-states-v0/, 'camera authority is fixed across the sequence');
assert.match(capture, /readFlowKernelDescriptorCaptureProjectionChunk/, 'witness drains only the compact descriptor geometry required by the renderer');
assert.match(capture, /\[0,\s*1,\s*2,\s*3,\s*20,\s*21,\s*22,\s*23\]/, 'descriptor projection pins position, native identity, tangent, and coherence columns');
assert.match(capture, /sampleCap:\s*null/, 'witness preserves uncapped analytical support');
assert.match(capture, /droppedRowCount:\s*0/, 'witness records zero dropped rows');
assert.match(capture, /overflowCount/, 'witness records and rejects population overflow');
assert.match(capture, /targetPixelSha256/, 'witness binds each target image to exact pixel bytes');
assert.match(capture, /cached-or-duplicate-target/, 'witness rejects cached or duplicate target images across distinct states');
assert.match(capture, /motion state steps must be strictly increasing/, 'motion capture rejects reordered or repeated trajectory states');
assert.match(capture, /motion sequence changed causal controls/, 'motion manifest rejects control drift across exact states');
assert.match(capture, /exact target leaked ray-step controls/, 'exact target capture restores transient ray-step controls');
assert.match(capture, /exact target camera drifted from the fixed trajectory camera/, 'each exact target proves fixed-camera identity');
assert.match(capture, /emitted browser failures/, 'browser exceptions and error logs fail the evidence route');
assert.doesNotMatch(capture, /Promise\.all\([^)]*state/i, 'witness never launches simulator states concurrently');

assert.match(renderer, /kaminos\.volume\.layer-coefficient-bilinear-motion-render\.v0/, 'renderer publishes a stable schema');
assert.match(renderer, /FLOW_TAP_OFFSETS\s*=\s*\(-1\.0,\s*-0\.5,\s*0\.0,\s*0\.5,\s*1\.0\)/, 'renderer pins the accepted five flow-tangent taps');
assert.match(renderer, /FLOW_TAP_WEIGHTS\s*=\s*\(0\.075,\s*0\.225,\s*0\.4,\s*0\.225,\s*0\.075\)/, 'renderer pins the accepted flow-tangent weights');
assert.match(renderer, /DEPTH_BINS\s*=\s*96/, 'renderer pins the converged 96-bin shared-transmittance compositor');
assert.match(renderer, /globalPathScale/, 'renderer fits or consumes one global path scale for the entire temporal sequence');
assert.doesNotMatch(renderer, /fit_path_scale[\s\S]{0,120}for\s+state/, 'renderer does not secretly refit optical scale per state');
assert.match(renderer, /adjacentFramePixelDiffs/, 'renderer measures target and splat motion between adjacent states');
assert.match(renderer, /nodeIdentityTurnover/, 'renderer measures native-node identity turnover');
assert.match(renderer, /multiplicityChurn/, 'renderer measures deposit multiplicity churn');
assert.match(renderer, /placementVelocity/, 'renderer measures shared-node placement velocity');
assert.match(renderer, /sequence-viewer\.html/, 'renderer writes an operator-scrubbable exact temporal comparison');
assert.match(renderer, /cached-or-static-render/, 'renderer rejects a static or cached rendered sequence');
assert.match(renderer, /matched-native-node-flow-tangent-tap-centers-v0/, 'placement velocity follows projected quadrature taps rather than fixed Eulerian cells');
assert.match(renderer, /actual-in-bounds-positive-weight-bilinear-deposit-count-v1/, 'multiplicity churn counts actual in-frame positive-weight deposits');

const python = process.env.KAMINOS_MLX_PYTHON || '/private/tmp/kaminos-mlx-residual-venv/bin/python';
const selfTest = spawnSync(python, [rendererUrl.pathname, '--self-test'], { encoding: 'utf8' });
assert.equal(selfTest.status, 0, selfTest.stderr || selfTest.stdout);
assert.match(selfTest.stdout, /bilinear motion renderer self-test passed/);

const missingUrlRoot = await mkdtemp(join(tmpdir(), 'kaminos-bilinear-motion-witness-failure-'));
const missingUrlReport = join(missingUrlRoot, 'witness-report.json');
const missingUrl = spawnSync(process.execPath, [
  witnessUrl.pathname,
  '--out-dir', missingUrlRoot,
  '--report', missingUrlReport,
], { encoding: 'utf8' });
assert.notEqual(missingUrl.status, 0, 'missing route must fail before browser launch');
assert.ok(existsSync(missingUrlReport), 'argument failure must still emit a durable witness report');
const missingUrlFailure = JSON.parse(await readFile(missingUrlReport, 'utf8'));
assert.equal(missingUrlFailure.status, 'failed');
assert.equal(missingUrlFailure.failurePhase, 'argument-validation');
assert.match(missingUrlFailure.reason, /--url is required/);

const failureRoot = await mkdtemp(join(tmpdir(), 'kaminos-bilinear-motion-render-failure-'));
const invalidManifest = join(failureRoot, 'invalid.json');
const failureReport = join(failureRoot, 'failure-report.json');
await writeFile(invalidManifest, JSON.stringify({ schema: 'wrong' }));
const invalid = spawnSync(python, [
  rendererUrl.pathname,
  '--manifest', invalidManifest,
  '--out-dir', join(failureRoot, 'out'),
  '--report', failureReport,
], { encoding: 'utf8' });
assert.notEqual(invalid.status, 0, 'invalid motion manifest must fail');
assert.ok(existsSync(failureReport), 'pre-render failure must still emit a durable report');
const failure = JSON.parse(await readFile(failureReport, 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'temporal-render');
assert.match(failure.reason, /schema/i);

console.log('volume layer coefficient bilinear motion contracts passed');
