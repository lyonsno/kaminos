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
    shape: TWO_FRAME_EPISODE_SHAPE,
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
      effectiveMaskInputSize: Object.freeze([8, 8]),
      officialMemoryMethodExecuted: true,
      officialTemporalMethodExecuted: true,
      officialMemoryAttentionExecuted: true,
      officialFrame1DecoderExecuted: true,
    }),
  }),
});

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

export async function verifySam31TwoFramePacketAuthority({ name, authorityName = name, manifestText, manifest, referenceReceipt, expectedManifestSha256 }) {
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
  if (expected.shape) assertNamedJsonEqual(authorityName, manifest.shape, expected.shape, 'manifest.shape');
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
