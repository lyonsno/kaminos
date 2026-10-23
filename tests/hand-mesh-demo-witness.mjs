// kaminos-test: node
import assert from 'node:assert/strict';
import { verifyHandDemoReport } from '../demos/hand-mesh/witness-checks.js';
import { verifyVideoResponse } from '../demos/hand-mesh/witness-input.js';
const root = '/owned/tree';
const identity = { backend: 'webgpu-local', mobrecon: { backend: 'webgpu-local', bundleSha256: 'a' }, detector: { backend: 'webgpu-local', bundleSha256: 'b' } };
const report = { runtime: { source: { repoRoot: root, commit: 'source-revision' } }, input: { kind: 'retained-camera-video', sha256: 'input-hash' }, playback: { sha256: 'input-hash', verifiedBlob: true, byteLength: 100 }, errors: [], browserClosed: true, steps: [
  { name: 'import', state: { identity, viewerBackend: 'webgpu' } }, { name: 'live', state: { received: 3, running: true, visible: true } },
  { name: 'miss', state: { misses: 2, presentation: 'no-hand', visible: false, lastTimings: { mobreconMs: 0 } } },
  { name: 'stop', state: { running: false, cameraState: 'off', visible: false } }, { name: 'reload', state: { source: 'browser-storage' } },
  ...['reacquire', 'restart', 'cancel-pending', 'invalid-import', 'corrupt-import', 'camera-failure', 'mobile'].map(name => ({ name })),
] };
assert.deepEqual(verifyHandDemoReport(report, root), []);
for (const mutate of [r => r.runtime.source.repoRoot = '/wrong', r => delete r.runtime.source.commit, r => r.steps[0].state.identity.detector.backend = 'cpu', r => r.steps[0].state.viewerBackend = 'fallback', r => r.steps[1].state.received = 0, r => r.steps[2].state.lastTimings.mobreconMs = 8, r => r.steps.splice(4, 1), r => r.browserClosed = false, r => r.errors.push('device error')]) {
  const bad = structuredClone(report); mutate(bad); assert.ok(verifyHandDemoReport(bad, root).length, 'false closure must fail');
}
assert.ok(verifyHandDemoReport({ phase: 'browser', steps: [] }, root).length);
const wrongInput = structuredClone(report); wrongInput.input.sha256 = 'different-retained-video';
assert.ok(verifyHandDemoReport(wrongInput, root).length, 'a different retained file must not receipt the video actually played');
const missingPlayback = structuredClone(report); delete missingPlayback.playback;
assert.ok(verifyHandDemoReport(missingPlayback, root).length, 'missing browser playback identity must fail');
const bytes = new TextEncoder().encode('exact input bytes');
const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const verified = await verifyVideoResponse({ response: new Response(bytes), expectedSha256: sha256, sourceUrl: '/retained-video' });
assert.equal(verified.identity.sha256, sha256);
assert.deepEqual(new Uint8Array(await verified.blob.arrayBuffer()), bytes, 'the played Blob must contain the exact verified bytes');
await assert.rejects(verifyVideoResponse({ response: new Response('other bytes'), expectedSha256: sha256, sourceUrl: '/other-video' }), /SHA-256 mismatch/);
await assert.rejects(verifyVideoResponse({ response: new Response('', { status: 503 }), expectedSha256: sha256, sourceUrl: '/unavailable' }), /HTTP 503/);
console.log('hand demo witness false-closure controls passed');
