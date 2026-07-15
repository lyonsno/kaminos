function sha256Hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export const SAM31_TEMPORAL_PACKET_AUTHORITY = Object.freeze({
  manifestSchema: 'kaminos.sam31-temporal-memory-bank-meta-packet.v0',
  receiptSchema: 'kaminos.sam31-temporal-memory-bank-meta-reference-receipt.v0',
  routeId: 'sam3.1.temporal-memory-bank.phase-program.webgpu-local.v0',
  modelId: 'facebook/sam3.1',
  modelRevision: 'daa63191845a41281374e725f4c9e51c7a824460',
  checkpointSha256: 'sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6',
  sourceRepository: 'facebookresearch/sam3',
  sourceCommit: '5dd401d1c5c1d5c3eedff06d41b77af824517619',
});

const TWO_FRAME_REFERENCE = Object.freeze({
  modelId: 'facebook/sam3.1',
  modelRevision: 'daa63191845a41281374e725f4c9e51c7a824460',
  checkpointSha256: 'sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6',
  sourceRepository: 'facebookresearch/sam3',
  sourceCommit: '5dd401d1c5c1d5c3eedff06d41b77af824517619',
});

export const SAM31_TWO_IMAGE_INGRESS_PACKET_AUTHORITY = Object.freeze({
  manifestSchema: 'kaminos.sam31-two-image-ingress-meta-packet.v0',
  receiptSchema: 'kaminos.sam31-two-image-ingress-meta-reference-receipt.v0',
  boundary: 'sam31-two-distinct-raw-images-to-interactive-propagation-backbone-features',
  modelId: 'facebook/sam3.1',
  modelRevision: TWO_FRAME_REFERENCE.modelRevision,
  checkpointSha256: TWO_FRAME_REFERENCE.checkpointSha256,
  sourceCommit: TWO_FRAME_REFERENCE.sourceCommit,
  routeIds: Object.freeze([
    'sam3.image-preprocess.phase-program.webgpu-local.v0',
    'sam3.image-patch-embed.phase-program.webgpu-local.v0',
    'sam3.image-vit-prefix.phase-program.webgpu-local.v0',
    'sam3.image-vit-block-stack.phase-program.webgpu-local.v0',
    'sam3.1.interactive-neck.phase-program.webgpu-local.v0',
    'sam3.1.image-propagation-neck.phase-program.webgpu-local.v0',
    'sam3.1.decoder-high-resolution-projection.phase-program.webgpu-local.v0',
  ]),
});

const TWO_FRAME_EPISODE_SHAPE = Object.freeze({
  batch: 1,
  multiplexCount: 16,
  queryHeight: 2,
  queryWidth: 2,
  queryTokens: 4,
  memorySpatialTokens: 4,
  numObjPtrTokens: 16,
  memoryTokens: 20,
  channels: 256,
  maskHeight: 8,
  maskWidth: 8,
  sourceImageHeight: 28,
  sourceImageWidth: 28,
  sourceMaskHeight: 32,
  sourceMaskWidth: 32,
  promptMaskHeight: 8,
  promptMaskWidth: 8,
  decoderMaskHeight: 8,
  decoderMaskWidth: 8,
  memoryInputMaskHeight: 8,
  memoryInputMaskWidth: 8,
});

const MASK_CONDITIONED_TWO_FRAME_EPISODE_SHAPE = Object.freeze({
  ...TWO_FRAME_EPISODE_SHAPE,
  memoryInputMaskHeight: 32,
  memoryInputMaskWidth: 32,
});

const TWO_FRAME_DECODER_SHAPE = Object.freeze({
  batch: 1,
  multiplexCount: 16,
  maskOutputsPerObject: 3,
  attributeTokens: 32,
  maskTokens: 48,
  queryTokens: 80,
  imageHeight: 2,
  imageWidth: 2,
  imageTokens: 4,
  channels: 256,
  heads: 8,
  attentionChannels: 128,
  mlpHidden: 2048,
  maskHeight: 8,
  maskWidth: 8,
  layerCount: 2,
});

const INTERACTIVE_POINTER_SHAPE = Object.freeze({
  batch: 16,
  queryTokens: 8,
  sparsePromptTokens: 2,
  imageHeight: 2,
  imageWidth: 2,
  imageTokens: 4,
  channels: 256,
  heads: 8,
  attentionChannels: 128,
  mlpHidden: 2048,
  sourceImageHeight: 28,
  sourceImageWidth: 28,
  sourceMaskHeight: 32,
  sourceMaskWidth: 32,
  promptMaskHeight: 8,
  promptMaskWidth: 8,
  decoderMaskHeight: 8,
  decoderMaskWidth: 8,
  maskOutputs: 4,
  layerCount: 2,
});

const TWO_FRAME_MEMORY_SHAPE = Object.freeze({
  batch: 1,
  backboneHeight: 2,
  backboneWidth: 2,
  backboneChannels: 1024,
  fpnHiddenSize: 256,
  levels: [
    { level: 0, scaleFactor: 4, height: 8, width: 8 },
    { level: 1, scaleFactor: 2, height: 4, width: 4 },
    { level: 2, scaleFactor: 1, height: 2, width: 2 },
  ],
  memory: {
    featureHeight: 2,
    featureWidth: 2,
    featureChannels: 256,
    maskHeight: 8,
    maskWidth: 8,
    resampledMaskHeight: 32,
    resampledMaskWidth: 32,
    multiplexCount: 16,
    conditionChannels: true,
  },
});

const TWO_FRAME_TEMPORAL_SHAPE = Object.freeze({
  batch: 1,
  queryHeight: 2,
  queryWidth: 2,
  queryTokens: 4,
  frameTokens: 4,
  spatialFrameCount: 9,
  memorySpatialTokens: 36,
  pointerFrameCount: 10,
  multiplexCount: 16,
  numObjPtrTokens: 160,
  memoryTokens: 196,
  channels: 256,
});

const TWO_FRAME_TEMPORAL_PLAN = Object.freeze({
  frameIndex: 8,
  numFrames: 11,
  conditioningFrameIndices: [0, 1, 3, 9, 10],
  nonConditioningFrameIndices: [2, 4, 5, 6, 7],
  selectedConditioningFrameIndices: [3, 9, 10, 1],
  unselectedConditioningFrameIndices: [0],
  spatialFrameIndices: [3, 9, 10, 1, 2, 4, 5, 6, 7],
  spatialTemporalPositionIndices: [1, 6, 6, 6, 5, 3, 2, 1, 0],
  pointerFrameIndices: [3, 9, 10, 1, 7, 6, 5, 4, 2, 0],
  pointerRelativePositions: [5, 1, 2, 7, 1, 2, 3, 4, 6, 8],
  numMaskmem: 7,
  maxConditioningFrames: 4,
  maxObjectPointerFrames: 11,
  memoryTemporalStride: 1,
  useMaskmemTemporalPositionV2: true,
  trackInReverse: false,
});

const TWO_FRAME_EPISODE_PLAN = Object.freeze({
  frameIndex: 1,
  numFrames: 2,
  conditioningFrameIndices: [0],
  nonConditioningFrameIndices: [],
  selectedConditioningFrameIndices: [0],
  spatialFrameIndices: [0],
  spatialTemporalPositionIndices: [5],
  pointerFrameIndices: [0],
  pointerRelativePositions: [1],
  numMaskmem: 7,
  maxConditioningFrames: 4,
  maxObjectPointerFrames: 2,
  memoryTemporalStride: 1,
  useMaskmemTemporalPositionV2: true,
  trackInReverse: false,
});

export const SAM31_TWO_FRAME_PACKET_AUTHORITIES = Object.freeze({
  decoder: Object.freeze({
    manifestSchema: 'kaminos.sam31-multiplex-mask-decoder-meta-packet.v0',
    receiptSchema: 'kaminos.sam31-multiplex-mask-decoder-meta-reference-receipt.v0',
    boundary: 'sam31-propagation-features-to-multiplex-masks-scores-and-object-pointers',
    routeId: 'sam3.1.multiplex-mask-decoder.phase-program.webgpu-local.v0',
    shape: TWO_FRAME_DECODER_SHAPE,
  }),
  memory: Object.freeze({
    manifestSchema: 'kaminos.sam31-propagation-memory-meta-packet.v0',
    receiptSchema: 'kaminos.sam31-propagation-memory-meta-reference-receipt.v0',
    boundary: 'sam31-official-tri-neck-to-multiplex-memory-encoder',
    routeIds: Object.freeze([
      'sam3.1.propagation-neck.phase-program.webgpu-local.v0',
      'sam3.1.memory-encoder.phase-program.webgpu-local.v0',
    ]),
    shape: TWO_FRAME_MEMORY_SHAPE,
  }),
  temporal: Object.freeze({
    manifestSchema: 'kaminos.sam31-temporal-memory-bank-meta-packet.v0',
    receiptSchema: 'kaminos.sam31-temporal-memory-bank-meta-reference-receipt.v0',
    boundary: 'sam31-video-output-dictionary-to-temporal-bank-to-four-layer-memory-attention',
    routeId: 'sam3.1.temporal-memory-bank.phase-program.webgpu-local.v0',
    shape: TWO_FRAME_TEMPORAL_SHAPE,
    plan: TWO_FRAME_TEMPORAL_PLAN,
  }),
  pointer: Object.freeze({
    manifestSchema: 'kaminos.sam31-interactive-pointer-meta-packet.v0',
    receiptSchema: 'kaminos.sam31-interactive-pointer-meta-reference-receipt.v0',
    boundary: 'binary-mask-to-interactive-prompt-decoder-to-final-object-pointer',
    routeId: 'sam3.1.interactive-pointer.phase-program.webgpu-local.v0',
    shape: INTERACTIVE_POINTER_SHAPE,
  }),
  episode: Object.freeze({
    manifestSchema: 'kaminos.sam31-two-frame-tracker-meta-packet.v0',
    receiptSchema: 'kaminos.sam31-two-frame-tracker-meta-reference-receipt.v0',
    boundary: 'frame-0-decoder-to-memory-state-to-frame-1-conditioned-decoder',
    shape: TWO_FRAME_EPISODE_SHAPE,
    plan: TWO_FRAME_EPISODE_PLAN,
  }),
  conditionedEpisode: Object.freeze({
    manifestSchema: 'kaminos.sam31-mask-conditioned-two-frame-tracker-meta-packet.v0',
    receiptSchema: 'kaminos.sam31-mask-conditioned-two-frame-tracker-meta-reference-receipt.v0',
    boundary: 'frame-0-mask-conditioning-to-memory-state-to-frame-1-conditioned-decoder',
    mode: 'official-meta-mask-conditioning-memory-attention-propagation-decoder',
    shape: MASK_CONDITIONED_TWO_FRAME_EPISODE_SHAPE,
    plan: TWO_FRAME_EPISODE_PLAN,
    stateTransition: Object.freeze({
      frame0OriginKind: 'mask-conditioning',
      maskOwner: 'browser-webgpu',
      pointerOwner: 'official-reference-bridge',
    }),
    claims: Object.freeze({
      officialFrame0DecoderExecuted: false,
      officialMaskConditioningMethodExecuted: true,
      officialInteractiveSamHeadsExecuted: true,
      officialInteractivePromptEncoderExecuted: true,
      officialInteractiveMaskDecoderExecuted: true,
      checkpointBackedInteractivePointers: true,
      fullProductionInteractiveGeometryExecuted: false,
      effectiveInteractiveImageEmbeddingSize: Object.freeze([2, 2]),
      effectiveSourceMaskSize: Object.freeze([32, 32]),
      effectivePromptMaskSize: Object.freeze([8, 8]),
      effectiveDecoderMaskSize: Object.freeze([8, 8]),
      officialMemoryMethodExecuted: true,
      officialTemporalMethodExecuted: true,
      officialMemoryAttentionExecuted: true,
      officialFrame1DecoderExecuted: true,
    }),
  }),
  twoImageEpisode: Object.freeze({
    manifestSchema: 'kaminos.sam31-two-image-tracker-meta-packet.v0',
    receiptSchema: 'kaminos.sam31-two-image-tracker-meta-reference-receipt.v0',
    boundary: 'two-distinct-raw-images-through-browser-backbone-to-mask-conditioned-temporal-tracker',
    mode: 'official-meta-two-image-mask-conditioning-memory-attention-propagation-decoder',
    shape: MASK_CONDITIONED_TWO_FRAME_EPISODE_SHAPE,
    plan: TWO_FRAME_EPISODE_PLAN,
    stateTransition: Object.freeze({
      frame0OriginKind: 'mask-conditioning',
      maskOwner: 'browser-webgpu',
      pointerOwner: 'official-reference-bridge',
    }),
    claims: Object.freeze({
      fullImageBackboneExecuted: true,
      twoDistinctRawImagesComposed: true,
      distinctInteractiveAndPropagationFeatures: true,
      packetOwnsImageEmbeddingsAtBrowserRuntime: false,
    }),
  }),
});

export async function verifySam31TwoImageIngressPacketAuthority({ manifestText, manifest, referenceReceipt, expectedManifestSha256 }) {
  const expected = SAM31_TWO_IMAGE_INGRESS_PACKET_AUTHORITY;
  if (typeof manifestText !== 'string' || manifestText.length === 0) throw new Error('two-image ingress manifest text is required');
  if (!manifest || typeof manifest !== 'object') throw new Error('two-image ingress manifest is required');
  if (!referenceReceipt || typeof referenceReceipt !== 'object') throw new Error('two-image ingress reference receipt is required');
  if (typeof expectedManifestSha256 !== 'string' || !expectedManifestSha256.startsWith('sha256:')) throw new Error('two-image ingress authority requires invocation-scoped expectedManifestSha256');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(manifestText));
  const manifestSha256 = `sha256:${sha256Hex(new Uint8Array(digest))}`;
  assertNamedEqual('ingress', manifestSha256, expectedManifestSha256, 'expectedManifestSha256');
  assertNamedEqual('ingress', manifest.schema, expected.manifestSchema, 'manifest.schema');
  assertNamedEqual('ingress', referenceReceipt.schema, expected.receiptSchema, 'referenceReceipt.schema');
  assertNamedEqual('ingress', referenceReceipt.ok, true, 'referenceReceipt.ok');
  assertNamedEqual('ingress', manifest.boundary, expected.boundary, 'manifest.boundary');
  assertNamedEqual('ingress', referenceReceipt.boundary, expected.boundary, 'referenceReceipt.boundary');
  assertNamedEqual('ingress', referenceReceipt.outputs?.tensorManifestSha256, manifestSha256, 'referenceReceipt.outputs.tensorManifestSha256');
  assertNamedJsonEqual('ingress', manifest.routeIds, expected.routeIds, 'manifest.routeIds');
  assertNamedJsonEqual('ingress', referenceReceipt.routeIds, expected.routeIds, 'referenceReceipt.routeIds');
  assertNamedEqual('ingress', manifest.reference?.model?.id, expected.modelId, 'manifest.reference.model.id');
  assertNamedEqual('ingress', manifest.reference?.model?.revision, expected.modelRevision, 'manifest.reference.model.revision');
  assertNamedEqual('ingress', manifest.reference?.checkpoint?.sha256, expected.checkpointSha256, 'manifest.reference.checkpoint.sha256');
  assertNamedEqual('ingress', manifest.reference?.source?.commit, expected.sourceCommit, 'manifest.reference.source.commit');
  assertNamedEqual('ingress', manifest.reference?.source?.clean, true, 'manifest.reference.source.clean');
  assertNamedEqual('ingress', manifest.claims?.twoDistinctSourceImages, true, 'manifest.claims.twoDistinctSourceImages');
  assertNamedEqual('ingress', manifest.claims?.officialMetaViTExecuted, true, 'manifest.claims.officialMetaViTExecuted');
  assertNamedEqual('ingress', manifest.claims?.officialMetaTriNeckExecuted, true, 'manifest.claims.officialMetaTriNeckExecuted');
  assertNamedEqual('ingress', manifest.claims?.officialMetaHighResolutionProjectionExecuted, true, 'manifest.claims.officialMetaHighResolutionProjectionExecuted');
  assertNamedEqual('ingress', manifest.claims?.packetOwnsImageEmbeddingsAtBrowserRuntime, false, 'manifest.claims.packetOwnsImageEmbeddingsAtBrowserRuntime');
  if (!Array.isArray(manifest.sourceImages) || manifest.sourceImages.length !== 2) throw new Error('ingress packet authority mismatch for manifest.sourceImages');
  assertNamedEqual('ingress', manifest.sourceImages[0]?.frameIndex, 0, 'manifest.sourceImages[0].frameIndex');
  assertNamedEqual('ingress', manifest.sourceImages[1]?.frameIndex, 1, 'manifest.sourceImages[1].frameIndex');
  if (manifest.sourceImages[0]?.rgbaSha256 === manifest.sourceImages[1]?.rgbaSha256) throw new Error('ingress packet authority rejected identical source image tensors');
  if (manifest.sourceImages[0]?.originalSha256 === manifest.sourceImages[1]?.originalSha256) throw new Error('ingress packet authority rejected identical encoded source images');
  const diagnosticVitLayers = manifest.diagnosticVitLayers ?? [];
  if (!Array.isArray(diagnosticVitLayers)
      || new Set(diagnosticVitLayers).size !== diagnosticVitLayers.length
      || diagnosticVitLayers.some(layerIndex => !Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= 32)) {
    throw new Error('ingress packet authority rejected invalid diagnosticVitLayers');
  }
  const tensorRoles = new Set((manifest.tensors || []).map(entry => entry.role));
  for (const frameIndex of [0, 1]) {
    for (const layerIndex of diagnosticVitLayers) {
      const role = `frame-${frameIndex}-vit-layer-${layerIndex}-hidden-states`;
      if (!tensorRoles.has(role)) throw new Error(`ingress diagnostic checkpoint tensor missing: ${role}`);
    }
  }
  for (const role of tensorRoles) {
    const match = /^frame-[01]-vit-layer-(\d+)-hidden-states$/.exec(role);
    if (match && !diagnosticVitLayers.includes(Number(match[1]))) {
      throw new Error(`ingress diagnostic checkpoint tensor is undeclared: ${role}`);
    }
  }
  return {
    passed: true,
    name: 'ingress',
    manifestSha256,
    expectedManifestSha256,
    manifestSchema: manifest.schema,
    receiptSchema: referenceReceipt.schema,
    boundary: manifest.boundary,
    routeIds: manifest.routeIds,
    modelId: manifest.reference.model.id,
    modelRevision: manifest.reference.model.revision,
    checkpointSha256: manifest.reference.checkpoint.sha256,
    sourceCommit: manifest.reference.source.commit,
    diagnosticVitLayers,
    sourceImages: manifest.sourceImages.map(image => ({ frameIndex: image.frameIndex, originalSha256: image.originalSha256, rgbaSha256: image.rgbaSha256 })),
  };
}

function assertEqual(actual, expected, field) {
  if (actual !== expected) throw new Error(`temporal packet authority mismatch for ${field}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

function assertJsonEqual(actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`temporal packet authority mismatch for ${field}`);
  }
}

export async function verifySam31TemporalPacketAuthority({ manifestText, manifest, referenceReceipt, expectedManifestSha256 = null }) {
  if (typeof manifestText !== 'string' || manifestText.length === 0) throw new Error('temporal packet manifest text is required');
  if (!manifest || typeof manifest !== 'object') throw new Error('temporal packet manifest is required');
  if (!referenceReceipt || typeof referenceReceipt !== 'object') throw new Error('temporal packet reference receipt is required');
  const expected = SAM31_TEMPORAL_PACKET_AUTHORITY;
  const manifestDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(manifestText));
  const manifestSha256 = `sha256:${sha256Hex(new Uint8Array(manifestDigest))}`;
  if (expectedManifestSha256 !== null) assertEqual(manifestSha256, expectedManifestSha256, 'expectedManifestSha256');

  assertEqual(manifest.schema, expected.manifestSchema, 'manifest.schema');
  assertEqual(referenceReceipt.schema, expected.receiptSchema, 'referenceReceipt.schema');
  assertEqual(referenceReceipt.ok, true, 'referenceReceipt.ok');
  assertEqual(manifest.routeId, expected.routeId, 'manifest.routeId');
  assertEqual(referenceReceipt.routeId, expected.routeId, 'referenceReceipt.routeId');
  assertEqual(referenceReceipt.boundary, manifest.boundary, 'referenceReceipt.boundary');
  assertEqual(referenceReceipt.outputs?.tensorManifestSha256, manifestSha256, 'referenceReceipt.outputs.tensorManifestSha256');

  for (const [name, value] of [['manifest', manifest.reference], ['referenceReceipt', referenceReceipt.reference]]) {
    assertEqual(value?.model?.id, expected.modelId, `${name}.model.id`);
    assertEqual(value?.model?.revision, expected.modelRevision, `${name}.model.revision`);
    assertEqual(value?.model?.sha256, expected.checkpointSha256, `${name}.model.sha256`);
    assertEqual(value?.source?.repository, expected.sourceRepository, `${name}.source.repository`);
    assertEqual(value?.source?.commit, expected.sourceCommit, `${name}.source.commit`);
    assertEqual(value?.source?.workingTreeClean, true, `${name}.source.workingTreeClean`);
  }
  assertJsonEqual(referenceReceipt.plan, manifest.plan, 'referenceReceipt.plan');
  assertJsonEqual(referenceReceipt.shape, manifest.shape, 'referenceReceipt.shape');
  assertJsonEqual(referenceReceipt.checkpointAudit, manifest.checkpointAudit, 'referenceReceipt.checkpointAudit');

  return {
    passed: true,
    manifestSha256,
    expectedManifestSha256: expectedManifestSha256 || manifestSha256,
    manifestSchema: manifest.schema,
    receiptSchema: referenceReceipt.schema,
    routeId: manifest.routeId,
    boundary: manifest.boundary,
    modelId: manifest.reference.model.id,
    modelRevision: manifest.reference.model.revision,
    checkpointSha256: manifest.reference.model.sha256,
    sourceRepository: manifest.reference.source.repository,
    sourceCommit: manifest.reference.source.commit,
    sourceWorkingTreeClean: manifest.reference.source.workingTreeClean,
  };
}

function assertNamedEqual(name, actual, expected, field) {
  if (actual !== expected) {
    throw new Error(`${name} packet authority mismatch for ${field}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
}

function assertNamedJsonEqual(name, actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${name} packet authority mismatch for ${field}`);
  }
}

const TWO_IMAGE_EPISODE_INGRESS_BINDINGS = Object.freeze({
  frame0InteractiveFeature: 'frame-0-interactive-feature-2',
  frame0InteractiveHighResolution0: 'frame-0-interactive-high-resolution-s0',
  frame0InteractiveHighResolution1: 'frame-0-interactive-high-resolution-s1',
  frame0PropagationFeature: 'frame-0-propagation-feature-2',
  frame0PropagationPosition: 'frame-0-propagation-position-2',
  frame1PropagationFeature: 'frame-1-propagation-feature-2',
  frame1PropagationPosition: 'frame-1-propagation-position-2',
  frame1HighResolutionS0: 'frame-1-high-resolution-s0',
  frame1HighResolutionS1: 'frame-1-high-resolution-s1',
});

const INTERACTIVE_POINTER_INGRESS_BINDINGS = Object.freeze({
  frame0ImageEmbedding: 'frame-0-interactive-feature-2',
  frame0HighResolutionS0: 'frame-0-interactive-high-resolution-s0',
  frame0HighResolutionS1: 'frame-0-interactive-high-resolution-s1',
});

function verifyTwoImageEpisodeIngressBindings({ authorityName, manifest, authenticatedIngress }) {
  const ingressAuthority = authenticatedIngress?.authority;
  const ingressManifest = authenticatedIngress?.manifest;
  assertNamedEqual(authorityName, ingressAuthority?.passed, true, 'authenticatedIngress.authority.passed');
  if (!ingressManifest || typeof ingressManifest !== 'object') {
    throw new Error(`${authorityName} packet authority mismatch for authenticatedIngress.manifest`);
  }
  assertNamedEqual(authorityName, manifest.imageIngress?.schema, ingressManifest.schema, 'manifest.imageIngress.schema');
  assertNamedEqual(authorityName, manifest.imageIngress?.boundary, ingressManifest.boundary, 'manifest.imageIngress.boundary');
  assertNamedEqual(authorityName, manifest.imageIngress?.tensorManifestSha256, ingressAuthority.manifestSha256, 'manifest.imageIngress.tensorManifestSha256');
  assertNamedJsonEqual(authorityName, manifest.imageIngress?.sourceImages, ingressManifest.sourceImages, 'manifest.imageIngress.sourceImages');

  const entriesByRole = new Map();
  for (const entry of ingressManifest.tensors || []) {
    if (entriesByRole.has(entry.role)) throw new Error(`${authorityName} packet authority mismatch for duplicate ingress tensor role ${entry.role}`);
    entriesByRole.set(entry.role, entry);
  }
  for (const [binding, role] of Object.entries(TWO_IMAGE_EPISODE_INGRESS_BINDINGS)) {
    const entry = entriesByRole.get(role);
    if (!entry?.sha256) throw new Error(`${authorityName} packet authority mismatch for authenticatedIngress.manifest.tensors.${role}`);
    assertNamedEqual(authorityName, manifest.imageIngress?.bindings?.[binding], entry.sha256, `manifest.imageIngress.bindings.${binding}`);
  }
  return { passed: true, bindingCount: Object.keys(TWO_IMAGE_EPISODE_INGRESS_BINDINGS).length };
}

function verifyTwoImageEpisodeGeometry({ authorityName, manifest, authenticatedIngress }) {
  const ingress = authenticatedIngress.manifest.shape;
  const episode = manifest.shape;
  assertNamedEqual(authorityName, ingress?.patchSize, 14, 'authenticatedIngress.manifest.shape.patchSize');
  assertNamedEqual(authorityName, ingress?.imageHeight, ingress?.patchHeight * 14, 'authenticatedIngress.manifest.shape.imageHeight');
  assertNamedEqual(authorityName, ingress?.imageWidth, ingress?.patchWidth * 14, 'authenticatedIngress.manifest.shape.imageWidth');
  const expected = {
    batch: 1,
    multiplexCount: 16,
    queryHeight: ingress?.patchHeight,
    queryWidth: ingress?.patchWidth,
    queryTokens: ingress?.patchTokens,
    memorySpatialTokens: ingress?.patchTokens,
    numObjPtrTokens: 16,
    memoryTokens: ingress?.patchTokens + 16,
    channels: 256,
    maskHeight: ingress?.patchHeight * 4,
    maskWidth: ingress?.patchWidth * 4,
    sourceImageHeight: ingress?.imageHeight,
    sourceImageWidth: ingress?.imageWidth,
    sourceMaskHeight: ingress?.patchHeight * 16,
    sourceMaskWidth: ingress?.patchWidth * 16,
    promptMaskHeight: ingress?.patchHeight * 4,
    promptMaskWidth: ingress?.patchWidth * 4,
    decoderMaskHeight: ingress?.patchHeight * 4,
    decoderMaskWidth: ingress?.patchWidth * 4,
    memoryInputMaskHeight: ingress?.patchHeight * 16,
    memoryInputMaskWidth: ingress?.patchWidth * 16,
  };
  for (const [field, value] of Object.entries(expected)) {
    assertNamedEqual(authorityName, episode?.[field], value, `manifest.shape.${field}`);
  }
  return { passed: true, queryTokens: episode.queryTokens, memoryTokens: episode.memoryTokens };
}

function verifyInteractivePointerGeometry({ authorityName, manifest, authenticatedIngress }) {
  const ingress = authenticatedIngress.manifest.shape;
  const pointer = manifest.shape;
  const expected = {
    batch: 16,
    queryTokens: 8,
    sparsePromptTokens: 2,
    imageHeight: ingress?.patchHeight,
    imageWidth: ingress?.patchWidth,
    imageTokens: ingress?.patchTokens,
    channels: 256,
    heads: 8,
    attentionChannels: 128,
    mlpHidden: 2048,
    sourceImageHeight: ingress?.patchHeight * 14,
    sourceImageWidth: ingress?.patchWidth * 14,
    sourceMaskHeight: ingress?.patchHeight * 16,
    sourceMaskWidth: ingress?.patchWidth * 16,
    promptMaskHeight: ingress?.patchHeight * 4,
    promptMaskWidth: ingress?.patchWidth * 4,
    decoderMaskHeight: ingress?.patchHeight * 4,
    decoderMaskWidth: ingress?.patchWidth * 4,
    maskOutputs: 4,
    layerCount: 2,
  };
  for (const [field, value] of Object.entries(expected)) {
    assertNamedEqual(authorityName, pointer?.[field], value, `manifest.shape.${field}`);
  }
  assertNamedEqual(authorityName, ingress?.patchSize, 14, 'authenticatedIngress.manifest.shape.patchSize');
  assertNamedEqual(authorityName, ingress?.imageHeight, ingress?.patchHeight * 14, 'authenticatedIngress.manifest.shape.imageHeight');
  assertNamedEqual(authorityName, ingress?.imageWidth, ingress?.patchWidth * 14, 'authenticatedIngress.manifest.shape.imageWidth');
  return { passed: true, imageTokens: pointer.imageTokens };
}

function verifyInteractivePointerIngressBindings({ authorityName, manifest, referenceReceipt, authenticatedIngress }) {
  const ingressAuthority = authenticatedIngress?.authority;
  const ingressManifest = authenticatedIngress?.manifest;
  assertNamedEqual(authorityName, ingressAuthority?.passed, true, 'authenticatedIngress.authority.passed');
  if (!ingressManifest || typeof ingressManifest !== 'object') {
    throw new Error(`${authorityName} packet authority mismatch for authenticatedIngress.manifest`);
  }

  const entriesByRole = new Map();
  for (const entry of ingressManifest.tensors || []) {
    if (entriesByRole.has(entry.role)) throw new Error(`${authorityName} packet authority mismatch for duplicate ingress tensor role ${entry.role}`);
    entriesByRole.set(entry.role, entry);
  }

  for (const [surfaceName, pointerIngressAuthority] of [
    ['manifest', manifest.ingressAuthority],
    ['referenceReceipt', referenceReceipt.ingressAuthority],
  ]) {
    assertNamedEqual(authorityName, pointerIngressAuthority?.passed, true, `${surfaceName}.ingressAuthority.passed`);
    assertNamedEqual(authorityName, pointerIngressAuthority?.schema, ingressManifest.schema, `${surfaceName}.ingressAuthority.schema`);
    assertNamedEqual(authorityName, pointerIngressAuthority?.manifestSha256, ingressAuthority.manifestSha256, `${surfaceName}.ingressAuthority.manifestSha256`);
    for (const [binding, role] of Object.entries(INTERACTIVE_POINTER_INGRESS_BINDINGS)) {
      const entry = entriesByRole.get(role);
      if (!entry?.sha256) throw new Error(`${authorityName} packet authority mismatch for authenticatedIngress.manifest.tensors.${role}`);
      assertNamedEqual(authorityName, pointerIngressAuthority?.bindings?.[binding], entry.sha256, `${surfaceName}.ingressAuthority.bindings.${binding}`);
    }
  }
  assertNamedJsonEqual(authorityName, referenceReceipt.ingressAuthority, manifest.ingressAuthority, 'referenceReceipt.ingressAuthority');
  return { passed: true, bindingCount: Object.keys(INTERACTIVE_POINTER_INGRESS_BINDINGS).length };
}

export async function verifySam31TwoFramePacketAuthority({ name, authorityName = name, manifestText, manifest, referenceReceipt, expectedManifestSha256, authenticatedIngress = null }) {
  const expected = SAM31_TWO_FRAME_PACKET_AUTHORITIES[authorityName];
  if (!expected) throw new Error(`unknown two-frame packet authority name: ${authorityName}`);
  if (typeof manifestText !== 'string' || manifestText.length === 0) throw new Error(`${authorityName} packet manifest text is required`);
  if (!manifest || typeof manifest !== 'object') throw new Error(`${authorityName} packet manifest is required`);
  if (!referenceReceipt || typeof referenceReceipt !== 'object') throw new Error(`${authorityName} packet reference receipt is required`);
  if (typeof expectedManifestSha256 !== 'string' || !expectedManifestSha256.startsWith('sha256:')) {
    throw new Error(`${authorityName} packet authority requires invocation-scoped expectedManifestSha256`);
  }

  const manifestDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(manifestText));
  const manifestSha256 = `sha256:${sha256Hex(new Uint8Array(manifestDigest))}`;
  assertNamedEqual(authorityName, manifestSha256, expectedManifestSha256, 'expectedManifestSha256');
  assertNamedEqual(authorityName, manifest.schema, expected.manifestSchema, 'manifest.schema');
  assertNamedEqual(authorityName, referenceReceipt.schema, expected.receiptSchema, 'referenceReceipt.schema');
  assertNamedEqual(authorityName, referenceReceipt.ok, true, 'referenceReceipt.ok');
  assertNamedEqual(authorityName, manifest.boundary, expected.boundary, 'manifest.boundary');
  assertNamedEqual(authorityName, referenceReceipt.boundary, expected.boundary, 'referenceReceipt.boundary');
  assertNamedEqual(authorityName, referenceReceipt.outputs?.tensorManifestSha256, manifestSha256, 'referenceReceipt.outputs.tensorManifestSha256');
  if (expected.mode) assertNamedEqual(authorityName, manifest.mode, expected.mode, 'manifest.mode');
  if (expected.routeId) {
    assertNamedEqual(authorityName, manifest.routeId, expected.routeId, 'manifest.routeId');
    assertNamedEqual(authorityName, referenceReceipt.routeId, expected.routeId, 'referenceReceipt.routeId');
  }
  if (expected.routeIds) {
    assertNamedJsonEqual(authorityName, manifest.routeIds, expected.routeIds, 'manifest.routeIds');
    assertNamedJsonEqual(authorityName, referenceReceipt.routeIds, expected.routeIds, 'referenceReceipt.routeIds');
  }

  for (const [surface, value] of [['manifest', manifest.reference], ['referenceReceipt', referenceReceipt.reference]]) {
    assertNamedEqual(authorityName, value?.model?.id, TWO_FRAME_REFERENCE.modelId, `${surface}.model.id`);
    assertNamedEqual(authorityName, value?.model?.revision, TWO_FRAME_REFERENCE.modelRevision, `${surface}.model.revision`);
    assertNamedEqual(authorityName, value?.model?.sha256, TWO_FRAME_REFERENCE.checkpointSha256, `${surface}.model.sha256`);
    assertNamedEqual(authorityName, value?.source?.repository, TWO_FRAME_REFERENCE.sourceRepository, `${surface}.source.repository`);
    assertNamedEqual(authorityName, value?.source?.commit, TWO_FRAME_REFERENCE.sourceCommit, `${surface}.source.commit`);
    assertNamedEqual(authorityName, value?.source?.workingTreeClean, true, `${surface}.source.workingTreeClean`);
  }
  assertNamedJsonEqual(authorityName, referenceReceipt.reference, manifest.reference, 'referenceReceipt.reference');
  assertNamedJsonEqual(authorityName, referenceReceipt.shape, manifest.shape, 'referenceReceipt.shape');
  assertNamedJsonEqual(authorityName, referenceReceipt.plan, manifest.plan, 'referenceReceipt.plan');
  assertNamedJsonEqual(authorityName, referenceReceipt.checkpointAudit, manifest.checkpointAudit, 'referenceReceipt.checkpointAudit');
  const ingressDerivedShape = authorityName === 'twoImageEpisode'
    || (authorityName === 'pointer' && authenticatedIngress != null);
  if (expected.shape && !ingressDerivedShape) assertNamedJsonEqual(authorityName, manifest.shape, expected.shape, 'manifest.shape');
  if (expected.plan) assertNamedJsonEqual(authorityName, manifest.plan, expected.plan, 'manifest.plan');
  if (expected.stateTransition) {
    assertNamedJsonEqual(authorityName, referenceReceipt.stateTransition, manifest.stateTransition, 'referenceReceipt.stateTransition');
    for (const [field, value] of Object.entries(expected.stateTransition)) {
      assertNamedEqual(authorityName, manifest.stateTransition?.[field], value, `manifest.stateTransition.${field}`);
    }
  }
  if (expected.claims) {
    for (const [field, value] of Object.entries(expected.claims)) {
      assertNamedJsonEqual(authorityName, manifest.claims?.[field], value, `manifest.claims.${field}`);
    }
  }
  const ingressBindings = authorityName === 'twoImageEpisode'
    ? verifyTwoImageEpisodeIngressBindings({ authorityName, manifest, authenticatedIngress })
    : null;
  const ingressGeometry = authorityName === 'twoImageEpisode'
    ? verifyTwoImageEpisodeGeometry({ authorityName, manifest, authenticatedIngress })
    : null;
  const pointerGeometry = authorityName === 'pointer' && authenticatedIngress != null
    ? verifyInteractivePointerGeometry({ authorityName, manifest, authenticatedIngress })
    : null;
  const pointerIngressBindings = authorityName === 'pointer' && authenticatedIngress != null
    ? verifyInteractivePointerIngressBindings({ authorityName, manifest, referenceReceipt, authenticatedIngress })
    : null;

  return {
    passed: true,
    name: authorityName,
    packetName: name,
    manifestSha256,
    expectedManifestSha256,
    manifestSchema: manifest.schema,
    receiptSchema: referenceReceipt.schema,
    boundary: manifest.boundary,
    routeId: manifest.routeId || null,
    routeIds: manifest.routeIds || null,
    modelId: manifest.reference.model.id,
    modelRevision: manifest.reference.model.revision,
    checkpointSha256: manifest.reference.model.sha256,
    sourceRepository: manifest.reference.source.repository,
    sourceCommit: manifest.reference.source.commit,
    sourceWorkingTreeClean: manifest.reference.source.workingTreeClean,
    ingressBindingsPassed: ingressBindings?.passed ?? pointerIngressBindings?.passed ?? null,
    ingressGeometryPassed: ingressGeometry?.passed ?? null,
    pointerGeometryPassed: pointerGeometry?.passed ?? null,
    ingressBindingCount: ingressBindings?.bindingCount ?? pointerIngressBindings?.bindingCount ?? 0,
  };
}

export async function verifySam31PacketFloat32Bytes(entry, buffer) {
  if (!entry?.file || !entry.sha256 || !Number.isInteger(entry.byteLength)) {
    throw new Error('tensor manifest entry is incomplete');
  }
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('tensor artifact must be an ArrayBuffer');
  if (buffer.byteLength !== entry.byteLength || buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error(`tensor byte length mismatch for ${entry.role}: ${buffer.byteLength} != ${entry.byteLength}`);
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const actualSha256 = `sha256:${sha256Hex(new Uint8Array(digest))}`;
  if (actualSha256 !== entry.sha256) {
    throw new Error(`tensor byte hash mismatch for ${entry.role}: ${actualSha256} != ${entry.sha256}`);
  }
  return new Float32Array(buffer);
}
