import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const evidenceUrl = new URL('../src/sam31-memory-attention-evidence.js', import.meta.url);
const smokeHtmlUrl = new URL('../smokes/sam31-memory-attention-parity.html', import.meta.url);
const smokeJsUrl = new URL('../smokes/sam31-memory-attention-parity.js', import.meta.url);
const packetArtifactUrl = new URL('../src/sam31-packet-artifact.js', import.meta.url);
const runnerUrl = new URL('../tools/sam31-memory-attention-browser-parity-smoke.mjs', import.meta.url);
for (const [url, label] of [
  [evidenceUrl, 'attention evidence evaluator'],
  [smokeHtmlUrl, 'attention browser smoke page'],
  [smokeJsUrl, 'attention browser smoke module'],
  [runnerUrl, 'attention browser smoke runner'],
]) assert.equal(existsSync(url), true, `${label} must exist`);

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.match(packageJson.scripts['test:live:sam31-memory-attention-webgpu'] || '', /sam31-memory-attention-browser-parity-smoke\.mjs/);
const smokeSource = readFileSync(smokeJsUrl, 'utf8');
const packetArtifactSource = readFileSync(packetArtifactUrl, 'utf8');
const smokeHtmlSource = readFileSync(smokeHtmlUrl, 'utf8');
const runnerSource = readFileSync(runnerUrl, 'utf8');
assert.doesNotMatch(smokeHtmlSource, /place-items:\s*center/, 'long evidence must start in the viewport instead of centering beyond it');
assert.match(smokeHtmlSource, /overflow-wrap:\s*anywhere/, 'long receipt identities must wrap inside the evidence viewport');
assert.match(smokeSource, /runSam31MemoryAttentionPhaseProgramRoute/);
assert.match(smokeSource, /typeof adapter\.isFallbackAdapter === 'boolean'/);
assert.doesNotMatch(smokeSource, /Boolean\(adapter\.isFallbackAdapter\)/);
assert.match(smokeSource, /requestedRouteId/);
assert.match(smokeSource, /effectiveRouteId/);
assert.match(smokeSource, /numObjPtrTokens/);
assert.match(smokeSource, /mappedTensorCount/);
assert.match(smokeSource, /layerMaxAbsDiffs/, 'browser witness must preserve the four-layer error curve');
assert.match(smokeSource, /layerStageMaxAbsDiffs/, 'browser witness must preserve the self, cross, and MLP sublayer error curve');
assert.match(smokeSource, /crossAttentionInputMaxAbsDiffs/, 'browser witness must localize cross query, key, value, and attention output divergence');
assert.match(smokeSource, /verifySam31PacketFloat32Bytes/, 'browser witness must authenticate fetched tensor bytes');
assert.match(packetArtifactSource, /crypto\.subtle\.digest/, 'packet verifier must hash fetched tensor bytes');
assert.match(packetArtifactSource, /tensor byte hash mismatch/, 'packet verifier must reject fetched bytes that disagree with the manifest');
assert.match(smokeSource, /packetManifest: manifest/, 'browser state must preserve the complete packet manifest');
assert.match(runnerSource, /screenshotPixelCheck/, 'runner must preserve decoded screenshot pixel evidence');
assert.match(runnerSource, /viewportLayout/, 'runner must preserve viewport geometry evidence');
assert.match(runnerSource, /layoutPassed/, 'runner must reject receipt surfaces clipped outside the viewport');
assert.match(runnerSource, /borderSignalFraction/, 'screenshot pixels must place the pass border at the DOM-reported status edge');
assert.match(runnerSource, /nonBlackFraction/, 'runner must reject blank screenshots before claiming primary output');
assert.match(runnerSource, /packetManifest: lastState\?\.packetManifest/, 'durable report must preserve the complete packet manifest');

const { classifySam31MemoryAttentionAdapter, evaluateSam31MemoryAttentionEvidence } = await import(evidenceUrl.href);
assert.deepEqual(classifySam31MemoryAttentionAdapter({ vendor: 'apple', architecture: 'metal-3' }), {
  isFallbackAdapter: false,
  fallbackEvidenceSource: 'recognized-hardware-adapter-info',
});
assert.deepEqual(classifySam31MemoryAttentionAdapter({ vendor: '', architecture: '' }), {
  isFallbackAdapter: null,
  fallbackEvidenceSource: null,
});
assert.deepEqual(classifySam31MemoryAttentionAdapter({ vendor: 'google', architecture: 'swiftshader' }), {
  isFallbackAdapter: true,
  fallbackEvidenceSource: 'software-adapter-info',
});
const routeId = 'sam3.1.memory-attention.phase-program.webgpu-local.v0';
const valid = {
  adapterInfo: { isFallbackAdapter: false },
  requestedRouteId: routeId,
  receipt: { requestedRouteId: routeId, effectiveRouteId: routeId, status: 'real', fallbackReason: null },
  parity: { memoryMaxAbsDiff: 1e-5 },
  tolerance: 1e-3,
  uncapturedErrors: [],
  packet: { mappedTensorCount: 122, layerCount: 4, numObjPtrTokens: 16 },
};
assert.equal(evaluateSam31MemoryAttentionEvidence(valid).passed, true);
assert.equal(evaluateSam31MemoryAttentionEvidence({ ...valid, adapterInfo: {} }).passed, false, 'missing fallback state must fail');
assert.equal(evaluateSam31MemoryAttentionEvidence({ ...valid, receipt: { ...valid.receipt, effectiveRouteId: 'fallback' } }).passed, false, 'route substitution must fail');
assert.equal(evaluateSam31MemoryAttentionEvidence({ ...valid, receipt: { ...valid.receipt, status: 'fallback' } }).passed, false, 'fallback receipt must fail');
assert.equal(evaluateSam31MemoryAttentionEvidence({ ...valid, packet: { ...valid.packet, numObjPtrTokens: 0 } }).passed, false, 'pointer-tail contract drift must fail');
assert.equal(evaluateSam31MemoryAttentionEvidence({ ...valid, parity: { memoryMaxAbsDiff: 2e-3 } }).passed, false, 'numerical overage must fail');

console.log('sam3.1 memory attention browser evidence contracts passed');
