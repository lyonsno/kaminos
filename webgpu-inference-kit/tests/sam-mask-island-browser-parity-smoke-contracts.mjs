import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSource = readFileSync(new URL('../src/sam-mask-decoder-island.js', import.meta.url), 'utf8');
const smokeHtml = readFileSync(new URL('../smokes/sam-mask-island-parity.html', import.meta.url), 'utf8');
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');

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

assert.match(witness, /--enable-unsafe-webgpu/, 'witness must launch Chrome with WebGPU enabled');
assert.match(witness, /Chrome DevTools endpoint did not open/, 'witness must use CDP with loud startup failure');
assert.match(witness, /samMaskIslandParitySmokeState/, 'witness must poll the browser debug state');
assert.match(witness, /kaminos\.sam3-mask-island\.browser-parity-smoke\.v0/, 'witness report must be schema stamped');
assert.match(witness, /primary_output_written/, 'witness must write whether the primary artifact was preserved');
assert.match(witness, /failure_phase/, 'witness must record failure phase');
assert.match(witness, /fullStackTimeoutMs\s*=\s*isImageFpnNeckPacketMode\(packetMode\)\s*\?\s*600000\s*:\s*20000/, 'full image-FPN composition must default to a measured non-shadowing witness timeout');
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
assert.match(witness, /packetManifest\s*=\s*JSON\.parse/, 'witness must load the generated packet manifest for routed tolerances');
assert.match(witness, /manifestTolerance\('binaryMismatchCount',\s*8\)/, 'witness must use packet binary mismatch tolerance for detector-stack modes');
assert.match(witness, /manifestTolerance\('selectedBoxMaxAbsDiff',\s*0\.0001\)/, 'witness must use packet selected-box tolerance for detector-stack modes');
assert.match(witness, /manifestTolerance\('webGpuLogitsMaxAbsDiff',\s*0\.0001\)/, 'witness must use packet mask-logits tolerance for detector-stack modes');
assert.match(witness, /browserFpnDetrIngressEvidence:\s*lastState\?\.browserFpnDetrIngressEvidence/, 'witness report must preserve browser FPN-derived DETR ingress evidence at top level');
assert.match(witness, /imageFpnNeck browser DETR ingress evidence missing/, 'witness must assert browser FPN-derived DETR ingress evidence for image-FPN-neck packets');

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

console.log('sam mask island browser parity smoke contracts passed');
