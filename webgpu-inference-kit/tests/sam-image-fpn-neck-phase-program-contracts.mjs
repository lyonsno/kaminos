import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const routeSourceUrl = new URL('../src/sam-image-fpn-neck-phase-program.js', import.meta.url);
const smokeJs = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const stackExporter = readFileSync(new URL('../tools/sam-detr-stack-mlx-packet.py', import.meta.url), 'utf8');
const encoderExporter = readFileSync(new URL('../tools/sam-detr-encoder-mlx-packet.py', import.meta.url), 'utf8');
const modelLoader = readFileSync(new URL('../tools/sam_mlx_model_loader.py', import.meta.url), 'utf8');
const gateUToleranceCalibration = JSON.parse(readFileSync(new URL('../tools/sam-gate-u-tolerance-calibration.json', import.meta.url), 'utf8'));
const packageResolverUrl = new URL('../src/sam-browser-package-manifest.js', import.meta.url);

assert.match(packageJson.scripts.test, /sam-image-fpn-neck-phase-program-contracts\.mjs/, 'default test must include portable SAM3 image FPN-neck contracts');
assert.equal(existsSync(routeSourceUrl), true, 'SAM3 image FPN-neck route source must exist');
assert.equal(existsSync(packageResolverUrl), true, 'SAM3 browser package/invocation resolver source must exist');

const routeSource = existsSync(routeSourceUrl) ? readFileSync(routeSourceUrl, 'utf8') : '';
assert.match(routeSource, /SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID/, 'image FPN-neck route must export stable route identity');
assert.match(routeSource, /sam3\.image-fpn-neck\.phase-program\.webgpu-local\.v0/, 'image FPN-neck route must name the WebGPU-local route id');
assert.match(routeSource, /defineProgram/, 'image FPN-neck route must use the phase-program runtime');
assert.match(routeSource, /runProgram/, 'image FPN-neck route must execute through runProgram');
assert.match(routeSource, /if \(x < -10\.0\) \{ return 0\.0; \}/, 'FPN GELU shader must saturate its negative tail before cubic overflow can produce NaN');
assert.match(routeSource, /if \(x > 10\.0\) \{ return x; \}/, 'FPN GELU shader must saturate its positive tail before cubic overflow');
assert.match(routeSource, /fn mlx_erf\(x: f32\)/, 'FPN GELU shader must port the MLX Metal erf implementation used by the reference backend');
assert.match(routeSource, /fn mlx_expm1f\(x: f32\)/, 'FPN GELU shader must port MLX Metal expm1 rather than substitute a different erf family');
assert.match(routeSource, /0\.927734375/, 'FPN GELU shader must preserve the MLX Metal erf branch boundary');
assert.doesNotMatch(routeSource, /0\.044715/, 'FPN GPU and CPU GELU paths must not retain the tanh approximation');
assert.match(routeSource, /createLinearDispatch/, 'FPN neck must use the shared device-limit-aware linear dispatch contract');
assert.match(routeSource, /maxComputeWorkgroupsPerDimension/, 'FPN neck must route against the effective adapter workgroup-dimension limit');
assert.match(routeSource, /gid\.x \+ gid\.y \* dispatch_grid\.x \* 64u/, 'FPN shaders must reconstruct a linear invocation index from a two-dimensional dispatch');
assert.ok(
  (routeSource.match(/@builtin\(num_workgroups\) dispatch_grid: vec3<u32>/g) || []).length >= 5,
  'every FPN linear kernel family must receive the effective two-dimensional dispatch grid',
);
assert.doesNotMatch(routeSource, /dispatch:\s*\[workgroups\(/, 'FPN phases must not wrap a one-dimensional workgroup count');
assert.match(routeSource, /dispatch:\s*linearDispatch\(/, 'FPN phases must pass the shared dispatch tuple directly');
assert.match(routeSource, /fpn-neck-transpose-conv-0-scale0/, 'image FPN-neck route must expose level-0 first transpose-conv stage metadata');
assert.match(routeSource, /fpn-neck-transpose-conv-0-scale1/, 'image FPN-neck route must expose level-0 second transpose-conv stage metadata');
assert.match(routeSource, /fpn-neck-transpose-conv-1/, 'image FPN-neck route must expose level-1 transpose-conv stage metadata');
assert.match(routeSource, /fpn-neck-proj1-2/, 'image FPN-neck route must expose level-2 1x1 projection stage metadata');
assert.match(routeSource, /fpn-neck-maxpool-3/, 'image FPN-neck route must expose level-3 max-pool/downsample stage metadata');
assert.match(routeSource, /fpn-neck-proj1-3/, 'image FPN-neck route must expose level-3 1x1 projection stage metadata');
assert.match(routeSource, /fpn-neck-proj2-0/, 'image FPN-neck route must expose level-0 3x3 projection stage metadata');
assert.match(routeSource, /fpn-neck-proj2-3/, 'image FPN-neck route must expose level-3 3x3 projection stage metadata');
assert.match(routeSource, /readback-fpn-neck-features/, 'image FPN-neck route must expose FPN feature readback stage metadata');

assert.match(stackExporter, /--image-fpn-neck-ingress/, 'detector-stack packet must expose image FPN-neck ingress CLI flag');
assert.match(stackExporter, /mlx-detector-stack-image-fpn-neck-export/, 'detector-stack packet must expose FPN-neck ingress mode');
assert.match(stackExporter, /expected-fpn-neck-feature-0/, 'detector-stack packet must export expected FPN-neck feature level 0');
assert.match(stackExporter, /expected-fpn-neck-feature-1/, 'detector-stack packet must export expected FPN-neck feature level 1');
assert.match(stackExporter, /expected-fpn-neck-feature-2/, 'detector-stack packet must export expected FPN-neck feature level 2');
assert.match(stackExporter, /expected-fpn-neck-feature-3/, 'detector-stack packet must export expected FPN-neck feature level 3');
assert.match(stackExporter, /expected-prompt-fpn-feature/, 'image-FPN detector-stack packet must export expected prompt-FPN feature for browser prompt-FPN composition');
assert.match(stackExporter, /expected-pixel-embed/, 'image-FPN detector-stack packet must export expected pixel embed for browser pixel-decoder composition');
assert.match(stackExporter, /fpn-neck-layer0-scale0-weight/, 'detector-stack packet must export level-0 FPN transpose-conv weights');
assert.match(stackExporter, /fpn-neck-layer2-proj2-weight/, 'detector-stack packet must export level-2 FPN projection weights');
assert.match(stackExporter, /fpn-neck-layer3-proj2-weight/, 'detector-stack packet must export level-3 FPN projection weights');
assert.match(stackExporter, /encoder_tool\.add_downstream_weights\(weight_entries, out_dir, params, len\(ref\["composed_features"\]\)\)/, 'image-FPN detector-stack packet must export prompt cross-attention, pixel-decoder, and mask-tail weights through the reviewed downstream helper');
assert.match(stackExporter, /image-fpn-neck-detector-stack-composition/, 'detector-stack packet must preserve FPN-neck composition route kind');
assert.match(stackExporter, /browser-derived-from-fpn-neck-feature-2/, 'detector-stack packet metadata must mark encoder-src as browser-derived from FPN level 2 in image-FPN mode');
assert.match(stackExporter, /browser-position-embedding-sine-from-fpn-level-2-shape/, 'detector-stack packet metadata must mark encoder-pos as browser-computed from FPN level-2 shape in image-FPN mode');
assert.match(stackExporter, /encoderSrcMaxAbsDiff/, 'detector-stack packet tolerances must include FPN-derived encoder source parity');
assert.match(stackExporter, /encoderPosMaxAbsDiff/, 'detector-stack packet tolerances must include browser position parity');
assert.match(stackExporter, /legacy_detector_stack_tolerances/, 'detector-stack packet must keep a separate tight legacy tolerance budget');
assert.match(stackExporter, /gate_u_image_fpn_tolerances/, 'detector-stack packet must keep a separate grounded Gate U image-FPN tolerance budget');
assert.match(stackExporter, /"binaryMismatchCount": 8/, 'legacy detector-stack packet budget must keep binary mismatch tolerance at 8');
assert.match(stackExporter, /"selectionBoxesMaxAbsDiff": 0\.0002/, 'legacy detector-stack packet budget must keep tight selection-box tolerance');
assert.match(stackExporter, /"lastHsMaxAbsDiff": 0\.003/, 'image-FPN packet budget must carry the grounded Gate U decoder tolerance');
assert.match(stackExporter, /"decoderHiddenStatesMaxAbsDiff": 0\.003/, 'image-FPN packet budget must carry the grounded Gate U full decoder tolerance');
assert.match(stackExporter, /"webGpuLogitsMaxAbsDiff": 0\.03/, 'image-FPN packet budget must carry the grounded Gate U mask-logit tolerance');
assert.match(stackExporter, /"binaryMismatchCount": 8/, 'image-FPN packet budget must tighten binary mismatch tolerance to the grounded Gate U envelope');
assert.match(stackExporter, /"selectionBoxesMaxAbsDiff": 0\.065/, 'image-FPN packet budget must carry the grounded Gate U selection-box tolerance');
assert.match(stackExporter, /"promptFpnMaxAbsDiff": 0\.001/, 'image-FPN packet budget must carry the measured browser prompt-FPN tolerance');
assert.match(stackExporter, /"pixelEmbedMaxAbsDiff": 0\.0015/, 'image-FPN packet budget must carry the measured browser pixel-decoder tolerance');
assert.match(stackExporter, /"toleranceBudgetSource": tolerance_budget_source/, 'detector-stack packet must surface the effective tolerance budget source');
assert.match(stackExporter, /"toleranceCalibration": tolerance_calibration/, 'split verification must embed the calibration receipt and its source hash');
assert.equal(gateUToleranceCalibration.schema, 'kaminos.sam3-gate-u-tolerance-calibration.v0');
assert.equal(gateUToleranceCalibration.samples.length, 3, 'Gate U calibration must retain three authenticated invocations across two source images');
const distinctImageCalibrationSample = gateUToleranceCalibration.samples.find(sample => sample.sourceImageSha256 === 'sha256:979f120edcb0050a12d5b4a1f1eaf6bc888b89f675524e7ffcf6ae5b77aa6bc4');
assert.ok(distinctImageCalibrationSample, 'Gate U calibration must include the distinct person-image invocation');
assert.equal(distinctImageCalibrationSample.observed.binaryMismatchCount, 0);
assert.equal(gateUToleranceCalibration.causalReplay.status, 'passed', 'Gate U calibration must retain the MLX-on-browser-intermediates causal replay');
assert.ok(gateUToleranceCalibration.observedMaxima.lastHsMaxAbsDiff < gateUToleranceCalibration.acceptanceBudget.lastHsMaxAbsDiff);
assert.ok(gateUToleranceCalibration.observedMaxima.maskLogitsMaxAbsDiff < gateUToleranceCalibration.acceptanceBudget.webGpuLogitsMaxAbsDiff);
assert.ok(gateUToleranceCalibration.observedMaxima.selectionBoxesMaxAbsDiff < gateUToleranceCalibration.acceptanceBudget.selectionBoxesMaxAbsDiff);
assert.ok(gateUToleranceCalibration.observedMaxima.binaryMismatchCount < gateUToleranceCalibration.acceptanceBudget.binaryMismatchCount);
assert.ok(gateUToleranceCalibration.observedMaxima.predLogitsMaxAbsDiff < gateUToleranceCalibration.acceptanceBudget.predLogitsMaxAbsDiff);
assert.ok(gateUToleranceCalibration.observedMaxima.selectionScoresMaxAbsDiff < gateUToleranceCalibration.acceptanceBudget.selectionScoresMaxAbsDiff);
assert.match(stackExporter, /"predLogitsMaxAbsDiff": 0\.001/, 'Gate U packet budget must carry the distinct-image calibrated all-query scoring bound');
assert.match(stackExporter, /"selectionScoresMaxAbsDiff": 0\.00006/, 'Gate U packet budget must carry the distinct-image calibrated all-query selection-score bound');
assert.match(modelLoader, /load_model as load_mlx_vlm_model/, 'SAM3 reference loader must use the config-aware MLX-VLM model loader');
assert.match(modelLoader, /checkpointParameterAudit/, 'SAM3 reference loader must expose checkpoint-to-model parameter audit evidence');
assert.match(modelLoader, /model\.set_dtype\(mx\.float32\)/, 'SAM3 reference loader must promote audited checkpoint parameters to the browser FP32 compute contract');
assert.match(modelLoader, /effectiveComputeDtype/, 'SAM3 checkpoint audit must expose the effective reference compute dtype');
assert.match(modelLoader, /model config not found/, 'SAM3 reference loader must reject weight-only repositories before model initialization');
assert.doesNotMatch(modelLoader, /strict=False/, 'SAM3 reference loader must not silently accept zero checkpoint matches');
assert.match(encoderExporter, /load_sam3_model/, 'DETR exporter must route model loading through the audited shared SAM3 loader');
assert.match(stackExporter, /"modelLoad": model_load_audit/, 'detector-stack verification must preserve the effective checkpoint-load audit');
assert.match(stackExporter, /default="mlx-community\/sam3-bf16"/, 'detector-stack packet must default to the config-bearing converted SAM3 checkpoint');
assert.doesNotMatch(stackExporter, /default="mlx-community\/sam3-image"/, 'detector-stack packet must not default to the stale weight-only SAM3 artifact');
assert.match(stackExporter, /kaminos\.sam3-browser-model-package\.v0/, 'image-FPN exporter must emit a reusable model package');
assert.match(stackExporter, /kaminos\.sam3-browser-invocation\.v0/, 'image-FPN exporter must emit a per-run invocation');
assert.match(stackExporter, /kaminos\.sam3-browser-verification\.v0/, 'image-FPN exporter must emit a separate verification attachment');
assert.match(stackExporter, /sam3-model-package\.json/, 'image-FPN exporter must write the reusable model package separately');
assert.match(stackExporter, /sam3-invocation\.json/, 'image-FPN exporter must write invocation state separately');
assert.match(stackExporter, /sam3-verification\.json/, 'image-FPN exporter must write oracle verification state separately');
assert.match(stackExporter, /package_contract\s*=\s*\{/, 'model package identity must be derived from the exported runtime package contract');
assert.match(stackExporter, /package_digest\s*=\s*encoder_tool\.sha256_bytes\(canonical_identity_json\(package_contract\)\.encode\("utf-8"\)\)/, 'model package identity must hash a cross-language canonical package contract');
assert.match(stackExporter, /struct\.pack\(['"]>d['"], number\)\.hex\(\)/, 'Python package identity must encode numbers by binary64 bytes rather than language-specific JSON formatting');
assert.doesNotMatch(stackExporter, /"packageId": f"sam3-model-package:\{weights_sha\}"/, 'model package identity must not collapse to the source checkpoint hash');

assert.match(witness, /mlx-detector-stack-image-fpn-neck-export/, 'witness must allow detector-stack packet mode with browser-local image FPN-neck ingress');
assert.match(witness, /IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID/, 'witness must preserve SAM3 image FPN-neck route identity');
assert.match(witness, /imageFpnNeckReport/, 'witness must emit compact imageFpnNeck report evidence');
assert.match(witness, /fpnNeckFeature0MaxAbsDiff/, 'witness must assert FPN-neck level-0 parity');
assert.match(witness, /fpnNeckFeature3MaxAbsDiff/, 'witness must assert FPN-neck level-3 parity');
assert.match(witness, /expectedFpnNeckFeature3Sha256/, 'witness terminal tensorPacket guard must require expected FPN-neck level-3 tensor identity');
assert.match(witness, /!report\.fpnNeckFeature3TensorSha256/, 'witness compact image-FPN report guard must require expected FPN-neck level-3 tensor identity');
assert.match(witness, /level3DetectorConsumption/, 'witness must preserve that level 3 is produced but not detector-consumed');
assert.doesNotMatch(witness, /level3FpnNeck/, 'witness must not preserve the stale non-claim that level 3 FPN neck is absent');
assert.match(witness, /expectedChainLength = report\.mode === DETECTOR_STACK_IMAGE_FPN_NECK_PACKET_MODE \? 13 : 9/, 'witness shared ViT-block evidence guard must accept the 13-route image-FPN prompt/text chain');
assert.match(witness, /receiptChain\.length !== 13/, 'witness must reject image-FPN detector-stack receipt chains that skip browser prompt/text, prompt-FPN, or pixel-decoder composition');
assert.match(witness, /lastState\.compositionRouteReceipts\.length !== 13/, 'witness terminal detector-stack guard must accept the full 13-route image-FPN prompt/text prompt/pixel chain');
assert.doesNotMatch(witness, /lastState\.compositionRouteReceipts\.length !== 10/, 'witness terminal detector-stack guard must not retain the stale ten-route image-FPN chain');
assert.match(witness, /promptFpnReceipt,\s*\n\s*pixelDecoderReceipt,\s*\n\s*decoderReceipt/, 'witness terminal detector-stack guard must account for prompt-FPN and pixel-decoder receipts before decoder');
assert.match(witness, /promptFpnOutput\?\.artifactId !== compositionEdge\?\.promptFpnOutput\?\.artifactId/, 'witness terminal detector-stack guard must bind prompt-FPN receipt output to the composition edge');
assert.match(witness, /pixelDecoderOutput\?\.artifactId !== compositionEdge\?\.pixelEmbedOutput\?\.artifactId/, 'witness terminal detector-stack guard must bind pixel-decoder receipt output to the composition edge');
assert.match(witness, /effectiveToleranceBudgetSource/, 'witness report must preserve the effective tolerance budget source');
assert.match(witness, /gate-u-mlx-metal-erf-two-prompt-grounded-browser-fpn-detector-stack-2026-07-13/, 'witness must recognize the grounded Gate U image-FPN tolerance budget source');
assert.match(witness, /sam3-detr-encoder-tensors/, 'witness must inspect the DETR encoder tensor input receipt');
assert.match(witness, /detrEncoderInput\?\.artifactId !== 'sam3-detr-encoder-tensors:browser-fpn-image-ingress-composition'/, 'witness must assert the DETR encoder input artifact comes from browser FPN image ingress composition');
assert.match(witness, /detrEncoderInput\?\.sha256 !== ingress\.detrImageIngressTensorSha256/, 'witness must assert the DETR encoder input hash equals the browser FPN ingress aggregate');
assert.match(witness, /browserPromptFpnPixelEvidence/, 'witness report must preserve browser prompt-FPN and pixel-decoder evidence at top level');
assert.match(witness, /resolveSam3BrowserPackageManifestSync/, 'terminal witness must resolve the hash-bound package/invocation split before browser launch');
assert.match(witness, /packageInvocationEvidence/, 'terminal witness must preserve effective package and invocation identity even on pre-browser failure');
assert.match(witness, /PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID/, 'witness must assert image-FPN detector-stack prompt-FPN route receipt identity');
assert.match(witness, /PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID/, 'witness must assert image-FPN detector-stack pixel-decoder route receipt identity');

assert.match(smokeJs, /runSam3ImageFpnNeckPhaseProgramRoute/, 'browser smoke must execute image FPN-neck route');
assert.match(smokeJs, /image-fpn-neck-detector-stack-composition/, 'browser smoke must expose detector-stack composition with browser-local FPN-neck ingress');
assert.match(smokeJs, /imageFpnNeckEvidence/, 'browser smoke state must preserve FPN-neck evidence');
assert.match(smokeJs, /fpnNeckFeature0MaxAbsDiff/, 'browser smoke must preserve FPN-neck level-0 parity');
assert.match(smokeJs, /fpnNeckFeature3MaxAbsDiff/, 'browser smoke must preserve FPN-neck level-3 parity');
assert.match(smokeJs, /level3DetectorConsumption/, 'browser smoke must name only detector non-consumption for produced level 3');
assert.doesNotMatch(smokeJs, /level3FpnNeck/, 'browser smoke must not non-claim produced level-3 FPN neck output');
assert.match(smokeJs, /fpnNeckFeature0Output/, 'browser smoke must preserve FPN-neck output identity as an ingress edge');
assert.match(smokeJs, /fpnNeckFeature3Output/, 'browser smoke must preserve FPN-neck level-3 output identity as an ingress edge');
assert.match(smokeJs, /createSam3DetrImageIngressFromFpnFeatures/, 'browser smoke must construct DETR image ingress from browser-produced FPN features');
assert.match(smokeJs, /browserFpnDetrIngressEvidence/, 'browser smoke state must expose FPN-derived DETR ingress evidence');
assert.match(smokeJs, /detrImageIngressTensorSha256/, 'browser smoke must receipt-bind DETR encoder tensors to the FPN-derived image ingress');
assert.match(smokeJs, /encoderSrcSource: 'browser-fpn-neck-feature-2'/, 'browser smoke must advertise browser FPN level 2 as the DETR encoder source owner');
assert.match(smokeJs, /sam3-prompt-fpn-tensors:browser-image-fpn-detector-stack-composition/, 'browser smoke must receipt-bind DETR encoder output into browser prompt-FPN for image-FPN detector-stack mode');
assert.match(smokeJs, /sam3-pixel-decoder-tensors:browser-image-fpn-detector-stack-composition/, 'browser smoke must receipt-bind browser FPN and prompt-FPN outputs into pixel decoder for image-FPN detector-stack mode');
assert.match(smokeJs, /sam3-pixel-embed:browser-image-fpn-detector-stack-composition/, 'browser smoke must expose browser-produced pixel embed before mask-tail in image-FPN detector-stack mode');
assert.match(smokeJs, /browserPromptFpnPixelEvidence/, 'browser smoke state must expose browser prompt-FPN and pixel-decoder evidence');
assert.match(smokeJs, /resolveSam3BrowserPackageManifest/, 'browser smoke must resolve the hash-bound package/invocation split at runtime');
assert.match(smokeJs, /packageInvocationEvidence/, 'browser smoke must expose effective package and invocation identity');

if (existsSync(packageResolverUrl)) {
  const {
    canonicalSam3IdentityJson,
    resolveSam3BrowserPackageManifest,
    resolveSam3BrowserPackageManifestSync,
  } = await import('../src/sam-browser-package-manifest.js');

  const encode = value => JSON.stringify(value, null, 2);
  const sha256 = text => createHash('sha256').update(text).digest('hex');
  assert.equal(
    canonicalSam3IdentityJson({ whole: 1, epsilon: 0.000001, negativeZero: -0 }),
    '{"epsilon":"f64:3eb0c6f7a0b5ed8d","negativeZero":"f64:8000000000000000","whole":"f64:3ff0000000000000"}',
    'identity canonicalization must preserve language-independent binary64 number identity',
  );
  assert.throws(
    () => canonicalSam3IdentityJson({ invalid: Number.NaN }),
    /non-finite number/,
    'identity canonicalization must reject non-finite metadata instead of laundering it through JSON null',
  );
  const identityDigest = (value, excluded) => sha256(canonicalSam3IdentityJson(Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.includes(key)))));
  const artifacts = new Map();
  const addArtifact = (file, value) => {
    const text = encode(value);
    artifacts.set(file, text);
    return { file, sha256: sha256(text), schema: value.schema };
  };
  const modelPackage = {
    schema: 'kaminos.sam3-browser-model-package.v0',
    packageId: 'sam3-model-package:test',
    model: { id: 'test-model' },
    staticWeights: { artifactId: 'weights:test', sha256: 'weights-sha', role: 'reference-upstream' },
    shape: { batch: 1 },
    claims: { fullSam3BrowserExecution: false },
    weights: [{ role: 'test-weight' }],
  };
  const invocation = {
    schema: 'kaminos.sam3-browser-invocation.v0',
    invocationId: 'sam3-invocation:test-a',
    prompt: { text: 'truck', sha256: 'prompt-a' },
    sourceImage: { file: 'truck.png', sha256: 'image-a' },
    postprocess: { scoreThreshold: 0.1 },
  };
  modelPackage.packageId = `sam3-model-package:${identityDigest(modelPackage, ['schema', 'packageId'])}`;
  invocation.invocationId = `sam3-invocation:${identityDigest(invocation, ['schema', 'invocationId'])}`;
  const verification = {
    schema: 'kaminos.sam3-browser-verification.v0',
    verificationId: 'sam3-verification:test-a',
    verifiedPackageId: modelPackage.packageId,
    verifiedInvocationId: invocation.invocationId,
    reference: { owner: 'mlx' },
    toleranceBudgetSource: 'test-budget',
    toleranceCalibration: { schema: 'test-calibration', sourceSha256: 'calibration-sha' },
    tolerances: { binaryMismatchCount: 96 },
    tensors: [{ role: 'expected-mask' }],
  };
  verification.verificationId = `sam3-verification:${identityDigest(verification, ['schema', 'verificationId'])}`;
  const root = {
    schema: 'kaminos.sam3-detector-stack.image-fpn-neck-packet.v0',
    routeId: 'sam3.mask-decoder-island.webgpu-local.v0',
    mode: 'mlx-detector-stack-image-fpn-neck-export',
    modelPackage: addArtifact('sam3-model-package.json', modelPackage),
    invocation: addArtifact('sam3-invocation.json', invocation),
    verification: addArtifact('sam3-verification.json', verification),
  };
  const readArtifactTextSync = file => {
    if (!artifacts.has(file)) throw new Error(`missing fixture ${file}`);
    return artifacts.get(file);
  };
  const readArtifactText = async file => readArtifactTextSync(file);
  const asyncResolution = await resolveSam3BrowserPackageManifest(root, { readArtifactText, sha256Text: async text => sha256(text) });
  const syncResolution = resolveSam3BrowserPackageManifestSync(root, { readArtifactText: readArtifactTextSync, sha256Text: sha256 });
  for (const resolution of [asyncResolution, syncResolution]) {
    assert.equal(resolution.manifest.model.id, 'test-model');
    assert.equal(resolution.manifest.prompt.text, 'truck');
    assert.equal(resolution.manifest.tolerances.binaryMismatchCount, 96);
    assert.equal(resolution.manifest.toleranceCalibration.sourceSha256, 'calibration-sha', 'verification calibration receipt must survive package composition');
    assert.equal(resolution.evidence.packageId, modelPackage.packageId);
    assert.equal(resolution.evidence.invocationId, invocation.invocationId);
    assert.equal(resolution.evidence.verification.attached, true);
    assert.equal(resolution.manifest.schema, root.schema, 'composition must preserve the root packet schema');
  }
  const noVerificationRoot = { ...root };
  delete noVerificationRoot.verification;
  const noVerification = resolveSam3BrowserPackageManifestSync(noVerificationRoot, { readArtifactText: readArtifactTextSync, sha256Text: sha256 });
  assert.equal(noVerification.evidence.verification.attached, false, 'verification must remain optional at runtime');
  assert.equal(noVerification.manifest.tensors, undefined, 'verification-free invocation must not acquire oracle tensors');

  assert.throws(
    () => resolveSam3BrowserPackageManifestSync({ ...root, prompt: invocation.prompt }, { readArtifactText: readArtifactTextSync, sha256Text: sha256 }),
    /root manifest duplicates invocation-owned field prompt/,
    'mixed root/invocation authority must fail loud',
  );
  assert.throws(
    () => resolveSam3BrowserPackageManifestSync({ ...root, modelPackage: { ...root.modelPackage, sha256: 'wrong' } }, { readArtifactText: readArtifactTextSync, sha256Text: sha256 }),
    /model package hash mismatch/,
    'stale or substituted model packages must fail before execution',
  );
  const relabeledModelPackage = { ...modelPackage, packageId: 'sam3-model-package:relabeled' };
  artifacts.set('sam3-model-package-relabeled.json', encode(relabeledModelPackage));
  const relabeledModelPackageRef = {
    file: 'sam3-model-package-relabeled.json',
    sha256: sha256(encode(relabeledModelPackage)),
    schema: relabeledModelPackage.schema,
  };
  assert.throws(
    () => resolveSam3BrowserPackageManifestSync({ ...root, modelPackage: relabeledModelPackageRef }, { readArtifactText: readArtifactTextSync, sha256Text: sha256 }),
    /model package identity mismatch/,
    'a consistently rehashed root must not authorize a false embedded package identity',
  );
  const relabeledInvocation = { ...invocation, invocationId: 'sam3-invocation:relabeled' };
  artifacts.set('sam3-invocation-relabeled.json', encode(relabeledInvocation));
  const relabeledInvocationRef = {
    file: 'sam3-invocation-relabeled.json',
    sha256: sha256(encode(relabeledInvocation)),
    schema: relabeledInvocation.schema,
  };
  assert.throws(
    () => resolveSam3BrowserPackageManifestSync({ ...root, invocation: relabeledInvocationRef }, { readArtifactText: readArtifactTextSync, sha256Text: sha256 }),
    /invocation identity mismatch/,
    'a consistently rehashed root must not authorize a false embedded invocation identity',
  );
  const crossInvocationVerification = {
    ...verification,
    verificationId: 'sam3-verification:pending',
    verifiedInvocationId: 'sam3-invocation:other-valid-invocation',
    reference: { owner: 'mlx', prompt: 'person' },
    tensors: [{ role: 'expected-mask', file: 'person-mask.bin' }],
  };
  crossInvocationVerification.verificationId = `sam3-verification:${identityDigest(crossInvocationVerification, ['schema', 'verificationId'])}`;
  const crossInvocationVerificationRef = addArtifact('sam3-verification-cross-invocation.json', crossInvocationVerification);
  const crossInvocationRoot = { ...root, verification: crossInvocationVerificationRef };
  assert.throws(
    () => resolveSam3BrowserPackageManifestSync(crossInvocationRoot, { readArtifactText: readArtifactTextSync, sha256Text: sha256 }),
    /verification invocation binding mismatch/,
    'sync resolution must reject a hash-valid verification artifact belonging to another invocation',
  );
  await assert.rejects(
    resolveSam3BrowserPackageManifest(crossInvocationRoot, { readArtifactText, sha256Text: async text => sha256(text) }),
    /verification invocation binding mismatch/,
    'async resolution must reject a hash-valid verification artifact belonging to another invocation',
  );
}

const {
  SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID,
  createSam3DetrImageIngressFromFpnFeatures,
  createSam3PositionEmbeddingSine,
  createSam3ImageFpnNeckPhaseProgramCpuOracle,
  createSam3ImageFpnNeckPhaseProgramRouteDefinition,
  validateRouteDefinition,
} = await import('../src/index.js');

const route = createSam3ImageFpnNeckPhaseProgramRouteDefinition({
  kernel: { profile: 'sam3-image-fpn-neck-phase-program-v0', commit: 'abc1234' },
});
assert.equal(route.routeId, SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID);
assert.deepEqual(route.requiredInputRoles, ['source-image', 'vit-backbone-hidden-states', 'sam3-image-fpn-neck-weights']);
assert.deepEqual(route.requiredOutputRoles, ['fpn-neck-feature-0', 'fpn-neck-feature-1', 'fpn-neck-feature-2', 'fpn-neck-feature-3']);
const level0StageOffset = route.requiredStages.indexOf('fpn-neck-transpose-conv-0-scale0');
assert.notEqual(level0StageOffset, -1, 'route must advertise the first level-0 FPN transpose-conv stage');
assert.deepEqual(
  route.requiredStages.slice(level0StageOffset, level0StageOffset + 3),
  ['fpn-neck-transpose-conv-0-scale0', 'fpn-neck-gelu-0', 'fpn-neck-transpose-conv-0-scale1'],
  'route required-stage metadata must preserve level-0 FPN execution order',
);
assert.equal(validateRouteDefinition(route).ok, true);

const hiddenStates = new Float32Array([1, 2, 3, 4]);
const weights = {
  levels: [
    {
      level: 0,
      scaleLayers: [
        { weight: new Float32Array([1]), bias: new Float32Array([0]), kernelSize: 1, stride: 1, inChannels: 1, outChannels: 1 },
      ],
      proj1: { weight: new Float32Array([1]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
      proj2: { weight: new Float32Array([1]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
    },
    {
      level: 1,
      scaleLayers: [],
      proj1: { weight: new Float32Array([2]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
      proj2: { weight: new Float32Array([1]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
    },
    {
      level: 2,
      scaleLayers: [],
      proj1: { weight: new Float32Array([3]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
      proj2: { weight: new Float32Array([1]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
    },
    {
      level: 3,
      scaleLayers: [],
      downsample: 'maxpool2d',
      proj1: { weight: new Float32Array([4]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
      proj2: { weight: new Float32Array([1]), bias: new Float32Array([0]), kernelSize: 1, padding: 0, inChannels: 1, outChannels: 1 },
    },
  ],
};
const oracle = createSam3ImageFpnNeckPhaseProgramCpuOracle({
  backboneHiddenStates: hiddenStates,
  weights,
  shape: {
    batch: 1,
    backboneHeight: 2,
    backboneWidth: 2,
    backboneChannels: 1,
    fpnHiddenSize: 1,
    levels: [
      { level: 0, scaleFactor: 1, height: 2, width: 2 },
      { level: 1, scaleFactor: 1, height: 2, width: 2 },
      { level: 2, scaleFactor: 1, height: 2, width: 2 },
      { level: 3, scaleFactor: 0.5, height: 1, width: 1 },
    ],
  },
});
assert.deepEqual(oracle.levels.map(level => level.level), [0, 1, 2, 3]);
assert.deepEqual(oracle.levels.map(level => level.shape), [[1, 2, 2, 1], [1, 2, 2, 1], [1, 2, 2, 1], [1, 1, 1, 1]]);
assert.deepEqual(Array.from(oracle.fpnNeckFeatures[0]), Array.from(hiddenStates), 'identity 1x1 level-0 FPN neck should preserve hidden states');
assert.deepEqual(Array.from(oracle.fpnNeckFeatures[1]), Array.from(hiddenStates, value => value * 2), 'level-1 FPN neck should apply level-local projection');
assert.deepEqual(Array.from(oracle.fpnNeckFeatures[2]), Array.from(hiddenStates, value => value * 3), 'level-2 FPN neck should apply level-local projection');
assert.deepEqual(Array.from(oracle.fpnNeckFeatures[3]), [16], 'level-3 FPN neck should max-pool the backbone before level-local projection');

const detrIngress = createSam3DetrImageIngressFromFpnFeatures({
  fpnNeckFeatures: [
    new Float32Array([1, 2, 3, 4]),
    new Float32Array([10, 11, 12, 13]),
    new Float32Array([20, 21, 22, 23, 24, 25, 26, 27]),
  ],
  levels: [
    { level: 0, batch: 1, height: 1, width: 1 },
    { level: 1, batch: 1, height: 1, width: 1 },
    { level: 2, batch: 1, height: 1, width: 2 },
  ],
  channels: 4,
});
assert.equal(detrIngress.encoderSrcSource, 'browser-fpn-neck-feature-2');
assert.deepEqual(Array.from(detrIngress.encoderSrc), [20, 21, 22, 23, 24, 25, 26, 27], 'DETR encoder source must be the row-major browser FPN level-2 tensor');
assert.deepEqual(detrIngress.shape, { batch: 1, height: 1, width: 2, channels: 4, spatialTokens: 2 });

const expectedPos = createSam3PositionEmbeddingSine({ batch: 1, height: 1, width: 2, channels: 4 });
assert.equal(detrIngress.encoderPos.length, expectedPos.length);
for (let index = 0; index < expectedPos.length; index += 1) {
  assert.ok(Math.abs(detrIngress.encoderPos[index] - expectedPos[index]) < 1e-7, `DETR ingress position value ${index} must match PositionEmbeddingSine`);
}
const yAngle = (1 / (1 + 1e-6)) * Math.PI * 2;
const x0Angle = (1 / (2 + 1e-6)) * Math.PI * 2;
assert.ok(Math.abs(detrIngress.encoderPos[0] - Math.sin(yAngle)) < 1e-7, 'position encoding must put y sine first');
assert.ok(Math.abs(detrIngress.encoderPos[1] - Math.cos(yAngle)) < 1e-7, 'position encoding must put y cosine second');
assert.ok(Math.abs(detrIngress.encoderPos[2] - Math.sin(x0Angle)) < 1e-7, 'position encoding must put x sine after y channels');
assert.ok(Math.abs(detrIngress.encoderPos[3] - Math.cos(x0Angle)) < 1e-7, 'position encoding must put x cosine after y channels');

assert.throws(() => createSam3ImageFpnNeckPhaseProgramCpuOracle({
  backboneHiddenStates: hiddenStates,
  weights,
  shape: { batch: 1, backboneHeight: 2, backboneWidth: 2, backboneChannels: 1, fpnHiddenSize: 1, levels: [{ level: 0, scaleFactor: 1, height: 2, width: 2 }] },
}), /shape\.levels/);
assert.throws(() => createSam3DetrImageIngressFromFpnFeatures({
  fpnNeckFeatures: [new Float32Array([1])],
  levels: [{ level: 0, batch: 1, height: 1, width: 1 }],
  channels: 4,
}), /requested DETR source level/);

console.log('sam image FPN-neck phase-program contracts passed');
