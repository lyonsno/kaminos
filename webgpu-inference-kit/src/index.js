export {
  assertAuthoritativeRouteReceipt,
  createWebGpuLocalRouteReceipt,
  validateRouteReceipt,
  WEBGPU_ROUTE_RECEIPT_SCHEMA,
} from './route-receipt.js';

export {
  defineTensorManifest,
  validateTensorManifest,
} from './tensor-manifest.js';

export {
  WEBGPU_BUFFER_USAGE,
  WEBGPU_COMPUTE_KERNEL_SCHEMA,
  WEBGPU_SHADER_STAGE,
  WEBGPU_TENSOR_SCHEMA,
  WEBGPU_UNIFORM_BUFFER_SCHEMA,
  assertTensorDataByteLength,
  createGpuTensor,
  createUniformBuffer,
  defineComputeKernel,
  packUniforms,
} from './runtime-primitives.js';

export {
  WEBGPU_PHASE_PROGRAM_RUN_SCHEMA,
  WEBGPU_PHASE_PROGRAM_SCHEMA,
  defineWebGpuPhaseProgram,
  runWebGpuPhaseProgram,
} from './phase-program.js';

export {
  WEBGPU_INFERENCE_RUNTIME_SCHEMA,
  createCooperativeYield,
  createWebGpuInferenceRuntime,
  createWebGpuResourceCaches,
} from './inference-runtime.js';

export {
  createWebGpuBackendIdentity,
  createWebGpuDeviceRequest,
  requestBrowserWebGpuDevice,
  validateWebGpuBackendIdentity,
} from './gpu-environment.js';

export {
  addStagedSubmitStage,
  createStagedSubmitProfile,
  finishStagedSubmitProfile,
  validateStagedSubmitProfile,
} from './staged-profile.js';

export {
  WEBGPU_INFERENCE_KIT_VERSION,
  createKernelProfileMetadata,
  createRouteKernelProfileMetadata,
  createRouteTimingMetadata,
  validateKernelProfileMetadata,
  validateRouteTimingMetadata,
} from './kernel-profile.js';

export {
  createWebGpuRuntimeProfile,
  createWebGpuRuntimeProfileInput,
  validateWebGpuRuntimeProfile,
  WEBGPU_RUNTIME_PROFILE_SCHEMA,
} from './runtime-profile.js';

export {
  createWebGpuRouteBackpressureProfile,
  createWebGpuRouteSchedulerProfile,
  validateWebGpuRouteBackpressureProfile,
  validateWebGpuRouteSchedulerProfile,
  WEBGPU_ROUTE_BACKPRESSURE_SCHEMA,
  WEBGPU_ROUTE_SCHEDULER_SCHEMA,
} from './scheduler-backpressure.js';

export {
  SCHEDULER_EVENT_TRACE_SCHEMA,
  SCHEDULER_VERIFICATION_RECEIPT_SCHEMA,
  classifySchedulerVerificationReceipt,
  createSchedulerVerificationReceipt,
  validateSchedulerVerificationReceipt,
} from './scheduler-verification-receipt.js';

export {
  SHARP_BREATHING_ROOM_SINGLE_PAIR_CLAIM_BOUNDARY,
  SHARP_BREATHING_ROOM_VALIDATION_SCHEMA,
  classifySharpBreathingRoomComparisonEvidence,
  validateSharpBreathingRoomComparisonEvidence,
} from './sharp-breathing-room-validation.js';

export {
  classifyWebGpuRouteReceiptEvidence,
  classifyWebGpuRouteWorkerResultEvidence,
  WEBGPU_ROUTE_EVIDENCE_CLASSIFICATION_SCHEMA,
} from './route-receipt-consumer.js';

export {
  MOGE_DEPTH_NORMAL_ROUTE_ID,
  createMogeDepthNormalRouteDefinition,
  createMogeDepthNormalRouteReceipt,
} from './moge-route.js';

export {
  SHARP_IMAGE_TO_SPLAT_ROUTE_ID,
  createSharpImageToSplatRouteDefinition,
  createSharpImageToSplatRouteReceipt,
} from './sharp-route.js';

export {
  KIMODO_TEXT_TO_MOTION_ROUTE_ID,
  createKimodoTextToMotionRouteDefinition,
  createKimodoTextToMotionRouteReceipt,
} from './kimodo-route.js';

export {
  SF3D_IMAGE_TO_MESH_ROUTE_ID,
  createSf3dImageToMeshRouteDefinition,
  createSf3dImageToMeshRouteReceipt,
} from './sf3d-route.js';

export {
  SAM3_MASK_DECODER_ISLAND_ROUTE_ID,
  createSam3MaskDecoderIslandRouteDefinition,
  createSam3MaskDecoderIslandRouteReceipt,
  createSam3MaskProjectionCpuOracle,
  runSam3MaskDecoderIslandRoute,
} from './sam-mask-decoder-island.js';

export {
  SAM3_MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
  createSam3MaskTailPhaseProgramCpuOracle,
  createSam3MaskTailPhaseProgramRouteDefinition,
  createSam3MaskTailPhaseProgramRouteReceipt,
  runSam3MaskTailPhaseProgramRoute,
} from './sam-mask-tail-phase-program.js';

export {
  SAM3_IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID,
  createSam3ImagePreprocessPhaseProgramCpuOracle,
  createSam3ImagePreprocessPhaseProgramRouteDefinition,
  createSam3ImagePreprocessPhaseProgramRouteReceipt,
  runSam3ImagePreprocessPhaseProgramRoute,
} from './sam-image-preprocess-phase-program.js';

export {
  SAM3_IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID,
  createSam3ImagePatchEmbedPhaseProgramCpuOracle,
  createSam3ImagePatchEmbedPhaseProgramRouteDefinition,
  createSam3ImagePatchEmbedPhaseProgramRouteReceipt,
  runSam3ImagePatchEmbedPhaseProgramRoute,
} from './sam-image-patch-embed-phase-program.js';

export {
  SAM3_IMAGE_VIT_PREFIX_PHASE_PROGRAM_ROUTE_ID,
  createSam3ImageVitPrefixPhaseProgramCpuOracle,
  createSam3ImageVitPrefixPhaseProgramRouteDefinition,
  createSam3ImageVitPrefixPhaseProgramRouteReceipt,
  runSam3ImageVitPrefixPhaseProgramRoute,
} from './sam-image-vit-prefix-phase-program.js';

export {
  SAM3_IMAGE_VIT_FIRST_BLOCK_PHASE_PROGRAM_ROUTE_ID,
  createSam3ImageVitFirstBlockPhaseProgramCpuOracle,
  createSam3ImageVitFirstBlockPhaseProgramRouteDefinition,
  createSam3ImageVitFirstBlockPhaseProgramRouteReceipt,
  runSam3ImageVitFirstBlockPhaseProgramRoute,
} from './sam-image-vit-first-block-phase-program.js';

export {
  SAM3_IMAGE_VIT_BLOCK_STACK_PHASE_PROGRAM_ROUTE_ID,
  createSam3ImageVitBlockStackPhaseProgramCpuOracle,
  createSam3ImageVitBlockStackPhaseProgramRouteDefinition,
  createSam3ImageVitBlockStackPhaseProgramRouteReceipt,
  runSam3ImageVitBlockStackPhaseProgramRoute,
  summarizeSam3FinitePhaseOutputs,
  summarizeSam3FiniteValues,
  summarizeSam3LayerParityCheckpoint,
  stableSam3Gelu,
} from './sam-image-vit-block-stack-phase-program.js';

export {
  SAM31_PROPAGATION_NECK_PHASE_PROGRAM_ROUTE_ID,
  SAM3_IMAGE_FPN_NECK_PHASE_PROGRAM_ROUTE_ID,
  createSam31PropagationNeckPhaseProgramCpuOracle,
  createSam31PropagationNeckPhaseProgramRouteDefinition,
  createSam31PropagationNeckPhaseProgramRouteReceipt,
  createSam3ImageFpnNeckPhaseProgramCpuOracle,
  createSam3ImageFpnNeckPhaseProgramRouteDefinition,
  createSam3ImageFpnNeckPhaseProgramRouteReceipt,
  runSam31PropagationNeckPhaseProgramRoute,
  runSam3ImageFpnNeckPhaseProgramRoute,
} from './sam-image-fpn-neck-phase-program.js';

export {
  SAM31_MEMORY_ENCODER_PHASE_PROGRAM_ROUTE_ID,
  SAM31_MEMORY_ENCODER_WEBGPU_CONTRACT,
  createSam31MemoryEncoderPhaseProgramCpuOracle,
  createSam31MemoryEncoderPhaseProgramRouteDefinition,
  createSam31MemoryEncoderPhaseProgramRouteReceipt,
  runSam31MemoryEncoderPhaseProgramRoute,
} from './sam31-memory-encoder-phase-program.js';

export {
  classifySam31PropagationMemoryAdapter,
  evaluateSam31PropagationMemoryEvidence,
} from './sam31-propagation-memory-evidence.js';

export {
  MEMORY_ATTENTION_ONLINE_SOFTMAX_WGSL,
  SAM31_MEMORY_ATTENTION_PHASE_PROGRAM_ROUTE_ID,
  applySam31AxialRope,
  createSam31MemoryAttentionPhaseProgramCpuOracle,
  createSam31MemoryAttentionPhaseProgramRouteDefinition,
  createSam31MemoryAttentionPhaseProgramRouteReceipt,
  runSam31MemoryAttentionPhaseProgramRoute,
} from './sam31-memory-attention-phase-program.js';

export {
  classifySam31MemoryAttentionAdapter,
  evaluateSam31MemoryAttentionEvidence,
} from './sam31-memory-attention-evidence.js';

export {
  SAM3_PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID,
  createSam3PixelDecoderPhaseProgramCpuOracle,
  createSam3PixelDecoderPhaseProgramRouteDefinition,
  createSam3PixelDecoderPhaseProgramRouteReceipt,
  runSam3PixelDecoderPhaseProgramRoute,
} from './sam-pixel-decoder-phase-program.js';

export {
  SAM3_PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID,
  createSam3PromptFpnPhaseProgramCpuOracle,
  createSam3PromptFpnPhaseProgramRouteDefinition,
  createSam3PromptFpnPhaseProgramRouteReceipt,
  runSam3PromptFpnPhaseProgramRoute,
} from './sam-prompt-fpn-phase-program.js';

export {
  SAM3_PROMPT_TEXT_INGRESS_PHASE_PROGRAM_ROUTE_ID,
  createSam3PromptTextIngressPhaseProgramCpuOracle,
  createSam3PromptTextIngressPhaseProgramRouteDefinition,
  createSam3PromptTextIngressPhaseProgramRouteReceipt,
  runSam3PromptTextIngressPhaseProgramRoute,
} from './sam-prompt-text-ingress-phase-program.js';

export {
  createSam3ClipTokenizer,
  normalizeSam3ClipPrompt,
  parseSam3ClipMerges,
} from './sam-prompt-tokenizer.js';

export {
  SAM3_DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID,
  createSam3DetrEncoderPhaseProgramCpuOracle,
  createSam3DetrEncoderPhaseProgramRouteDefinition,
  createSam3DetrEncoderPhaseProgramRouteReceipt,
  runSam3DetrEncoderPhaseProgramRoute,
} from './sam-detr-encoder-phase-program.js';

export {
  createSam3DetrImageIngressFromFpnFeatures,
  createSam3PositionEmbeddingSine,
} from './sam-detr-image-ingress.js';

export {
  SAM3_DETR_DECODER_PHASE_PROGRAM_ROUTE_ID,
  createSam3DetrDecoderPhaseProgramCpuOracle,
  createSam3DetrDecoderPhaseProgramRouteDefinition,
  createSam3DetrDecoderPhaseProgramRouteReceipt,
  runSam3DetrDecoderPhaseProgramRoute,
} from './sam-detr-decoder-phase-program.js';

export {
  SAM3_SCORING_PHASE_PROGRAM_ROUTE_ID,
  createSam3ScoringPhaseProgramCpuOracle,
  createSam3ScoringPhaseProgramRouteDefinition,
  createSam3ScoringPhaseProgramRouteReceipt,
  runSam3ScoringPhaseProgramRoute,
} from './sam-scoring-phase-program.js';

export {
  SAM3_SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID,
  createSam3SelectionPostprocessPhaseProgramCpuOracle,
  createSam3SelectionPostprocessPhaseProgramRouteDefinition,
  createSam3SelectionPostprocessPhaseProgramRouteReceipt,
  runSam3SelectionPostprocessPhaseProgramRoute,
} from './sam-selection-postprocess-phase-program.js';

export {
  createWebGpuRouteSchemaContract,
} from './route-schema-contract.js';

export {
  SAM3_BROWSER_INVOCATION_SCHEMA,
  SAM3_BROWSER_MODEL_PACKAGE_SCHEMA,
  SAM3_BROWSER_VERIFICATION_SCHEMA,
  createSam3BrowserStaticArtifactCache,
  createSam3DualInvocationEvidence,
  resolveSam3BrowserArtifactUrl,
  resolveSam3BrowserPackageManifest,
  resolveSam3BrowserPackageManifestSync,
} from './sam-browser-package-manifest.js';

export {
  createRouteReceiptArtifacts,
  createRouteReceiptInputArtifact,
  createWebGpuRouteReceiptFromArtifacts,
  finishAndValidateRouteProfile,
  validateRouteReceiptArtifact,
  validateRouteReceiptBackendIdentity,
} from './route-receipt-helper.js';

export {
  assertAuthoritativeRouteWorkerResult,
  createRouteInvocationRequest,
  createRouteWorkerResult,
  createWebGpuRouteRegistry,
  defineWebGpuRoute,
  validateRouteDefinition,
  validateRouteInvocationRequest,
  validateRouteWorkerResult,
  WEBGPU_ROUTE_DEFINITION_SCHEMA,
  WEBGPU_ROUTE_REQUEST_SCHEMA,
  WEBGPU_ROUTE_RESULT_SCHEMA,
} from './route-boundary.js';
