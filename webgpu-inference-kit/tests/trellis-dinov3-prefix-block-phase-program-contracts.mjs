import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const implementation = await readFile(new URL('../src/trellis-dinov3-prefix-block-phase-program.js', import.meta.url), 'utf8');
const referenceExporter = await readFile(new URL('../tools/trellis-dinov3-mlx-reference.py', import.meta.url), 'utf8');
const browserSmoke = await readFile(new URL('../smokes/trellis-dinov3-prefix-block-browser.html', import.meta.url), 'utf8');
const browserRunner = await readFile(new URL('../tools/trellis-dinov3-prefix-block-browser-parity-smoke.mjs', import.meta.url), 'utf8');
const parityAssay = await readFile(new URL('../tools/trellis-dinov3-prefix-block-parity-assay.mjs', import.meta.url), 'utf8');
const publicIndex = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
const { validateRouteDefinition } = await import('../src/index.js');

const residentRoute = await import('../src/trellis-dinov3-prefix-block-phase-program.js');
const kit = await import('../src/index.js');

assert.equal(
  residentRoute.TRELLIS_DINOV3_PREFIX_BLOCK_PHASE_PROGRAM_ROUTE_ID,
  'trellis2.dinov3.prefix-block0.phase-program.webgpu-local.v0',
  'the synthetic patch-only witness does not provide the checkpointed CLS/register/patch prefix and complete DINO block-0 route',
);

assert.equal(typeof residentRoute.runTrellisDinoV3PrefixBlockPhaseProgramRoute, 'function');
const route = residentRoute.createTrellisDinoV3PrefixBlockPhaseProgramRouteDefinition({
  kernel: { profile: 'trellis2-dinov3-prefix-block0-phase-program-v0', commit: 'contract-test' },
});
assert.equal(validateRouteDefinition(route).ok, true, 'the pinned DINOv3 prefix/block-0 route must satisfy the shared route contract');
assert.deepEqual(route.requiredInputRoles, [
  'source-image',
  'trellis-dinov3-normalized-pixels',
  'trellis-dinov3-checkpoint-tensors',
]);
assert.deepEqual(route.requiredOutputRoles, [
  'trellis-dinov3-patch-embeddings',
  'trellis-dinov3-prefix-hidden-states',
  'trellis-dinov3-block0-hidden-states',
]);
assert.equal(route.model.id, 'facebook/dinov3-vitl16-pretrain-lvd1689m');
assert.equal(route.model.revision, 'ea8dc2863c51be0a264bab82070e3e8836b02d51');
assert.equal(route.model.dtype, 'fp32', 'the route must not silently substitute a reduced-precision checkpoint');

const shape = {
  batch: 1, imageHeight: 512, imageWidth: 512, imageChannels: 3, patchSize: 16,
  patchHeight: 32, patchWidth: 32, patchTokens: 1024, prefixTokens: 5,
  tokenCount: 1029, hiddenSize: 1024, heads: 16, headDim: 64,
  intermediateSize: 4096, ropeTheta: 100, layerNormEpsilon: 1e-5,
};
const dispatch = residentRoute.createTrellisDinoV3PrefixBlockDispatchPlan({ shape });
assert.deepEqual(dispatch.layerNorm1, [1029], 'each token needs one full-width F32 LayerNorm group');
assert.equal(dispatch.attentionScore.length, 2, 'attention-score dispatch must span all 16 global attention matrices without imposing a token cap');
assert.ok(dispatch.attentionScore[0] * dispatch.attentionScore[1] * 64 >= 16 * 1029 * 1029);
assert.equal(dispatch.mlpUp[0] * dispatch.mlpUp[1] * 64 >= 1029 * 4096, true);

const prefix = residentRoute.createTrellisDinoV3PrefixCpuOracle({
  batch: 1, hiddenSize: 2, registerCount: 2, patchCount: 2,
  classToken: new Float32Array([10, 11]),
  registerTokens: new Float32Array([20, 21, 30, 31]),
  patchEmbeddings: new Float32Array([40, 41, 50, 51]),
});
assert.deepEqual(Array.from(prefix), [10, 11, 20, 21, 30, 31, 40, 41, 50, 51],
  'prefix order must be CLS, registers in checkpoint order, then row-major patch embeddings');
assert.match(implementation, /dtype: 'f32'/, 'runtime tensors must stay on the explicitly requested F32 route');
assert.match(implementation, /fp16 and implicit numeric conversion are not accepted/,
  'the route must reject reduced-precision or implicitly converted weight and pixel arrays');
assert.match(implementation, /finalNoAffineLayerNormApplied:false/,
  'block-0 output must remain before TRELLIS’ final no-affine LayerNorm');
assert.match(implementation, /attentionScores: tensor\('layer0\.attention-scores-f32'/,
  'global attention scores must use F32 storage for the full 1029-token sequence');
assert.match(referenceExporter, /EXPECTED_SOURCE_SHA256 = "abf395cc52d81c26dadae9f024072d6c7301679be4e8fc08d572723d7ae32a21"/,
  'MLX reference export must reject a different source image instead of relabeling its output');
assert.match(referenceExporter, /sourceFileSha256/,
  'the MLX reference must bind its exact native DINOv3 implementation bytes');
assert.ok(/residentProbeCompleteTransformerBlockCount": 1/.test(referenceExporter),
  'reference metadata must state how many complete transformer blocks precede the attention-only probe boundary');
assert.ok(/residentProbeOutputBoundary": "after complete layer\.0 and block1 attention residual; before block1 norm2 and final model LayerNorm"/.test(referenceExporter),
  'the attention-only probe boundary must be named separately from the full block-1 output');
assert.ok(/residentBlock1CompleteTransformerBlockCount": 2/.test(referenceExporter),
  'reference metadata must state that the full block-1 output includes two completed transformer blocks');
assert.ok(/residentBlock1OutputBoundary": "after complete layer\.0 and complete layer\.1; before final model LayerNorm"/.test(referenceExporter),
  'the full block-1 output boundary must remain explicit');
assert.match(referenceExporter, /block2_norm1_hidden_states = block2\.norm1\(block1_after_mlp_hidden_states\)/,
  'the pinned MLX reference must apply layer-2 norm1 to the exact completed layer-1 output');
assert.ok(/residentBlock2Norm1OutputBoundary": "after two complete transformer blocks and block 2 norm1; before block 2 attention and final model LayerNorm"/.test(referenceExporter),
  'the partial block-2 boundary must not be mislabeled as a complete transformer block');
assert.match(referenceExporter, /block2_norm2_hidden_states = block2\.norm2\(block2_after_attention_hidden_states\)/,
  'the pinned reference must continue block-2 attention residual through block-2 norm2');
assert.match(referenceExporter, /block2_mlp_hidden_states = nn\.gelu\(block2\.mlp\.up_proj\(block2_norm2_hidden_states\)\)/,
  'the pinned reference must include the block-2 GELU MLP input and activation');
assert.match(referenceExporter, /if args\.mode == "resident-block2-mlp":\s+block2_norm2_hidden_states = block2\.norm2\(block2_after_attention_hidden_states\)/,
  'only the full block-2 MLP comparison mode may pay for its additional MLX feed-forward block');
assert.match(referenceExporter, /block2_after_mlp_hidden_states = block2_after_attention_hidden_states \+ block2_mlp_output \* block2\.layer_scale2/,
  'the pinned reference must return the complete block-2 LayerScale residual');
assert.match(referenceExporter, /"residentBlock2MlpOutputBoundary": "after three complete transformer blocks and block 2 MLP residual; before final model LayerNorm"/,
  'the reference must distinguish completed block 2 from partial block-2 attention');
assert.equal(/"blockCount"\s*:/.test(referenceExporter), false,
  'an unqualified block count must not obscure that the packet also includes only a partial second block');
assert.equal(/"outputBoundary"\s*:/.test(referenceExporter), false,
  'an unqualified output boundary must not collapse the attention-only and full block-1 outputs');
assert.ok(/complete MLP residual/.test(referenceExporter),
  'the exporter documentation must describe the full block-1 tensor packet as well as the attention-only probe');
assert.match(browserSmoke, /dcb2e45127cccbf1601e5f42fef165eea275c8e5213197e8dcf3f48822718179/,
  'the browser comparison must reject a checkpoint other than the pinned HF safetensors file');
assert.match(browserSmoke, /shaderF16Requested:false/,
  'the matched browser route must not request or silently use shader-f16');
assert.match(browserSmoke, /effectiveRouteId !== route\.routeId/,
  'fallback or substituted effective WebGPU routes cannot count as parity');
assert.match(browserSmoke, /maxAbs, meanAbs: sumAbs \/ actual\.length, rmse/,
  'each stage comparison must report auditable tensor-difference statistics');
assert.match(browserRunner, /expectedBytes=outputSizes\[name\.replace\(/,
  'missing or partial WebGPU tensors must not be persisted as successful evidence');
assert.match(browserRunner, /request\.headers\['x-output-sha256'\]!==sha256/,
  'persisted browser outputs must be byte-hash verified by the runner');
assert.match(browserRunner, /browserState\?\.mode!==mode/,
  'the runner must reject a stale/default browser page that silently ignored the requested smoke mode');
assert.match(browserRunner, /browserState\?\.requestedRouteId!==requestedRouteId/,
  'the runner must reject a browser page that exercised another effective route');
assert.match(browserRunner, /block1Attention:1029\*1024\*4/,
  'the resident mode must require the exact full-size downstream F32 tensor rather than accepting a partial result');
assert.match(browserRunner, /block1MlpHidden:1029\*4096\*4/,
  'the resident full-block mode must require the exact 1029×4096 F32 GELU tensor');
assert.match(browserRunner, /block2Norm1:1029\*1024\*4/,
  'the resident block-2 norm1 mode must require the complete 1029×1024 F32 output');
assert.match(browserRunner, /block2Attention:1029\*1024\*4/,
  'the resident block-2 attention mode must require the complete 1029×1024 F32 output');
assert.match(browserRunner, /block2MlpHidden:1029\*4096\*4/,
  'the resident block-2 MLP mode must require the complete 1029×4096 F32 GELU tensor');
assert.match(browserRunner, /resident-block2-mlp/,
  'the exact-source browser runner must expose the full block-2 MLP mode explicitly');
assert.match(browserSmoke, /const residentBlock2MlpMode = mode === 'resident-block2-mlp'/,
  'the browser must make full block-2 execution an explicit mode rather than silently widening attention mode');
assert.match(browserSmoke, /runTrellisDinoV3PrefixBlockResidentBlock2MlpProbe/,
  'the browser must invoke the model-local full-block probe for its named mode');
assert.match(browserSmoke, /\['block2MlpProjection','block2_mlp_output'\]/,
  'the full-block browser mode must compare the projected block-2 MLP output against its matching MLX boundary');
assert.match(parityAssay, /\['block1Attention','block1Norm2','block1MlpHidden','block1MlpProjection','block1Output'\]/,
  'the full-block assay must reject missing raw GPU readbacks at every captured block-1 boundary');
assert.match(parityAssay, /'block2Norm1'\]/,
  'block-2 norm1 mode must require its raw GPU output as well as all block-1 boundaries');
assert.match(parityAssay, /'block2Norm1','block2Attention'\]/,
  'block-2 attention mode must preserve both norm1 input and attention-residual output readbacks');
assert.match(parityAssay, /'block2Norm2','block2MlpHidden','block2MlpProjection','block2Output'\]/,
  'block-2 full-block mode must require norm2, GELU, projection, and complete residual readbacks');
assert.match(parityAssay, /residentBlock2MlpProbe/,
  'the composite assay must reject a reference manifest that omits the exact full-block boundary');
assert.match(parityAssay, /'--out-dir',referenceDir,'--mode',mode/,
  'the exact-source assay must pass its requested mode into the MLX exporter');
assert.match(parityAssay, /manifest\.computation\?\.mode===mode/,
  'a reference manifest produced under a different mode must not be accepted');
assert.match(browserSmoke, /adapterClassification === 'software-fallback'/,
  'software WebGPU fallback cannot satisfy the resident GPU evidence route');
assert.match(browserSmoke, /finiteNonzeroCount === 0/,
  'blank/all-zero output cannot masquerade as completed downstream evidence');
assert.match(browserSmoke, /actual\?\.operation !== 'dinov3-block1-attention-residual'/,
  'the browser consumer must accept the operation returned by the block-1 attention-residual producer');
assert.match(browserSmoke, /\.\.\.\(result\.debugResidentBlock1\?\.outputValues\s*\|\|\s*\{\}\)[\s\S]*\.\.\.\(result\.debugResidentBlock2Attention\?\.outputValues\s*\|\|\s*\{\}\)/,
  'block-2 attention parity must join the captured block-1 and block-2 diagnostic outputs instead of reading upstream tensors from the downstream-only record');
assert.match(implementation, /if\s*\(residentBlock2AttentionProbe\)\s*\{\s*residentBlock2Attention\s*=\s*\{\s*\.\.\.residentBlock2Attention\s*,\s*outputValues\s*:\s*outputValues\.block2Attention\s*\}\s*;?\s*\}/,
  'the producer must attach its validated block-2 attention readback to the returned diagnostic record instead of returning an empty array');
assert.match(browserRunner, /failure_phase:phase/,
  'the browser smoke must retain the last failure phase when it cannot complete');
assert.match(parityAssay, /receiver:args.get\('--receiver'\)/,
  'the long matched command must preserve its caller-provided completion receiver');
assert.doesNotMatch(implementation, /let patch\s*=/, 'WGSL must not use the reserved patch identifier');
assert.match(implementation, /profile:runtime\.profile/, 'the route receipt consumes the staged timing profile');
assert.match(parityAssay, /referenceManifest:resolve\(referenceDir,'reference-manifest\.json'\)/,
  'the durable start receipt must identify both reference and terminal evidence paths');
assert.match(parityAssay, /last trustworthy MLX reference remained valid/,
  'a WebGPU failure must preserve the MLX reference as last trustworthy evidence without implying parity');
const routeImplementation = implementation.slice(implementation.indexOf('async function runTrellisDinoV3PrefixBlockPhaseProgramRouteInternal'));
assert.equal(typeof residentRoute.createTrellisDinoV3ResidentProbeTransferMetadata, 'function');
assert.match(routeImplementation, /transfer:createTrellisDinoV3ResidentProbeTransferMetadata\(\{ residentBlock1Probe, residentBlock2Norm1Probe, residentBlock2AttentionProbe, residentBlock2MlpProbe \}\)/,
  'the probe route must publish the same transfer metadata exercised by the mode-specific contract below');
assert.match(routeImplementation, /operation:residentBlock2Mlp\?\.operation\|\|residentBlock2Attention\?\.operation/,
  'full block-2 readback metadata must name the MLP endpoint, not the preceding attention endpoint');
const attentionOnlyTransfers=residentRoute.createTrellisDinoV3ResidentProbeTransferMetadata({residentBlock1Probe:false});
assert.equal(Object.hasOwn(attentionOnlyTransfers,'norm2ToMlp'),false,
  'attention-only mode must not claim a norm2-to-MLP transfer it never executes');
assert.equal(Object.hasOwn(attentionOnlyTransfers,'block1AttentionToNorm2'),false,
  'attention-only mode must not claim a block1 attention-to-norm2 transfer it never executes');
const fullBlockTransfers=residentRoute.createTrellisDinoV3ResidentProbeTransferMetadata({residentBlock1Probe:true});
assert.equal(fullBlockTransfers.block1AttentionToNorm2,'same-runtime-device-buffer');
assert.equal(fullBlockTransfers.norm2ToMlp,'same-runtime-device-buffer');
assert.equal(Object.hasOwn(fullBlockTransfers,'block1OutputToBlock2Norm1'),false,
  'the full-block-1 mode must not claim the later block-2 norm1 handoff');
const block2Transfers=residentRoute.createTrellisDinoV3ResidentProbeTransferMetadata({residentBlock1Probe:true,residentBlock2Norm1Probe:true});
assert.equal(block2Transfers.block1OutputToBlock2Norm1,'same-runtime-device-buffer');
const block2AttentionTransfers=residentRoute.createTrellisDinoV3ResidentProbeTransferMetadata({residentBlock1Probe:true,residentBlock2Norm1Probe:true,residentBlock2AttentionProbe:true});
assert.equal(block2AttentionTransfers.block1OutputToBlock2AttentionResidual,'same-runtime-device-buffer');
assert.equal(block2AttentionTransfers.block2Norm1ToAttention,'same-runtime-device-buffer');
const block2MlpTransfers=residentRoute.createTrellisDinoV3ResidentProbeTransferMetadata({residentBlock1Probe:true,residentBlock2Norm1Probe:true,residentBlock2AttentionProbe:true,residentBlock2MlpProbe:true});
assert.equal(block2MlpTransfers.block2AttentionToNorm2,'same-runtime-device-buffer',
  'block-2 MLP metadata must preserve the same-device attention-residual to norm2 edge');
assert.equal(block2MlpTransfers.block2Norm2ToMlp,'same-runtime-device-buffer',
  'block-2 MLP metadata must preserve the same-device norm2-to-MLP edge');
assert.equal(typeof residentRoute.runTrellisDinoV3Block1LayerNormResident, 'function');
assert.equal(typeof residentRoute.runTrellisDinoV3LayerNormResident, 'function',
  'LayerNorm execution should be parameterized by model layer rather than copied into another block-specific kernel');
assert.equal(typeof residentRoute.runTrellisDinoV3Block2LayerNorm1Resident, 'function');
assert.equal(typeof residentRoute.runTrellisDinoV3Block1AttentionResident, 'function');
assert.equal(typeof residentRoute.runTrellisDinoV3Block1MlpResident, 'function',
  'block-1 norm2, GELU MLP, and LayerScale residual must continue from the live attention-residual tensor');
assert.equal(typeof residentRoute.assertTrellisDinoV3ResidentMlpHandoffIdentity, 'function',
  'the MLP contract must keep the exact block-1 attention residual as both norm2 input and residual');
assert.equal(typeof residentRoute.assertTrellisDinoV3ResidentBlock2Norm1HandoffIdentity, 'function');
assert.equal(typeof residentRoute.runTrellisDinoV3PrefixBlockResidentHandoffProbe, 'function');
assert.equal(typeof residentRoute.runTrellisDinoV3PrefixBlockResidentBlock1Probe, 'function');
assert.equal(typeof residentRoute.runTrellisDinoV3PrefixBlockResidentBlock2Norm1Probe, 'function',
  'block-2 norm1 must continue from the exact resident block-1 output before final diagnostic readback');
assert.equal(typeof residentRoute.runTrellisDinoV3Block2AttentionResident, 'function',
  'block-2 attention must consume the resident block-2 norm1 result and preserve the completed block-1 residual');
assert.equal(typeof residentRoute.runTrellisDinoV3PrefixBlockResidentBlock2AttentionProbe, 'function',
  'the model-local resident probe must expose block-2 attention as the next distinct diagnostic boundary');
assert.equal(typeof residentRoute.assertTrellisDinoV3ResidentBlock2AttentionHandoffIdentity, 'function',
  'the block-2 attention boundary must check normalized input and block-1 residual identities separately');
assert.equal(residentRoute.TRELLIS_DINOV3_PREFIX_BLOCK_RESIDENT_BLOCK2_ATTENTION_PROBE_ROUTE_ID,
  'trellis2.dinov3.block0-to-block2-attention.resident-probe.webgpu-local.v0');
assert.equal(residentRoute.TRELLIS_DINOV3_PREFIX_BLOCK_RESIDENT_BLOCK2_NORM1_PROBE_ROUTE_ID,
  'trellis2.dinov3.block0-to-block2-norm1.resident-probe.webgpu-local.v0');
assert.equal(typeof residentRoute.assertTrellisDinoV3ResidentAttentionHandoffIdentity, 'function',
  'the model-local probe must validate the attention input and original block-0 residual as separate identities');
assert.equal(typeof kit.runTrellisDinoV3Block1LayerNormResident, 'undefined', 'the probe kernel remains model-specific rather than expanding the shared kit root API');
assert.equal(typeof kit.runTrellisDinoV3Block1AttentionResident, 'undefined', 'block-1 attention remains model-specific rather than expanding the shared kit root API');
assert.equal(typeof kit.runTrellisDinoV3Block1MlpResident, 'undefined', 'block-1 MLP remains model-specific rather than expanding the shared kit root API');
assert.equal(typeof kit.runTrellisDinoV3PrefixBlockResidentHandoffProbe, 'undefined', 'the diagnostic probe is not promoted to the common kit API');
assert.equal(typeof kit.runTrellisDinoV3PrefixBlockResidentBlock1Probe, 'undefined', 'the full block-1 diagnostic probe is not promoted to the common kit API');
assert.equal(typeof kit.runTrellisDinoV3PrefixBlockResidentBlock2Norm1Probe, 'undefined', 'the block-2 norm1 diagnostic probe is not promoted to the common kit API');
assert.equal(typeof kit.runTrellisDinoV3Block2AttentionResident, 'undefined', 'block-2 attention remains model-specific');
assert.equal(typeof kit.runTrellisDinoV3PrefixBlockResidentBlock2AttentionProbe, 'undefined', 'the block-2 attention diagnostic is not promoted to the common kit API');
assert.equal(typeof kit.runTrellisDinoV3LayerNormResident, 'undefined', 'parameterized DINO LayerNorm stays model-specific');
assert.equal(typeof kit.runTrellisDinoV3PrefixBlockPhaseProgramRoute, 'undefined', 'the model-specific route stays out of the shared kit root API');
assert.doesNotMatch(publicIndex, /TRELLIS_DINOV3/, 'the model-specific route must not append DINOv3 symbols to the current shared root surface');
assert.equal(residentRoute.TRELLIS_DINOV3_PREFIX_BLOCK_RESIDENT_HANDOFF_PROBE_ROUTE_ID,
  'trellis2.dinov3.block0-to-block1-attention.resident-probe.webgpu-local.v0');
const block0Identity={name:'block0.live-gpu'};
const norm1Identity={name:'block1.norm1.live-gpu'};
const block1OutputIdentity={name:'block1.output.live-gpu'};
const block2Norm1Identity={name:'block2.norm1.live-gpu'};
assert.equal(residentRoute.assertTrellisDinoV3ResidentBlock2Norm1HandoffIdentity({
  residentNorm1:{inputTensor:block1OutputIdentity,tensor:block2Norm1Identity},block1Output:block1OutputIdentity,
}),true,'block-2 norm1 consumes the exact live complete block-1 output');
assert.throws(()=>residentRoute.assertTrellisDinoV3ResidentBlock2Norm1HandoffIdentity({
  residentNorm1:{inputTensor:{name:'stale.block1.output'},tensor:block2Norm1Identity},block1Output:block1OutputIdentity,
}),/exact live completed block-1 output/,'a copied or stale tensor cannot impersonate the live block-1 handoff');
assert.equal(residentRoute.assertTrellisDinoV3ResidentBlock2AttentionHandoffIdentity({
  residentAttention:{inputTensor:block2Norm1Identity,residualTensor:block1OutputIdentity},
  residentNorm1:{tensor:block2Norm1Identity},block1Output:block1OutputIdentity,
}),true,'block-2 attention consumes normalized block-1 output and adds its update to the completed block-1 residual');
assert.throws(()=>residentRoute.assertTrellisDinoV3ResidentBlock2AttentionHandoffIdentity({
  residentAttention:{inputTensor:block1OutputIdentity,residualTensor:block1OutputIdentity},
  residentNorm1:{tensor:block2Norm1Identity},block1Output:block1OutputIdentity,
}),/exact live block-2 norm1 output/,'raw block-1 output cannot substitute for normalized block-2 attention input');
assert.throws(()=>residentRoute.assertTrellisDinoV3ResidentBlock2AttentionHandoffIdentity({
  residentAttention:{inputTensor:block2Norm1Identity,residualTensor:block2Norm1Identity},
  residentNorm1:{tensor:block2Norm1Identity},block1Output:block1OutputIdentity,
}),/exact live completed block-1 output/,'the attention residual must remain the exact completed block-1 output');
assert.equal(residentRoute.assertTrellisDinoV3ResidentAttentionHandoffIdentity({
  residentHandoff:{inputTensor:norm1Identity,residualTensor:block0Identity},
  block0HiddenStates:block0Identity,
  block1Norm1HiddenStates:norm1Identity,
}),true,'attention must consume normalized block-0 while retaining the original block-0 residual');
assert.throws(()=>residentRoute.assertTrellisDinoV3ResidentAttentionHandoffIdentity({
  residentHandoff:{inputTensor:block0Identity,residualTensor:block0Identity},
  block0HiddenStates:block0Identity,
  block1Norm1HiddenStates:norm1Identity,
}),/block-1 norm1 output/,'raw block-0 must not substitute for the attention input after normalization');
assert.throws(()=>residentRoute.assertTrellisDinoV3ResidentAttentionHandoffIdentity({
  residentHandoff:{inputTensor:norm1Identity,residualTensor:norm1Identity},
  block0HiddenStates:block0Identity,
  block1Norm1HiddenStates:norm1Identity,
}),/block-0 residual/,'the attention residual must retain the exact live block-0 tensor');
const residentFilterIndex = routeImplementation.indexOf("program.phases.filter(phase => phase.name !== 'readback-trellis-dinov3-prefix-block0-outputs')");
const residentConsumerIndex = routeImplementation.indexOf('runTrellisDinoV3Block1LayerNormResident({');
const attentionConsumerIndex = routeImplementation.indexOf('runTrellisDinoV3Block1AttentionResident({');
const downstreamReadbackIndex = routeImplementation.indexOf("readback-dinov3-block1-attention-resident-probe");
assert.ok(residentFilterIndex >= 0 && residentConsumerIndex > residentFilterIndex,
  'the resident probe must omit the block-0 output-readback phase and consume block-0 in resident block-1 LayerNorm');
assert.ok(attentionConsumerIndex > residentConsumerIndex && downstreamReadbackIndex > attentionConsumerIndex,
  'block-1 attention must consume the resident LayerNorm result before the only diagnostic readback');
assert.match(routeImplementation.slice(residentConsumerIndex, residentConsumerIndex + 500), /runtime, inputTensor:tensors\.block0HiddenStates[\s\S]*schedulerInvocation:invocation/,
  'block-1 LayerNorm must receive the live runtime, block-0 GPU tensor, and current scheduler invocation');
assert.match(routeImplementation.slice(attentionConsumerIndex, attentionConsumerIndex + 900), /runtime,device:input\.device,inputTensor:norm1Output\.tensor,residualTensor:tensors\.block0HiddenStates[\s\S]*schedulerInvocation:invocation/,
  'block-1 attention must use the live normalized GPU tensor plus the exact block-0 residual on the same invocation');
assert.match(routeImplementation, /block0Readback:'skipped'/,
  'the explicit resident probe must report that block-0 was not read back to the host');
const block2ConsumerIndex=routeImplementation.indexOf('runTrellisDinoV3Block2LayerNorm1Resident({');
const block2ReadbackIndex=routeImplementation.indexOf("readback-dinov3-block2-norm1-resident-probe");
assert.ok(block2ConsumerIndex>attentionConsumerIndex&&block2ReadbackIndex>block2ConsumerIndex,
  'the resident block-2 norm1 kernel must execute after the complete block-1 consumer and before its sole diagnostic readback');
assert.match(routeImplementation.slice(block2ConsumerIndex,block2ConsumerIndex+360), /inputTensor:residentMlp\.tensor[\s\S]*block2Norm1Weight[\s\S]*block2Norm1Bias/,
  'block-2 norm1 must bind the exact live block-1 MLP residual and its layer-2 norm weights');
const block2AttentionConsumerIndex=routeImplementation.indexOf('runTrellisDinoV3Block2AttentionResident({');
assert.ok(block2AttentionConsumerIndex>block2ConsumerIndex,
  'block-2 attention must execute only after the resident block-2 norm1 producer');
assert.match(routeImplementation.slice(block2AttentionConsumerIndex,block2AttentionConsumerIndex+700), /inputTensor:residentBlock2Norm1\.tensor,residualTensor:residentMlp\.tensor[\s\S]*residentWeights\.block2Attention[\s\S]*ropeCos:weights\.ropeCos/,
  'block-2 attention must consume norm1, use completed block-1 as residual, and reuse pinned patch RoPE');
assert.match(referenceExporter, /block1_norm1_hidden_states = block1\.norm1\(block0_hidden_states\)[\s\S]*block1_attention_output = block1\.attention\(block1_norm1_hidden_states, cos, sin, model\.num_prefix_tokens\)[\s\S]*block1_after_attention_hidden_states = block0_hidden_states \+ block1_attention_output \* block1\.layer_scale1/,
  'the MLX reference must reproduce native DINOv3 block-1 attention and its LayerScale residual as the resident-consumer oracle');
assert.match(referenceExporter, /import mlx\.nn as nn/,
  'the MLX reference must use the native MLX neural-network namespace for GELU');
assert.match(referenceExporter, /block1_norm2_hidden_states = block1\.norm2\(block1_after_attention_hidden_states\)[\s\S]*block1_mlp_hidden_states = nn\.gelu\(block1\.mlp\.up_proj\(block1_norm2_hidden_states\)\)[\s\S]*block1_mlp_output = block1\.mlp\.down_proj\(block1_mlp_hidden_states\)[\s\S]*block1_after_mlp_hidden_states = block1_after_attention_hidden_states \+ block1_mlp_output \* block1\.layer_scale2/,
  'the MLX reference must expose native block-1 norm2, GELU up/down projections, and the exact LayerScale residual');
assert.match(referenceExporter, /block2_norm1_hidden_states = block2\.norm1\(block1_after_mlp_hidden_states\)[\s\S]*block2_attention_output = block2\.attention\(block2_norm1_hidden_states, cos, sin, model\.num_prefix_tokens\)[\s\S]*block2_after_attention_hidden_states = block1_after_mlp_hidden_states \+ block2_attention_output \* block2\.layer_scale1/,
  'the MLX reference must execute block-2 attention from norm1 and retain the completed block-1 residual');
assert.ok(/residentBlock2AttentionOutputBoundary": "after two complete transformer blocks and block 2 attention residual; before block 2 norm2 and final model LayerNorm"/.test(referenceExporter),
  'the block-2 attention output must be marked as a partial block boundary');
assert.doesNotMatch(referenceExporter, /mx\.gelu\(/,
  'mlx.core has no gelu symbol in the pinned runtime; the reference must not use it');
assert.match(implementation, /trellis2\.dinov3\.block0-to-block1-full-block\.resident-probe\.webgpu-local\.v0/,
  'the full block-1 probe must have a route identity distinct from the attention-only probe');
assert.match(browserSmoke, /mode === 'resident-block1'/,
  'the browser harness must expose a separately named full block-1 mode');
assert.match(browserSmoke, /mode === 'resident-block2-norm1'/,
  'the browser harness must expose the partial block-2 norm1 mode without relabeling it as a full block');
assert.match(browserSmoke, /mode === 'resident-block2-attention'/,
  'the browser harness must expose block-2 attention as a separate partial-block mode');
assert.match(browserSmoke, /residentBlock2AttentionMode\s*\?\s*'trellis2\.dinov3\.block0-to-block2-attention\.resident-probe\.webgpu-local\.v0'/,
  'the browser must request the exact block-2 attention route instead of inheriting block-2 norm1 identity');
assert.match(browserSmoke, /runTrellisDinoV3PrefixBlockResidentBlock2Norm1Probe/,
  'the block-2 browser mode must execute the model-local resident route');
assert.match(browserRunner, /resident-block1/,
  'the runner must validate and preserve the full block-1 mode rather than relabeling the attention-only route');
assert.match(browserRunner, /resident-block2-norm1/,
  'the browser runner must preserve block-2 norm1 as its own requested/effective route identity');
assert.match(parityAssay, /residentBlock1Probe/,
  'the composite same-job assay must require the full block-1 reference identity');
assert.match(browserSmoke, /runTrellisDinoV3PrefixBlockResidentHandoffProbe/,
  'the live browser witness must exercise the resident probe API');

const { WEBGPU_BUFFER_USAGE } = await import('../src/runtime-primitives.js');
const sourceTensor = { name:'block0.source', shape:[1,1029,1024], dtype:'f32', usage:WEBGPU_BUFFER_USAGE.storage, buffer:{} };
let residentKernel = null;
let residentDispatch = null;
let residentReadbacks = 0;
const residentRuntime = {
  createTensor(input) { return { ...input, buffer:{} }; },
  uploadTensor() {},
  createUniformBuffer(input) { return { ...input, buffer:{} }; },
  defineComputeKernel(input) { residentKernel=input; return input; },
  async runKernel(kernel, options) { residentDispatch={ kernel, options }; },
  async readTensor() { residentReadbacks+=1; return new ArrayBuffer(0); },
};
const residentLayerNorm = await residentRoute.runTrellisDinoV3Block1LayerNormResident({
  runtime:residentRuntime, inputTensor:sourceTensor,
  weight:new Float32Array(1024).fill(1), bias:new Float32Array(1024),
  schedulerInvocation:{ invocationId:'resident-contract-invocation' },
});
assert.equal(residentLayerNorm.inputTensor, sourceTensor, 'the consumer keeps the exact live block-0 tensor object');
assert.equal(residentKernel.bindings[0].resource, sourceTensor, 'the kernel binds block-0 GPU storage directly, without a host tensor copy');
assert.equal(residentDispatch.kernel, residentKernel);
assert.deepEqual(residentDispatch.options.dispatch, [1029]);
assert.equal(residentReadbacks, 0, 'resident consumer setup/dispatch must not require a host readback');
assert.deepEqual(residentLayerNorm.shape, [1,1029,1024]);

const block2InputTensor={name:'block1.output.live-gpu',shape:[1,1029,1024],dtype:'f32',usage:WEBGPU_BUFFER_USAGE.storage,buffer:{}};
const block2LayerNormStages=[];
const block2LayerNormKernels=[];
const block2LayerNormRuntime={
  createTensor(input) { return { ...input,buffer:{} }; },
  uploadTensor() {},
  createUniformBuffer(input) { return { ...input,buffer:{} }; },
  defineComputeKernel(input) { block2LayerNormKernels.push(input); return input; },
  async runKernel(kernel,options) { block2LayerNormStages.push({kernel,options}); },
  async readTensor() { throw new Error('block-2 norm1 must not read back before the final diagnostic stage'); },
};
const block2LayerNorm=await residentRoute.runTrellisDinoV3Block2LayerNorm1Resident({
  runtime:block2LayerNormRuntime,inputTensor:block2InputTensor,
  weight:new Float32Array(1024).fill(1),bias:new Float32Array(1024),
  schedulerInvocation:{invocationId:'resident-contract-invocation'},
});
assert.equal(block2LayerNorm.inputTensor,block2InputTensor);
assert.equal(block2LayerNormKernels[0].bindings[0].resource,block2InputTensor,
  'block-2 norm1 binds the exact block-1 GPU output without a host copy');
assert.equal(block2LayerNormStages[0].options.stage,'dinov3-block2-layernorm1-resident');
assert.equal(block2LayerNorm.tensor.name,'trellis.dinov3.block2.norm1.output');
assert.deepEqual(block2LayerNorm.shape,[1,1029,1024]);
assert.equal(block2LayerNormStages.length,1);

const norm1Tensor={name:'block1.norm1',shape:[1,1029,1024],dtype:'f32',usage:WEBGPU_BUFFER_USAGE.storage,buffer:{}};
const block1Stages=[];
const block1Kernels=[];
const block1Runtime={
  createTensor(input) { return { ...input,buffer:{} }; },
  uploadTensor() {},
  createUniformBuffer(input) { return { ...input,buffer:{} }; },
  defineComputeKernel(input) { block1Kernels.push(input); return input; },
  async runKernel(kernel,options) { block1Stages.push({kernel,options}); },
};
const block1LinearWeights={
  qWeight:new Float32Array(1024*1024),qBias:new Float32Array(1024),kWeight:new Float32Array(1024*1024),
  vWeight:new Float32Array(1024*1024),vBias:new Float32Array(1024),oWeight:new Float32Array(1024*1024),
  oBias:new Float32Array(1024),layerScale1:new Float32Array(1024),
  ropeCos:new Float32Array(1024*64),ropeSin:new Float32Array(1024*64),
};
const residentAttention=await residentRoute.runTrellisDinoV3Block1AttentionResident({
  runtime:block1Runtime,inputTensor:norm1Tensor,residualTensor:sourceTensor,...block1LinearWeights,
  schedulerInvocation:{invocationId:'resident-contract-invocation'},
});
assert.equal(residentAttention.inputTensor,norm1Tensor,'attention consumes the exact resident block-1 LayerNorm output');
assert.equal(residentAttention.residualTensor,sourceTensor,'attention residual uses the exact resident block-0 tensor');
assert.equal(residentAttention.tensor.usage & WEBGPU_BUFFER_USAGE.copySrc,WEBGPU_BUFFER_USAGE.copySrc,'only the final attention-residual output is eligible for diagnostic readback');
assert.equal(block1Stages.length,10,'block-1 attention dispatches q/k/v, RoPE, score, softmax, context, projection, and residual without an internal readback');
assert.deepEqual(block1Stages.map(({options})=>options.stage),[
  'dinov3-block1-qkv-projection-resident','dinov3-block1-qkv-projection-resident','dinov3-block1-qkv-projection-resident',
  'dinov3-block1-patch-rope-resident','dinov3-block1-patch-rope-resident',
  'dinov3-block1-global-attention-resident','dinov3-block1-global-attention-resident','dinov3-block1-global-attention-resident',
  'dinov3-block1-output-residual-resident','dinov3-block1-output-residual-resident',
]);
assert.equal(block1Kernels.find(kernel=>kernel.name.endsWith('attention.layer-scale-residual')).bindings[0].resource,sourceTensor,
  'the DINOv3 block-1 attention residual is rooted at the original block-0 hidden-state buffer');
assert.equal(residentAttention.operation,'dinov3-block1-attention-residual');
assert.deepEqual(residentAttention.shape,[1,1029,1024]);

const block2AttentionStages=[];
const block2AttentionKernels=[];
const block2AttentionRuntime={
  createTensor(input) { return { ...input,buffer:{} }; },
  uploadTensor() {},
  createUniformBuffer(input) { return { ...input,buffer:{} }; },
  defineComputeKernel(input) { block2AttentionKernels.push(input); return input; },
  async runKernel(kernel,options) { block2AttentionStages.push({kernel,options}); },
};
const residentBlock2Attention=await residentRoute.runTrellisDinoV3Block2AttentionResident({
  runtime:block2AttentionRuntime,inputTensor:block2LayerNorm.tensor,residualTensor:block2InputTensor,
  ...block1LinearWeights,schedulerInvocation:{invocationId:'resident-contract-invocation'},
});
assert.equal(residentBlock2Attention.inputTensor,block2LayerNorm.tensor,
  'block-2 attention consumes the exact resident block-2 LayerNorm result');
assert.equal(residentBlock2Attention.residualTensor,block2InputTensor,
  'block-2 attention residual uses the exact completed block-1 output');
assert.deepEqual(block2AttentionStages.map(({options})=>options.stage),[
  'dinov3-block2-qkv-projection-resident','dinov3-block2-qkv-projection-resident','dinov3-block2-qkv-projection-resident',
  'dinov3-block2-patch-rope-resident','dinov3-block2-patch-rope-resident',
  'dinov3-block2-global-attention-resident','dinov3-block2-global-attention-resident','dinov3-block2-global-attention-resident',
  'dinov3-block2-output-residual-resident','dinov3-block2-output-residual-resident',
]);
assert.equal(block2AttentionKernels.find(kernel=>kernel.name.endsWith('attention.layer-scale-residual')).bindings[0].resource,block2InputTensor,
  'block-2 LayerScale residual is sourced from block-1 output rather than block-2 norm1');
assert.equal(residentBlock2Attention.operation,'dinov3-block2-attention-residual');
assert.equal(residentRoute.assertTrellisDinoV3ResidentBlock2AttentionHandoffIdentity({
  residentAttention:residentBlock2Attention,residentNorm1:block2LayerNorm,block1Output:block2InputTensor,
}),true);

const mlpStages=[];
const mlpKernels=[];
const mlpRuntime={
  createTensor(input) { return { ...input,buffer:{} }; },
  uploadTensor() {},
  createUniformBuffer(input) { return { ...input,buffer:{} }; },
  defineComputeKernel(input) { mlpKernels.push(input); return input; },
  async runKernel(kernel,options) { mlpStages.push({kernel,options}); },
};
const mlpPhaseEvents=[];
const mlpWeights={
  norm2Weight:new Float32Array(1024).fill(1),norm2Bias:new Float32Array(1024),
  mlpUpWeight:new Float32Array(4096*1024),mlpUpBias:new Float32Array(4096),
  mlpDownWeight:new Float32Array(1024*4096),mlpDownBias:new Float32Array(1024),
  layerScale2:new Float32Array(1024),
};
const residentMlp=await residentRoute.runTrellisDinoV3Block1MlpResident({
  runtime:mlpRuntime,device:{limits:{maxComputeWorkgroupsPerDimension:65535}},
  inputTensor:residentAttention.tensor,residualTensor:residentAttention.tensor,...mlpWeights,
  schedulerInvocation:{invocationId:'resident-contract-invocation'},
  onPhase:event=>mlpPhaseEvents.push(event.phase),
});
assert.equal(residentMlp.inputTensor,residentAttention.tensor,'norm2 consumes the exact live attention-residual tensor');
assert.equal(residentMlp.residualTensor,residentAttention.tensor,'the MLP residual uses that same attention-residual tensor');
assert.equal(residentMlp.tensor.usage & WEBGPU_BUFFER_USAGE.copySrc,WEBGPU_BUFFER_USAGE.copySrc,
  'the final MLP-residual output can be read back only after the resident chain');
assert.equal(mlpStages.length,4,'block-1 MLP submits norm2, GELU up projection, down projection, then LayerScale residual');
assert.deepEqual(mlpStages.map(({options})=>options.stage),[
  'dinov3-block1-layernorm2-resident','dinov3-block1-mlp-up-resident',
  'dinov3-block1-mlp-down-resident','dinov3-block1-mlp-residual-resident',
]);
assert.deepEqual(mlpPhaseEvents,mlpStages.map(({options})=>options.stage),
  'failure progress must name each exact resident block-1 MLP stage before dispatch');
assert.deepEqual(residentMlp.mlpHiddenTensor.shape,[1,1029,4096]);
assert.match(mlpKernels.find(kernel=>kernel.name.endsWith('mlp-up')).code,/gelu_exact_approx/,
  'the MLP up projection must use the F32 GELU shader law');
assert.equal(mlpKernels.find(kernel=>kernel.name.endsWith('norm2')).bindings[0].resource,residentAttention.tensor,
  'block-1 norm2 reads the resident attention residual directly');
assert.equal(mlpKernels.find(kernel=>kernel.name.endsWith('mlp-up')).bindings[0].resource,residentMlp.norm2Tensor,
  'the GELU up projection consumes the resident norm2 output');
assert.equal(mlpKernels.find(kernel=>kernel.name.endsWith('mlp-up')).bindings[3].resource,residentMlp.mlpHiddenTensor,
  'the GELU up projection writes the resident intermediate tensor');
assert.equal(mlpKernels.find(kernel=>kernel.name.endsWith('mlp-down')).bindings[0].resource,residentMlp.mlpHiddenTensor,
  'the down projection consumes the GELU-activated resident intermediate');
assert.equal(mlpKernels.find(kernel=>kernel.name.endsWith('mlp.layer-scale-residual')).bindings[0].resource,residentAttention.tensor,
  'block-1 MLP LayerScale residual is rooted at the exact attention-residual tensor');
assert.equal(residentRoute.assertTrellisDinoV3ResidentMlpHandoffIdentity({
  residentMlp,attentionResidual:residentAttention.tensor,
}),true);
assert.throws(()=>residentRoute.assertTrellisDinoV3ResidentMlpHandoffIdentity({
  residentMlp:{...residentMlp,inputTensor:sourceTensor},attentionResidual:residentAttention.tensor,
}),/exact live block-1 attention residual/);
await assert.rejects(()=>residentRoute.runTrellisDinoV3Block1MlpResident({
  runtime:mlpRuntime,inputTensor:residentAttention.tensor,residualTensor:residentAttention.tensor,
  ...mlpWeights,mlpUpWeight:new Uint16Array(4096*1024),
}),/block1MlpUpWeight must be a Float32Array/,
'the resident MLP must reject reduced-precision checkpoint weights rather than silently converting them');

assert.equal(typeof residentRoute.runTrellisDinoV3Block2MlpResident,'function',
  'block-2 needs a model-local resident norm2/GELU-MLP/LayerScale executor, not a readback/restart between attention and MLP');
const block2MlpStages=[];
const block2MlpKernels=[];
const block2MlpRuntime={
  createTensor(input) { return { ...input,buffer:{} }; },
  uploadTensor() {},
  createUniformBuffer(input) { return { ...input,buffer:{} }; },
  defineComputeKernel(input) { block2MlpKernels.push(input); return input; },
  async runKernel(kernel,options) { block2MlpStages.push({kernel,options}); },
};
const residentBlock2Mlp=await residentRoute.runTrellisDinoV3Block2MlpResident({
  runtime:block2MlpRuntime,device:{limits:{maxComputeWorkgroupsPerDimension:65535}},
  inputTensor:residentBlock2Attention.tensor,residualTensor:residentBlock2Attention.tensor,
  block2Norm2Weight:mlpWeights.norm2Weight,block2Norm2Bias:mlpWeights.norm2Bias,
  block2MlpUpWeight:mlpWeights.mlpUpWeight,block2MlpUpBias:mlpWeights.mlpUpBias,
  block2MlpDownWeight:mlpWeights.mlpDownWeight,block2MlpDownBias:mlpWeights.mlpDownBias,
  block2LayerScale2:mlpWeights.layerScale2,
  schedulerInvocation:{invocationId:'resident-contract-invocation'},
});
assert.equal(residentBlock2Mlp.inputTensor,residentBlock2Attention.tensor);
assert.equal(residentBlock2Mlp.residualTensor,residentBlock2Attention.tensor);
assert.deepEqual(block2MlpStages.map(({options})=>options.stage),[
  'dinov3-block2-layernorm2-resident','dinov3-block2-mlp-up-resident',
  'dinov3-block2-mlp-down-resident','dinov3-block2-mlp-residual-resident',
]);
assert.equal(block2MlpKernels.find(kernel=>kernel.name.endsWith('norm2')).bindings[0].resource,residentBlock2Attention.tensor);
assert.equal(block2MlpKernels.find(kernel=>kernel.name.endsWith('mlp.layer-scale-residual')).bindings[0].resource,residentBlock2Attention.tensor);
assert.equal(residentBlock2Mlp.operation,'dinov3-block2-mlp-residual');
assert.deepEqual(residentBlock2Mlp.mlpHiddenTensor.shape,[1,1029,4096]);
assert.equal(residentRoute.assertTrellisDinoV3ResidentBlock2MlpHandoffIdentity({
  residentMlp:residentBlock2Mlp,attentionResidual:residentBlock2Attention.tensor,
}),true);
await assert.rejects(()=>residentRoute.runTrellisDinoV3Block2MlpResident({
  runtime:block2MlpRuntime,inputTensor:residentBlock2Attention.tensor,residualTensor:residentBlock2Attention.tensor,
  block2Norm2Weight:mlpWeights.norm2Weight,block2Norm2Bias:mlpWeights.norm2Bias,
  block2MlpUpWeight:new Uint16Array(4096*1024),block2MlpUpBias:mlpWeights.mlpUpBias,
  block2MlpDownWeight:mlpWeights.mlpDownWeight,block2MlpDownBias:mlpWeights.mlpDownBias,
  block2LayerScale2:mlpWeights.layerScale2,
}),/block2MlpUpWeight must be a Float32Array/,
'the block-2 MLP must reject reduced precision instead of silently converting a checkpoint tensor');

console.log('TRELLIS DINOv3 prefix/block-0 phase-program contracts passed');
