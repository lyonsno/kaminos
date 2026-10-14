import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { persistSamCaptureObservation } from '../sam-image-witness-report.mjs';

const witness = new URL('../sam-image-witness.mjs', import.meta.url);
assert.ok(existsSync(witness), 'the actual Kaminos consumer needs a rerunnable image-to-export witness');
const consumer = await import(witness);
const { validateSamConsumerOutput } = consumer;
const output = { invocationId: 'new', promptText: 'wheel', outputAuthority: 'actual-webgpu-readback',
  verificationState: 'not-attached', effectiveRouteId: 'sam3.detr-encoder.phase-program.webgpu-local.v0',
  receiptChain: ['sam3.mask-tail.phase-program.webgpu-local.v0'],
  width: 288, height: 288, imageCache: { status: 'miss' },
  instances: [{ index: 7, score: 0.9, mask: [1], logits: [2] }],
};
const expected = { prompt: 'wheel', empty: false, previousId: null, cache: 'miss' };
assert.throws(() => validateSamConsumerOutput(output, expected), /partial/, 'partial tensors cannot close the live-output gate');
output.instances[0].mask = new Uint8Array(288 * 288).fill(1);
output.instances[0].logits = new Float32Array(288 * 288).fill(2);
validateSamConsumerOutput(output, expected);
for (const override of [{ outputAuthority: 'cpu-oracle' }, { verificationState: 'reference-parity' },
  { promptText: 'truck' }, { width: 64 }, { instances: [] }, { imageCache: { status: 'hit' } }]) {
  assert.throws(() => validateSamConsumerOutput({ ...output, ...override }, expected));
}
assert.throws(() => validateSamConsumerOutput(output, { ...expected, previousId: 'new' }), /reused/);
assert.throws(() => validateSamConsumerOutput(output, { ...expected, empty: true }), /empty/);
const captureReport = { captures: [] };
let durableCapture = null;
const failedMobileCapture = persistSamCaptureObservation({ report: captureReport, name: 'windows-mobile',
  path: '/evidence/windows-mobile.png', pixels: { viewportWidth: 390, documentScrollWidth: 412,
    bodyScrollWidth: 412, overflowingElements: [{ id: 'sam-image-results', right: 412 }] },
  saveReport: () => { durableCapture = JSON.parse(JSON.stringify(captureReport)); },
});
assert.equal(failedMobileCapture.validation, 'pending');
assert.equal(durableCapture.captures[0].pixels.documentScrollWidth, 412,
  'failed mobile assertions must retain the viewport and document width before validation');
assert.throws(() => {
  if (failedMobileCapture.pixels.documentScrollWidth > failedMobileCapture.pixels.viewportWidth) {
    throw new Error('horizontal overflow');
  }
}, /horizontal overflow/);
assert.equal(durableCapture.captures[0].validation, 'pending',
  'a failed capture must remain visibly unvalidated in the durable report');
const live = { sameDevice: true, sameRendererDevice: true, invocation: { invocationId: 'new', startedAtMs: 10, completedAtMs: 100 },
  foreground: { failure: null, inputs: [{ id: 1, receivedAtMs: 30, type: 'wheel', trusted: true, zoom: 2, panX: 0, panY: 0 }],
    frames: [{ submittedAtMs: 5, inputIds: [], zoom: 1, panX: 0, panY: 0 },
      { submittedAtMs: 40, inputIds: [1], zoom: 2, panX: 0, panY: 0 }] } };
assert.equal(typeof consumer.validateSamConsumerInteraction, 'function', 'live consumer gate must inspect input-correlated submissions inside inference bounds');
consumer.validateSamConsumerInteraction(live, 'new');
for (const change of [
  { sameDevice: false }, { sameRendererDevice: false }, { invocation: { ...live.invocation, invocationId: 'old' } },
  { foreground: { ...live.foreground, inputs: [] } },
  { foreground: { ...live.foreground, frames: [live.foreground.frames[0]] } },
  { foreground: { ...live.foreground, frames: [live.foreground.frames[0], { ...live.foreground.frames[1], submittedAtMs: 101 }] } },
  { foreground: { ...live.foreground, frames: [live.foreground.frames[0], { ...live.foreground.frames[1], zoom: 1 }] } },
]) assert.throws(() => consumer.validateSamConsumerInteraction({ ...live, ...change }, 'new'));
assert.equal(typeof consumer.validateSamConsumerExport, 'function', 'persisted export gate must inspect decoded pixels and identity, not just a download event');
const exported = { mimeType: 'image/png', width: 2, height: 1, pixels: Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 255]),
  sha256: 'sha256:export', source: '/api/read?root=image-inbox&path=export.png', name: 'wheel-mask.png' };
const sourcePixels = Uint8Array.from([42, 43, 44, 255, 10, 20, 30, 255]);
const exportContract = { kind: 'mask', width: 2, height: 1, mask: Uint8Array.from([1, 0]), sourcePixels,
  libraryEntry: { ...exported, pixels: undefined } };
consumer.validateSamConsumerExport(exported, exportContract);
for (const change of [{ width: 1 }, { mimeType: 'image/jpeg' }, { pixels: new Uint8Array(8) },
  { sha256: 'sha256:stale' }, { source: '/old.png' }]) {
  assert.throws(() => consumer.validateSamConsumerExport({ ...exported, ...change }, exportContract));
}
consumer.validateSamConsumerExport({ ...exported, pixels: Uint8Array.from([42, 43, 44, 255, 0, 0, 0, 0]) }, { ...exportContract, kind: 'cutout' });
assert.throws(() => consumer.validateSamConsumerExport({ ...exported, pixels: sourcePixels }, { ...exportContract, kind: 'cutout' }), /alpha/);
assert.equal(typeof consumer.validateSamApplicationForeground, 'function',
  'native consumer must reject missing or stale application foreground evidence');
const ownerRoute = 'sam3.resident-model-owner.webgpu-local.v0';
const appEvidence = { sameDevice: true, sameRendererDevice: true, runtime: {
  applicationForegroundEvidence: { status: 'idle', error: null, routeId: ownerRoute,
    lastRun: { status: 'succeeded', runId: 'new', routeId: ownerRoute, pendingRequestCount: 0,
      receipts: [{ status: 'completed', runId: 'new', routeId: ownerRoute, failure: null,
        metadata: { renderer: 'kaminos-app' }, result: { sceneFrameCount: 1,
          sceneFrameCountBefore: 0, sceneFrameCountAfter: 1, sceneDrawn: true,
          sceneAuthority: 'three-render-returned-inside-service-not-presentation' } }] } } } };
consumer.validateSamApplicationForeground(appEvidence, 'new');
for (const mutate of [value => { value.runtime = null; }, value => { value.sameDevice = false; },
  value => { value.runtime.applicationForegroundEvidence.lastRun.runId = 'old'; },
  value => { value.runtime.applicationForegroundEvidence.lastRun.routeId = 'fallback'; },
  value => { value.runtime.applicationForegroundEvidence.status = 'settlement-failed'; },
  value => { value.runtime.applicationForegroundEvidence.lastRun.receipts = []; },
  value => { value.runtime.applicationForegroundEvidence.lastRun.receipts[0].metadata = {}; },
  value => { value.runtime.applicationForegroundEvidence.lastRun.receipts[0].result = { status: 'submitted' }; },
  value => { value.runtime.applicationForegroundEvidence.lastRun.receipts[0].result.sceneFrameCount = 0; },
  value => { const result = value.runtime.applicationForegroundEvidence.lastRun.receipts[0].result;
    result.sceneFrameCountBefore = 1; result.sceneFrameCountAfter = 1; },
  value => { value.runtime.applicationForegroundEvidence.lastRun.receipts[0].failure = { message: 'failed' }; }]) {
  const value = structuredClone(appEvidence); mutate(value);
  assert.throws(() => consumer.validateSamApplicationForeground(value, 'new'));
}
const staleFrame = structuredClone(appEvidence.runtime.applicationForegroundEvidence.lastRun.receipts[0]);
staleFrame.result = { sceneFrameCount: 7, sceneFrameCountBefore: 7, sceneFrameCountAfter: 7,
  sceneDrawn: true, sceneAuthority: 'three-render-returned-inside-service-not-presentation' };
assert.throws(() => consumer.validateSamApplicationFrame(staleFrame), /draw|count/,
  'an already-positive cumulative count without a new draw cannot close the unload gate');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const frameStart = html.indexOf('    runForegroundFrame(run) {');
const frameEnd = html.indexOf('    async presentGlb(', frameStart);
const renderStart = html.indexOf('  function renderSceneFrame() {');
const renderEnd = html.indexOf('\n  }\n', renderStart) + 6;
assert.ok(frameStart >= 0 && frameEnd > frameStart && renderStart >= 0 && renderEnd > renderStart);
const skippedHost = vm.runInNewContext(`${html.slice(renderStart, renderEnd)}\n({${html.slice(frameStart, frameEnd).trim().replace(/,$/, '')}})`, {
  foregroundServiceActive: true, insideForegroundFrame: false, sceneRenderedForVolume: false, sceneFrameCount: 7,
  exclusiveInspectionRender: false, manualInspectionRender: false, renderer: {},
  document: { getElementById: () => ({ value: 'custom' }) }, THREE: { ACESFilmicToneMapping: 1, AgXToneMapping: 2 },
  window: { __kaminosSceneRadiance: { canRender: () => false } },
  syncViewportRendererSize() {}, camera: { updateMatrixWorld() {} }, fireLightFieldPass: null,
});
const skippedReceipt = { ...appEvidence.runtime.applicationForegroundEvidence.lastRun.receipts[0],
  result: skippedHost.runForegroundFrame(() => ({ status: 'submitted' })) };
assert.equal(skippedReceipt.result.sceneFrameCountBefore, 7);
assert.equal(skippedReceipt.result.sceneFrameCountAfter, 7);
assert.throws(() => consumer.validateSamApplicationFrame(skippedReceipt), /skipped/);
const onlySkipped = structuredClone(appEvidence);
onlySkipped.runtime.applicationForegroundEvidence.lastRun.receipts = [skippedReceipt];
assert.throws(() => consumer.validateSamApplicationForeground(onlySkipped, 'new'), /no new/);
const mixed = structuredClone(appEvidence);
mixed.runtime.applicationForegroundEvidence.lastRun.receipts.push(skippedReceipt);
assert.equal(consumer.validateSamApplicationForeground(mixed, 'new').renderedCallbacks, 1,
  'truthful skipped frames remain recorded without substituting for actual renders');
assert.equal(typeof consumer.validateSamExportProvenance, 'function',
  'native export must match persisted PNG provenance to the live source and selection');
const source = { source: '/source.png', sha256: 'sha256:source', artifactId: 'source-1' };
const pngProvenance = { schema: 'kaminos.sam3-mask-export.v1', kind: 'cutout',
  sourceImage: source.source, sourceImageSha256: source.sha256, sourceArtifactId: source.artifactId,
  sourceResolution: [2, 1], promptText: output.promptText, promptSha256: 'sha256:prompt',
  invocationId: 'new', indices: [7], maskResolution: [288, 288],
  effectiveRouteId: output.effectiveRouteId, outputAuthority: output.outputAuthority,
  verificationState: output.verificationState };
const provenanceContract = { kind: 'cutout', source, output: { ...output, promptSha256: 'sha256:prompt' },
  indices: [7], width: 2, height: 1 };
consumer.validateSamExportProvenance(pngProvenance, provenanceContract);
consumer.validateSamExportProvenance({ ...pngProvenance, futureField: true }, provenanceContract);
for (const change of [null, {}, { ...pngProvenance, invocationId: 'old' },
  { ...pngProvenance, sourceImageSha256: 'sha256:stale' }, { ...pngProvenance, indices: [] },
  { ...pngProvenance, outputAuthority: 'cpu-oracle' }, { ...pngProvenance, promptSha256: 'sha256:other' }]) {
  assert.throws(() => consumer.validateSamExportProvenance(change, provenanceContract));
}
assert.equal(typeof consumer.validateSamNativeSourceHandoff, 'function',
  'native entry must retain the selected library image at the actual Masks action');
const nativeEntry = { selected: { source: '/source.png', sha256: 'sha256:source', kind: 'image' },
  source: { source: '/source.png', sha256: 'sha256:source' }, mode: 'workbench', maskPanelActive: true };
consumer.validateSamNativeSourceHandoff(nativeEntry, 'sha256:source');
for (const mutate of [value => { value.selected = null; }, value => { value.source = null; },
  value => { value.source.source = '/other.png'; }, value => { value.source.sha256 = 'sha256:old'; },
  value => { value.maskPanelActive = false; }, value => { value.mode = 'authoring'; }]) {
  const value = structuredClone(nativeEntry); mutate(value);
  assert.throws(() => consumer.validateSamNativeSourceHandoff(value, 'sha256:source'));
}
assert.equal(typeof consumer.validateSamMaskControls, 'function', 'hidden Masks controls must fail explicitly before waiting on an action');
const controls = { mode: 'workbench', tab: 'masks', promptVisible: true, runVisible: true, runDisabled: false, failed: false };
consumer.validateSamMaskControls(controls);
for (const change of [{ mode: 'authoring' }, { tab: 'assets' }, { promptVisible: false },
  { runVisible: false }, { runDisabled: true }, { failed: true }]) {
  assert.throws(() => consumer.validateSamMaskControls({ ...controls, ...change }));
}
assert.equal(typeof consumer.resolveSamWitnessBrowser, 'function', 'headless admission needs physical browser identity');
const browserRoot = mkdtempSync(join(tmpdir(), 'sam-witness-browser-'));
const gui = join(browserRoot, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome');
mkdirSync(join(browserRoot, 'Google Chrome.app', 'Contents', 'MacOS'), { recursive: true });
writeFileSync(gui, 'local path-policy fixture; not a browser');
const alias = join(browserRoot, 'chrome-alias'); symlinkSync(gui, alias);
assert.throws(() => consumer.resolveSamWitnessBrowser(alias), /independent/);
const independent = join(browserRoot, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
mkdirSync(join(browserRoot, 'Google Chrome for Testing.app', 'Contents', 'MacOS'), { recursive: true });
writeFileSync(independent, 'local path-policy fixture; not a browser');
const cftAlias = join(browserRoot, 'cft-alias'); symlinkSync(independent, cftAlias);
assert.equal(consumer.resolveSamWitnessBrowser(cftAlias).effective, realpathSync(independent));
const out = mkdtempSync(join(tmpdir(), 'kaminos-sam-consumer-'));
const result = spawnSync(process.execPath, [witness.pathname, '--out-dir', out, '--expected-commit', 'not-the-source'], { encoding: 'utf8' });
assert.notEqual(result.status, 0);
const failure = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'source-identity');
assert.equal(failure.runs.length, 0);
console.log('Kaminos SAM consumer witness falsifiers passed');
