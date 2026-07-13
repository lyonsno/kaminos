import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createSam3BrowserStaticArtifactCache,
  createSam3DualInvocationEvidence,
} from '../src/sam-browser-package-manifest.js';
import * as samBrowserPackageManifest from '../src/sam-browser-package-manifest.js';

const root = new URL('..', import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSource = readFileSync(new URL('../src/sam-mask-decoder-island.js', import.meta.url), 'utf8');
const smokeHtml = readFileSync(new URL('../smokes/sam-mask-island-parity.html', import.meta.url), 'utf8');
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const diagnosticReplay = readFileSync(new URL('../tools/sam-browser-diagnostic-mlx-replay.py', import.meta.url), 'utf8');
const toleranceCalibration = JSON.parse(readFileSync(new URL('../tools/sam-gate-u-tolerance-calibration.json', import.meta.url), 'utf8'));
const composedSamRouteFiles = [
  'sam-image-preprocess-phase-program.js',
  'sam-image-patch-embed-phase-program.js',
  'sam-image-vit-prefix-phase-program.js',
  'sam-image-vit-first-block-phase-program.js',
  'sam-image-vit-block-stack-phase-program.js',
  'sam-image-fpn-neck-phase-program.js',
  'sam-prompt-text-ingress-phase-program.js',
  'sam-detr-encoder-phase-program.js',
  'sam-prompt-fpn-phase-program.js',
  'sam-pixel-decoder-phase-program.js',
  'sam-detr-decoder-phase-program.js',
  'sam-scoring-phase-program.js',
  'sam-selection-postprocess-phase-program.js',
  'sam-mask-tail-phase-program.js',
];

assert.ok(packageJson.files.includes('smokes'), 'package must publish the browser smoke page');
assert.ok(packageJson.files.includes('tools'), 'package must publish the browser smoke witness tool');
assert.match(packageJson.scripts.test, /sam-mask-island-browser-parity-smoke-contracts\.mjs/, 'package test script must include browser parity smoke contracts');

assert.match(routeSource, /includeReadback/, 'route runner must expose explicit opt-in readback evidence for parity smoke');
assert.match(routeSource, /debugReadback/, 'route runner must label raw readback as debug evidence, not receipt truth');

assert.match(smokeHtml, /sam-mask-island-parity\.js/, 'smoke page must load the parity module');
assert.match(smokeHtml, /sam-mask-parity-canvas/, 'smoke page must expose a visible mask parity canvas');
assert.match(smokeHtml, /sam-source-image/, 'smoke page must expose the source image panel');

assert.match(smokeJs, /navigator\.gpu/, 'browser smoke must require a real browser WebGPU adapter');
assert.match(smokeJs, /requestAdapter/, 'browser smoke must request an effective adapter');
assert.match(smokeJs, /runSam3MaskDecoderIslandRoute/, 'browser smoke must run the package route runner');
assert.match(smokeJs, /runSam3MaskTailPhaseProgramRoute/, 'browser smoke must run the mask-tail phase-program route runner');
assert.match(smokeJs, /runSam3PixelDecoderPhaseProgramRoute/, 'browser smoke must run the pixel-decoder phase-program route runner');
assert.match(smokeJs, /runSam3PromptFpnPhaseProgramRoute/, 'browser smoke must run the prompt-FPN phase-program route runner');
assert.match(smokeJs, /runSam3DetrEncoderPhaseProgramRoute/, 'browser smoke must run the DETR encoder phase-program route runner');
assert.match(smokeJs, /runSam3DetrDecoderPhaseProgramRoute/, 'browser smoke must run the DETR decoder phase-program route runner');
assert.match(smokeJs, /runSam3ScoringPhaseProgramRoute/, 'browser smoke must run the SAM3 scoring phase-program route runner');
assert.match(smokeJs, /createSam3MaskProjectionCpuOracle/, 'browser smoke must compare against the CPU oracle');
assert.match(smokeJs, /createSam3MaskTailPhaseProgramCpuOracle/, 'browser smoke must compare mask-tail packets against the CPU oracle');
assert.match(smokeJs, /createSam3PixelDecoderPhaseProgramCpuOracle/, 'browser smoke must compare pixel-decoder packets against the CPU oracle');
assert.match(smokeJs, /createSam3PromptFpnPhaseProgramCpuOracle/, 'browser smoke must compare prompt-FPN packets against the CPU oracle');
assert.match(smokeJs, /samMaskIslandParitySmokeState/, 'browser smoke must expose an explicit debug state hook');
assert.match(smokeJs, /fullSam3BrowserExecution:\s*false/, 'browser smoke must preserve the bounded island claim');
assert.match(smokeJs, /manifest\.staticWeights/, 'browser smoke must preserve synthetic static-weight identity');
assert.doesNotMatch(smokeJs, /weightsHash:\s*embeddingTensor\.sha256/, 'browser smoke must not pretend the input embedding is a weights hash');
assert.match(smokeJs, /SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID/, 'browser smoke must route by manifest route identity');
assert.match(smokeJs, /SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID/, 'browser smoke must route pixel-decoder manifests by route identity');
assert.match(smokeJs, /SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID/, 'browser smoke must route prompt-FPN manifests by route identity');
assert.match(smokeJs, /SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID/, 'browser smoke must route DETR encoder manifests by route identity');
assert.match(smokeJs, /SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID/, 'browser smoke must route DETR decoder manifests by route identity');
assert.match(smokeJs, /SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID/, 'browser smoke must route SAM3 scoring manifests by route identity');
assert.match(smokeJs, /sam3-mask-tail-tensors/, 'browser smoke must preserve mask-tail tensor input identity');
assert.match(smokeJs, /sam3-pixel-decoder-tensors/, 'browser smoke must preserve pixel-decoder tensor input identity');
assert.match(smokeJs, /sam3-prompt-fpn-tensors/, 'browser smoke must preserve prompt-FPN tensor input identity');
assert.match(smokeJs, /sam3-detr-encoder-tensors/, 'browser smoke must preserve DETR encoder tensor input identity');
assert.match(smokeJs, /sam3-detr-decoder-tensors/, 'browser smoke must preserve DETR decoder tensor input identity');
assert.match(smokeJs, /mask-embedder-layer-0-weight/, 'browser smoke must load real mask embedder weights for mask-tail');
assert.match(smokeJs, /pixel-decoder-stage-0-conv-weight/, 'browser smoke must load real pixel-decoder weights');
assert.match(smokeJs, /sourceImage/, 'browser smoke must preserve source image identity');
assert.match(smokeJs, /sourceImageShape/, 'browser smoke must derive source artifact shape through a named helper');
assert.match(smokeJs, /aggregateTensorBundleSha256/, 'browser smoke must compute aggregate tensor bundle identities');
assert.match(smokeJs, /manifest\.sourceImage\?\.resolution/, 'browser smoke must use sourceImage.resolution for source artifact shape when present');
assert.doesNotMatch(smokeJs, /shape:\s*\[1\]/, 'browser smoke must not put fake placeholder shapes on aggregate packet artifacts');
assert.doesNotMatch(smokeJs, /sha256:\s*payload\.tensorIdentity\.fpnFeatureSha256\['fpn-feature-0'\]/, 'pixel route receipt must not identify the tensor bundle only by fpn-feature-0');
assert.match(smokeJs, /pixelResult\.receipt\.outputs/, 'downstream mask-tail receipt must reference the upstream pixel route output');
assert.match(smokeJs, /pixelEmbedOutput/, 'browser smoke must preserve the pixel output identity as the composition edge');
assert.match(smokeJs, /promptFpnOutput/, 'browser smoke must preserve the prompt-FPN output identity as the upstream composition edge');
assert.match(smokeJs, /encoderHiddenStatesOutput/, 'browser smoke must preserve the DETR encoder output identity as the upstream composition edge');
assert.match(smokeJs, /detrEncoderOutput/, 'browser smoke must preserve DETR encoder output identity when feeding the DETR decoder');
assert.match(smokeJs, /decoderTensorSha256/, 'browser smoke must bind DETR encoder output into the DETR decoder tensor receipt');
assert.match(smokeJs, /lastHsOutput/, 'browser smoke must preserve the DETR decoder last-hs output identity as the upstream composition edge');
assert.match(smokeJs, /referenceBoxesOutput/, 'browser smoke must preserve the DETR decoder reference-box output identity');
assert.match(smokeJs, /presenceLogitsOutput/, 'browser smoke must preserve the DETR decoder presence-logits output identity');
assert.match(smokeJs, /detr-encoder-detr-decoder-mask-tail-composition/, 'browser smoke must expose contiguous DETR encoder -> decoder -> mask-tail composition');
assert.match(smokeJs, /compositionRouteReceipts/, 'browser smoke must preserve the full DETR/prompt-FPN/pixel/mask-tail receipt chain');
assert.match(smokeJs, /midstreamRouteReceipt:\s*null/, 'browser smoke state must reserve a midstream route receipt slot');
assert.match(smokeJs, /state\.midstreamRouteReceipt\s*=\s*result\.midstreamRouteReceipt/, 'browser smoke must persist the pixel route receipt for prompt-FPN composition');
assert.match(smokeJs, /selectedMaskIndex/, 'browser smoke must render a selected reference/webgpu mask');
assert.match(smokeJs, /drawVisualWitness/, 'browser smoke must draw source/reference/webgpu/diff witness panels');
assert.match(smokeJs, /drawSourcePanel/, 'browser smoke must handle packets without a source image file');
assert.match(smokeJs, /synthetic source/i, 'browser smoke must visibly label synthetic source placeholders');
assert.match(smokeJs, /maskLogitsMaxAbsDiff/, 'browser smoke must report logits diff');
assert.match(smokeJs, /lastHsMaxAbsDiff/, 'browser smoke must report DETR decoder last-hs diff');
assert.match(smokeJs, /referenceBoxesMaxAbsDiff/, 'browser smoke must report DETR decoder reference-box diff');
assert.match(smokeJs, /presenceLogitsMaxAbsDiff/, 'browser smoke must report DETR decoder presence-logit diff');
assert.match(smokeJs, /predLogitsMaxAbsDiff/, 'browser smoke must report SAM3 scoring logit diff');
assert.match(smokeJs, /binaryMismatchCount/, 'browser smoke must report binary mismatch count');
assert.match(smokeJs, /collectBinaryThresholdMismatchEvidence/, 'browser smoke must diagnose binary threshold flips against logits');
assert.match(smokeJs, /binaryThresholdMismatchEvidence/, 'browser smoke state must preserve binary threshold mismatch evidence on failure');
assert.match(smokeJs, /state\.preDecoderCheckpointEvidence\s*=\s*\{/, 'browser smoke must publish compact upstream evidence before entering the DETR decoder');
assert.match(smokeJs, /encoderHiddenStatesMaxAbsDiff:\s*maxAbsDiff\(expectedEncoderHiddenStates, gpuEncoderHiddenStates\)/, 'pre-decoder evidence must include effective encoder parity');
assert.match(smokeJs, /window\.runSam3Invocation/, 'browser smoke must expose a same-page invocation entry point');
assert.match(smokeJs, /staticArtifactCache/, 'browser smoke must route package-owned artifacts through a persistent cache');
assert.doesNotMatch(smokeJs, /run\.finally\(/, 'same-page invocation cleanup must not create an unobserved rejected promise');
assert.match(smokeJs, /run\.then\([\s\S]*clearInvocation[\s\S]*clearInvocation/, 'same-page invocation cleanup must release the in-flight guard on both fulfillment and rejection');
assert.match(smokeJs, /window\.samMaskIslandDiagnosticReadback/, 'browser smoke must expose opt-in full pre-decoder diagnostic readback');
assert.match(smokeJs, /tensorName/, 'browser diagnostic hook must support one-tensor reads so CDP transport does not require one giant by-value result');
assert.match(smokeJs, /base64Offset[\s\S]*base64Length[\s\S]*base64TotalLength/, 'browser diagnostic hook must expose bounded base64 ranges for individually large tensors');
assert.match(smokeJs, /encoderHiddenStates[\s\S]*encoderPos[\s\S]*promptFeatures[\s\S]*promptMask[\s\S]*pixelEmbed[\s\S]*decoderHiddenStates[\s\S]*lastHs[\s\S]*maskLogits/, 'diagnostic readback must preserve both decoder inputs and browser outputs needed to isolate amplification');
for (const file of composedSamRouteFiles) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  assert.match(source, /authoritative\.resourceDisposal\s*=\s*runtime\.dispose\(\);\s*\n\s*return authoritative;/, `${file} must release route-owned GPU buffers after preserving its readbacks and receipt`);
}

assert.match(witness, /--enable-unsafe-webgpu/, 'witness must launch Chrome with WebGPU enabled');
assert.match(witness, /--diagnostic-dir/, 'witness must accept a caller-owned diagnostic artifact directory');
assert.match(witness, /samMaskIslandDiagnosticReadback/, 'witness must retrieve browser diagnostic tensors before enforcing strict parity status');
assert.match(witness, /writeDiagnosticReadback/, 'witness must persist diagnostic tensors directly instead of requiring terminal transcription');
assert.match(witness, /for \(const tensorName of requiredDiagnosticTensorNames\)/, 'witness must retrieve diagnostic tensors in bounded per-tensor CDP messages');
assert.match(witness, /diagnosticBase64ChunkCharacters\s*=\s*262144/, 'witness must cap each diagnostic CDP value below the measured large-message stall boundary');
assert.match(witness, /base64Offset[\s\S]*base64TotalLength/, 'witness must reassemble each diagnostic tensor from explicit bounded ranges');
assert.match(witness, /diagnosticReadbackEvidence/, 'witness report must retain diagnostic artifact identities on pass or failure');
assert.match(diagnosticReplay, /--browser-report/, 'diagnostic replay must consume the witness report instead of caller-transcribed tensor paths');
assert.match(diagnosticReplay, /--packet-dir/, 'diagnostic replay must bind canonical MLX outputs and package shape from the packet root');
assert.match(diagnosticReplay, /checkpoint_parameter_audit/, 'diagnostic replay must preserve effective MLX checkpoint identity before drawing numerical conclusions');
assert.match(diagnosticReplay, /browserDiagnosticEvidence/, 'diagnostic replay report must retain the authenticated browser tensor evidence it consumed');
assert.match(diagnosticReplay, /mlxReplayVsCanonical/, 'diagnostic replay must compare the MLX decoder fed browser intermediates against canonical MLX outputs');
assert.match(diagnosticReplay, /browserVsMlxReplay/, 'diagnostic replay must directly quantify the WebGPU decoder residual against MLX replay on identical inputs');
assert.match(diagnosticReplay, /binaryMismatchCount/, 'diagnostic replay must measure thresholded mask disagreement, not only floating-point distance');
assert.match(diagnosticReplay, /failurePhase/, 'diagnostic replay must preserve the failure phase when it cannot produce numerical evidence');
assert.match(diagnosticReplay, /lastTrustedEvidence/, 'diagnostic replay must distinguish authenticated inputs from conclusions after a failure');
assert.match(witness, /Chrome DevTools endpoint did not open/, 'witness must use CDP with loud startup failure');
assert.match(witness, /samMaskIslandParitySmokeState/, 'witness must poll the browser debug state');
assert.match(witness, /kaminos\.sam3-mask-island\.browser-parity-smoke\.v0/, 'witness report must be schema stamped');
assert.match(witness, /primary_output_written/, 'witness must write whether the primary artifact was preserved');
assert.match(witness, /failure_phase/, 'witness must record failure phase');
assert.match(witness, /fullStackTimeoutMs\s*=\s*isImageFpnNeckPacketMode\(packetMode\)\s*\?\s*600000\s*:\s*20000/, 'full image-FPN composition must default to a measured non-shadowing witness timeout');
assert.match(witness, /function wsRequest\(ws, method, params = \{\}, timeoutMs = cdpTimeoutMs\)/, 'CDP requests must accept an invocation-scoped timeout');
assert.match(witness, /async function evaluate\(ws, expression, timeoutMs = cdpTimeoutMs\)/, 'browser state reads must accept an invocation-scoped timeout');
assert.match(witness, /evaluate\(ws, `[\s\S]+?`, Math\.min\(cdpTimeoutMs, remainingHookWaitMs\)\)/, 'each browser state read must be bounded by the remaining hook deadline');
assert.match(witness, /--reuse-oracle-packet/, 'witness must support hash-verified reuse of an existing oracle packet');
assert.match(witness, /oraclePacketSource/, 'witness report must distinguish generated from caller-provided packet state');
assert.match(witness, /reused oracle packet manifest missing/, 'packet reuse must fail loud when the requested root manifest is absent');
assert.match(witness, /requestedRouteId/, 'witness must preserve requested route identity');
assert.match(witness, /effectiveRouteId/, 'witness must preserve effective route identity');
assert.match(witness, /backendIdentity/, 'witness must preserve browser backend identity');
assert.match(witness, /tensorPacket/, 'witness must preserve tensor packet identity');
assert.match(witness, /--packet-tool/, 'witness must allow a real boundary packet exporter');
assert.match(witness, /mlx-mask-tail-export/, 'witness must allow a real mask-tail packet exporter');
assert.match(witness, /mlx-pixel-decoder-export/, 'witness must allow a real pixel-decoder packet exporter');
assert.match(witness, /mlx-prompt-fpn-export/, 'witness must allow a real prompt-FPN packet exporter');
assert.match(witness, /mlx-detr-encoder-export/, 'witness must allow a real DETR encoder packet exporter');
assert.match(witness, /mlx-detr-decoder-export/, 'witness must allow a real DETR decoder packet exporter');
assert.match(witness, /mlx-detr-stack-export/, 'witness must allow a real contiguous DETR stack packet exporter');
assert.match(witness, /mlx-scoring-export/, 'witness must allow a real SAM3 scoring packet exporter');
assert.match(witness, /MASK_TAIL_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve mask-tail route identity');
assert.match(witness, /PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve pixel-decoder route identity');
assert.match(witness, /PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve prompt-FPN route identity');
assert.match(witness, /DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve DETR encoder route identity');
assert.match(witness, /DETR_DECODER_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve DETR decoder route identity');
assert.match(witness, /SCORING_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve SAM3 scoring route identity');
assert.match(witness, /lastHsSha256/, 'witness must preserve mask-tail tensor identity');
assert.match(witness, /expectedLastHsSha256/, 'witness must preserve DETR decoder last-hs tensor identity');
assert.match(witness, /expectedReferenceBoxesSha256/, 'witness must preserve DETR decoder reference-box tensor identity');
assert.match(witness, /expectedPresenceLogitsSha256/, 'witness must preserve DETR decoder presence tensor identity');
assert.match(witness, /expectedPixelEmbedSha256/, 'witness must preserve pixel-decoder tensor identity');
assert.match(witness, /sourceImage/, 'witness report must preserve source image identity');
assert.match(witness, /midstreamRouteReceipt/, 'witness report must preserve midstream pixel route receipt identity');
assert.match(witness, /pixelTensorSha256/, 'witness must assert prompt-FPN output composition into the pixel route tensor input');
assert.match(witness, /downstreamTensorSha256/, 'witness must assert pixel output composition into the mask-tail tensor input');
assert.match(witness, /encoderTensorSha256/, 'witness must assert DETR output composition into the prompt-FPN tensor input');
assert.match(witness, /decoderTensorSha256/, 'witness must assert DETR encoder output composition into the DETR decoder tensor input');
assert.match(witness, /lastHsOutput/, 'witness must assert DETR decoder last-hs output composition into the mask-tail tensor input');
assert.match(witness, /compositionRouteReceipts/, 'witness report must preserve the full composed route receipt chain');
assert.match(witness, /rootManifest\s*=\s*JSON\.parse/, 'witness must load the generated root packet manifest');
assert.match(witness, /manifest:\s*packetManifest,\s*evidence:\s*packageInvocationEvidence/, 'witness must resolve the effective hash-bound packet before using routed tolerances');
assert.match(witness, /manifestTolerance\('binaryMismatchCount',\s*8\)/, 'witness must use packet binary mismatch tolerance for detector-stack modes');
assert.match(witness, /manifestTolerance\('selectedBoxMaxAbsDiff',\s*0\.0001\)/, 'witness must use packet selected-box tolerance for detector-stack modes');
assert.match(witness, /manifestTolerance\('webGpuLogitsMaxAbsDiff',\s*0\.0001\)/, 'witness must use packet mask-logits tolerance for detector-stack modes');
assert.match(witness, /browserFpnDetrIngressEvidence:\s*lastState\?\.browserFpnDetrIngressEvidence/, 'witness report must preserve browser FPN-derived DETR ingress evidence at top level');
assert.match(witness, /imageFpnNeck browser DETR ingress evidence missing/, 'witness must assert browser FPN-derived DETR ingress evidence for image-FPN-neck packets');
assert.match(witness, /--second-oracle-dir/, 'witness must support a second independently verified invocation packet');
assert.match(witness, /dualInvocationEvidence/, 'witness must preserve same-package dual-invocation freshness evidence');
assert.match(witness, /staticHashVerificationFailureCount/, 'dual witness must reject any failed static package payload authentication');
assert.match(witness, /staticHashVerificationCount\s*!==\s*firstCache\.staticNetworkLoadCount/, 'dual witness must prove every static network payload was authenticated before reuse');
assert.equal(toleranceCalibration.acceptanceBudget.imagePatchEmbedCpuMaxAbsDiff, 0.000012, 'Gate U calibration must cover the grounded released-checkpoint CPU patch-embed residual');
assert.match(witness, /manifestTolerance\('imagePatchEmbedCpuMaxAbsDiff',\s*0\.000002\)/, 'terminal witness must consume the packet-owned patch-embed CPU budget instead of shadowing it');

const staticNetworkLoads = [];
const staticArrayBytes = new Uint8Array([1, 2, 3, 4]);
const staticTextValue = 'text:/tokenizer/vocab.json';
const sha256Value = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const staticArtifactCache = createSam3BrowserStaticArtifactCache({
  fetchArrayBuffer: async url => {
    staticNetworkLoads.push(['array', url]);
    return staticArrayBytes.buffer;
  },
  fetchText: async url => {
    staticNetworkLoads.push(['text', url]);
    return `text:${url}`;
  },
});
staticArtifactCache.configure({
  packageId: 'sam3-model-package:one',
  artifacts: [
    { url: '/weights/a.bin', kind: 'array-buffer', sha256: sha256Value(staticArrayBytes) },
    { url: '/tokenizer/vocab.json', kind: 'text', sha256: sha256Value(staticTextValue) },
  ],
});
staticArtifactCache.configureInvocation({
  invocationId: 'sam3-invocation:first',
  artifacts: [
    { url: '/verification/output.bin', kind: 'array-buffer', sha256: sha256Value(staticArrayBytes) },
  ],
});
await staticArtifactCache.fetchArray('/weights/a.bin', Float32Array);
await staticArtifactCache.fetchArray('/weights/a.bin', Float32Array);
await staticArtifactCache.fetchText('/tokenizer/vocab.json');
await staticArtifactCache.fetchText('/tokenizer/vocab.json');
await staticArtifactCache.fetchArray('/verification/output.bin', Uint8Array);
await staticArtifactCache.fetchArray('/verification/output.bin', Uint8Array);
assert.deepEqual(staticNetworkLoads, [
  ['array', '/weights/a.bin'],
  ['text', '/tokenizer/vocab.json'],
  ['array', '/verification/output.bin'],
  ['array', '/verification/output.bin'],
], 'only package-owned artifacts may be reused; invocation/verification reads must remain fresh');
assert.deepEqual(staticArtifactCache.evidence(), {
  schema: 'kaminos.sam3-browser-static-artifact-cache-evidence.v0',
  packageId: 'sam3-model-package:one',
  invocationId: 'sam3-invocation:first',
  configurationCount: 1,
  staticArtifactCount: 2,
  staticNetworkLoadCount: 2,
  staticCacheHitCount: 2,
  dynamicNetworkLoadCount: 2,
  dynamicArtifactCount: 1,
  dynamicConfigurationCount: 1,
  dynamicHashVerificationCount: 2,
  dynamicHashVerificationFailureCount: 0,
  staticHashVerificationCount: 2,
  staticHashVerificationFailureCount: 0,
});
const corruptStaticCache = createSam3BrowserStaticArtifactCache({
  fetchArrayBuffer: async () => staticArrayBytes.buffer,
  fetchText: async () => staticTextValue,
});
corruptStaticCache.configure({
  packageId: 'sam3-model-package:corrupt',
  artifacts: [{ url: '/weights/corrupt.bin', kind: 'array-buffer', sha256: `sha256:${'0'.repeat(64)}` }],
});
await assert.rejects(
  corruptStaticCache.fetchArray('/weights/corrupt.bin', Uint8Array),
  /static artifact hash mismatch/,
  'static package bytes must be verified before entering the reusable cache',
);
assert.equal(corruptStaticCache.evidence().staticHashVerificationFailureCount, 1);
const corruptDynamicCache = createSam3BrowserStaticArtifactCache({
  fetchArrayBuffer: async () => staticArrayBytes.buffer,
  fetchText: async () => staticTextValue,
});
corruptDynamicCache.configure({
  packageId: 'sam3-model-package:dynamic-corrupt',
  artifacts: [{ url: '/weights/a.bin', kind: 'array-buffer', sha256: sha256Value(staticArrayBytes) }],
});
corruptDynamicCache.configureInvocation({
  invocationId: 'sam3-invocation:dynamic-corrupt',
  artifacts: [{ url: '/verification/corrupt.bin', kind: 'array-buffer', sha256: `sha256:${'0'.repeat(64)}` }],
});
await assert.rejects(
  corruptDynamicCache.fetchArray('/verification/corrupt.bin', Uint8Array),
  /dynamic artifact hash mismatch/,
  'invocation verification bytes must be authenticated on every fresh read',
);
assert.equal(corruptDynamicCache.evidence().dynamicHashVerificationFailureCount, 1);
assert.throws(() => staticArtifactCache.configure({
  packageId: 'sam3-model-package:one',
  artifacts: [{ url: '/weights/different.bin', kind: 'array-buffer', sha256: 'sha256:different' }],
}), /static artifact set changed/, 'same package identity must not authorize a changed static artifact set');
assert.throws(() => staticArtifactCache.configure({
  packageId: 'sam3-model-package:two',
  artifacts: [{ url: '/weights/a.bin', kind: 'array-buffer', sha256: 'sha256:weight-a' }],
}), /already bound/, 'one browser package cache must not silently switch model package identity');

const dualInvocationEvidence = createSam3DualInvocationEvidence({
  packageId: 'sam3-model-package:one',
  invocationId: 'sam3-invocation:first',
  verificationSha256: 'sha256:verification-one',
  sourceImageSha256: 'sha256:image-one',
  promptSha256: 'sha256:prompt-one',
  requestIds: ['request:first'],
  outputIdentity: 'sha256:output-one',
}, {
  packageId: 'sam3-model-package:one',
  invocationId: 'sam3-invocation:second',
  verificationSha256: 'sha256:verification-two',
  sourceImageSha256: 'sha256:image-two',
  promptSha256: 'sha256:prompt-two',
  requestIds: ['request:second'],
  outputIdentity: 'sha256:output-two',
});
assert.equal(dualInvocationEvidence.sameModelPackage, true);
assert.equal(dualInvocationEvidence.distinctInvocations, true);
assert.equal(dualInvocationEvidence.distinctVerification, true);
assert.equal(dualInvocationEvidence.distinctRequestSets, true);
assert.equal(dualInvocationEvidence.distinctOutputs, true);
assert.equal(dualInvocationEvidence.distinctSourceImages, true);
assert.equal(dualInvocationEvidence.distinctPrompts, true);
assert.throws(() => createSam3DualInvocationEvidence({
  packageId: 'sam3-model-package:one',
  invocationId: 'sam3-invocation:first',
  verificationSha256: 'sha256:stale',
  sourceImageSha256: 'sha256:image-one',
  promptSha256: 'sha256:prompt-one',
  requestIds: ['request:first'],
  outputIdentity: 'sha256:output-one',
}, {
  packageId: 'sam3-model-package:one',
  invocationId: 'sam3-invocation:second',
  verificationSha256: 'sha256:stale',
  sourceImageSha256: 'sha256:image-two',
  promptSha256: 'sha256:prompt-two',
  requestIds: ['request:second'],
  outputIdentity: 'sha256:output-two',
}), /verification identity was reused/, 'a fresh invocation must not inherit the first invocation verification artifact');

const invocationSummary = overrides => ({
  packageId: 'sam3-model-package:one',
  invocationId: 'sam3-invocation:first',
  verificationSha256: 'sha256:verification-one',
  sourceImageSha256: 'sha256:image-one',
  promptSha256: 'sha256:prompt-one',
  requestIds: ['request:first'],
  outputIdentity: 'sha256:output-one',
  ...overrides,
});
assert.throws(() => createSam3DualInvocationEvidence(
  invocationSummary(),
  invocationSummary({ invocationId: 'sam3-invocation:second', verificationSha256: 'sha256:verification-two', promptSha256: 'sha256:prompt-two', requestIds: ['request:second'], outputIdentity: 'sha256:output-two' }),
), /source image identity was reused/, 'dual invocation freshness must reject repeated encoded-image bytes');
assert.throws(() => createSam3DualInvocationEvidence(
  invocationSummary(),
  invocationSummary({ invocationId: 'sam3-invocation:second', verificationSha256: 'sha256:verification-two', sourceImageSha256: 'sha256:image-two', requestIds: ['request:second'], outputIdentity: 'sha256:output-two' }),
), /prompt identity was reused/, 'dual invocation freshness must reject repeated normalized prompt identity');

assert.match(witness, /--second-image/, 'dual witness must accept a distinct second encoded image');
assert.match(witness, /generateOraclePacket\(secondOracleDir, secondPrompt, secondSourceImage\)/, 'second packet must be generated from the second image rather than the first invocation global');
assert.equal(typeof samBrowserPackageManifest.resolveSam3BrowserArtifactUrl, 'function', 'browser package resolver must expose contained nested-artifact URL resolution');
if (typeof samBrowserPackageManifest.resolveSam3BrowserArtifactUrl === 'function') {
  const resolveArtifact = samBrowserPackageManifest.resolveSam3BrowserArtifactUrl;
  assert.equal(
    resolveArtifact('weights.bin', '/oracle/tensor-manifest.json', 'http://127.0.0.1:18527/smokes/sam-mask-island-parity.html'),
    'http://127.0.0.1:18527/oracle/weights.bin',
  );
  assert.throws(
    () => resolveArtifact('../weights.bin', '/oracle/tensor-manifest.json', 'http://127.0.0.1:18527/smokes/sam-mask-island-parity.html'),
    /escapes manifest artifact root/,
    'browser nested-artifact resolution must reject parent traversal before the server can reinterpret the route',
  );
  assert.throws(
    () => resolveArtifact('..%2fweights.bin', '/oracle/tensor-manifest.json', 'http://127.0.0.1:18527/smokes/sam-mask-island-parity.html'),
    /escapes manifest artifact root/,
    'browser nested-artifact resolution must reject traversal hidden behind an encoded path separator',
  );
  assert.throws(
    () => resolveArtifact('https://example.com/weights.bin', '/oracle/tensor-manifest.json', 'http://127.0.0.1:18527/smokes/sam-mask-island-parity.html'),
    /escapes manifest artifact root/,
    'browser nested-artifact resolution must reject cross-origin absolute references',
  );
}

assert.equal(join(new URL('.', root).pathname, 'smokes').includes('webgpu-inference-kit'), true);

const invalidChromeDir = await mkdtemp(join(tmpdir(), 'sam-mask-invalid-chrome-'));
const invalidChromeReport = join(invalidChromeDir, 'report.json');
const invalidChromeScreenshot = join(invalidChromeDir, 'screenshot.png');
const invalidChromePath = join(invalidChromeDir, 'definitely-not-chrome');
const invalidChromeOracleDir = join(invalidChromeDir, 'oracle');
const invalidChromePacketTool = join(invalidChromeDir, 'full-source-identity-packet.mjs');
writeFileSync(invalidChromePacketTool, `
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const outDir = args.get('--out-dir');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'tensor-manifest.json'), JSON.stringify({
  schema: 'kaminos.sam3-test-packet.v0',
  routeId: 'sam3.mask-decoder-island.webgpu-local.v0',
  sourceImage: {
    artifactId: 'image:test-original',
    file: 'source-image-original.jpg',
    sha256: 'sha256:test-original',
    encodedResolution: [1800, 1200],
    resolution: [224, 224],
    resize: { owner: 'browser', targetResolution: [224, 224], algorithm: 'pillow-12-fixed-point-bilinear-v0' },
  },
}));
`);
const invalidChromeRun = spawnSync(process.execPath, [
  'tools/sam-mask-island-browser-parity-smoke.mjs',
  '--out', invalidChromeScreenshot,
  '--report', invalidChromeReport,
  '--oracle-dir', invalidChromeOracleDir,
  '--packet-tool', invalidChromePacketTool,
  '--debug-port', String(19527 + (process.pid % 1000)),
  '--server-port', String(20527 + (process.pid % 1000)),
], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  env: {
    ...process.env,
    KAMINOS_CHROME: invalidChromePath,
  },
});
assert.notEqual(invalidChromeRun.status, 0, 'invalid Chrome path must fail');
assert.equal(existsSync(invalidChromeReport), true, 'invalid Chrome path must still write a report');
const invalidChromeFailure = JSON.parse(readFileSync(invalidChromeReport, 'utf8'));
assert.equal(invalidChromeFailure.ok, false);
assert.equal(invalidChromeFailure.failure_phase, 'launch_chrome');
assert.equal(invalidChromeFailure.primary_output_written, false);
assert.equal(invalidChromeFailure.screenshot, null);
assert.equal(invalidChromeFailure.chrome, invalidChromePath);
assert.equal(invalidChromeFailure.requestedSourceImage, '/Users/noahlyons/dev/sam3/assets/images/truck.jpg');
assert.equal(invalidChromeFailure.sourceImageIdentitySource, 'packet-manifest');
assert.equal(invalidChromeFailure.sourceImage.sha256, 'sha256:test-original');
assert.deepEqual(invalidChromeFailure.sourceImage.encodedResolution, [1800, 1200]);
assert.deepEqual(invalidChromeFailure.sourceImage.resize, { owner: 'browser', targetResolution: [224, 224], algorithm: 'pillow-12-fixed-point-bilinear-v0' });
assert.match(invalidChromeFailure.error, /ENOENT|spawn/i);

const missingReuseDir = await mkdtemp(join(tmpdir(), 'sam-mask-missing-reuse-'));
const missingReuseReport = join(missingReuseDir, 'report.json');
const missingReuseRun = spawnSync(process.execPath, [
  'tools/sam-mask-island-browser-parity-smoke.mjs',
  '--report', missingReuseReport,
  '--oracle-dir', join(missingReuseDir, 'missing-oracle'),
  '--reuse-oracle-packet', '1',
], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
assert.notEqual(missingReuseRun.status, 0, 'missing reused packet must fail');
assert.equal(existsSync(missingReuseReport), true, 'missing reused packet must still write a report');
const missingReuseFailure = JSON.parse(readFileSync(missingReuseReport, 'utf8'));
assert.equal(missingReuseFailure.failure_phase, 'generate_oracle_packet');
assert.equal(missingReuseFailure.oraclePacketSource, 'caller-provided-existing');
assert.match(missingReuseFailure.error, /reused oracle packet manifest missing/);

console.log('sam mask island browser parity smoke contracts passed');
