import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  SAM31_TWO_FRAME_PACKET_AUTHORITIES,
  SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT,
  SAM31_TEMPORAL_PACKET_AUTHORITY,
  createSam31BrowserTrackerPackageProjection,
  verifySam31PacketFloat32Bytes,
  verifySam31TemporalPacketAuthority,
  verifySam31TwoFramePacketAuthority,
  resolveSam3BrowserPackageManifestSync,
} from '../src/index.js';
import { canonicalSam3IdentityJson } from '../src/sam-browser-package-manifest.js';

const values = new Float32Array([1.25, -2.5, 3.75, 9]);
const bytes = values.buffer.slice(0);
const digest = await crypto.subtle.digest('SHA-256', bytes);
const sha256 = `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
const entry = { role: 'fixture', file: 'fixture.f32.bin', sha256, byteLength: bytes.byteLength, shape: [4], dtype: 'float32' };
assert.deepEqual(Array.from(await verifySam31PacketFloat32Bytes(entry, bytes)), Array.from(values));

const tampered = bytes.slice(0);
new Uint8Array(tampered)[3] ^= 0xff;
await assert.rejects(() => verifySam31PacketFloat32Bytes(entry, tampered), /tensor byte hash mismatch for fixture/);
await assert.rejects(() => verifySam31PacketFloat32Bytes(entry, bytes.slice(0, -4)), /tensor byte length mismatch for fixture/);
await assert.rejects(() => verifySam31PacketFloat32Bytes({ ...entry, sha256: null }, bytes), /tensor manifest entry is incomplete/);

const authority = SAM31_TEMPORAL_PACKET_AUTHORITY;
const reference = {
  model: { id: authority.modelId, revision: authority.modelRevision, sha256: authority.checkpointSha256 },
  source: { repository: authority.sourceRepository, commit: authority.sourceCommit, workingTreeClean: true },
};
const manifest = {
  schema: authority.manifestSchema,
  routeId: authority.routeId,
  boundary: 'fixture-boundary',
  reference,
  plan: { frameIndex: 8, maxObjectPointerFrames: 11 },
  shape: { batch: 1, memoryTokens: 196 },
  checkpointAudit: { allMappedOfficialKeysPresent: true },
};
const manifestText = JSON.stringify(manifest, null, 2);
const manifestDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(manifestText));
const manifestSha256 = `sha256:${Array.from(new Uint8Array(manifestDigest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
const referenceReceipt = {
  ok: true,
  schema: authority.receiptSchema,
  routeId: authority.routeId,
  boundary: manifest.boundary,
  reference,
  plan: manifest.plan,
  shape: manifest.shape,
  checkpointAudit: manifest.checkpointAudit,
  outputs: { tensorManifestSha256: manifestSha256 },
};
assert.equal((await verifySam31TemporalPacketAuthority({ manifestText, manifest, referenceReceipt, expectedManifestSha256: manifestSha256 })).passed, true);
const substitutedManifestText = JSON.stringify({ ...manifest, plan: { ...manifest.plan, frameIndex: 9 } }, null, 2);
await assert.rejects(
  () => verifySam31TemporalPacketAuthority({ manifestText: substitutedManifestText, manifest: JSON.parse(substitutedManifestText), referenceReceipt, expectedManifestSha256: manifestSha256 }),
  /temporal packet authority mismatch for expectedManifestSha256/,
);

const twoImageAuthority = SAM31_TWO_FRAME_PACKET_AUTHORITIES.twoImageEpisode;
assert.equal(
  SAM31_TWO_FRAME_PACKET_AUTHORITIES.episode.shape.memoryInputMaskHeight,
  SAM31_TWO_FRAME_PACKET_AUTHORITIES.episode.shape.decoderMaskHeight,
  'decoder-origin propagation must feed decoder-resolution masks into memory encoding',
);
assert.equal(
  SAM31_TWO_FRAME_PACKET_AUTHORITIES.conditionedEpisode.shape.memoryInputMaskHeight,
  SAM31_TWO_FRAME_PACKET_AUTHORITIES.conditionedEpisode.shape.sourceMaskHeight,
  'mask-conditioned propagation must preserve source-mask geometry through memory encoding',
);
const ingressManifestSha256 = `sha256:${'1'.repeat(64)}`;
const ingressManifest = {
  schema: 'kaminos.sam31-two-image-ingress-meta-packet.v0',
  boundary: 'sam31-two-distinct-raw-images-to-interactive-propagation-backbone-features',
  shape: {
    imageHeight: 56,
    imageWidth: 56,
    patchSize: 14,
    patchHeight: 4,
    patchWidth: 4,
    patchTokens: 16,
    fpnLevels: [
      { level: 0, scaleFactor: 4, height: 16, width: 16 },
      { level: 1, scaleFactor: 2, height: 8, width: 8 },
      { level: 2, scaleFactor: 1, height: 4, width: 4 },
    ],
  },
  sourceImages: [
    { frameIndex: 0, originalSha256: `sha256:${'2'.repeat(64)}`, rgbaSha256: `sha256:${'3'.repeat(64)}` },
    { frameIndex: 1, originalSha256: `sha256:${'4'.repeat(64)}`, rgbaSha256: `sha256:${'5'.repeat(64)}` },
  ],
  tensors: [
    ['frame-0-interactive-feature-2', 'a'],
    ['frame-0-interactive-high-resolution-s0', 'b'],
    ['frame-0-interactive-high-resolution-s1', 'c'],
    ['frame-0-propagation-feature-2', 'd'],
    ['frame-0-propagation-position-2', 'e'],
    ['frame-1-propagation-feature-2', 'f'],
    ['frame-1-propagation-position-2', '7'],
    ['frame-1-high-resolution-s0', '8'],
    ['frame-1-high-resolution-s1', '9'],
  ].map(([role, digit]) => ({ role, sha256: `sha256:${digit.repeat(64)}` })),
};
const ingressBindings = {
  frame0InteractiveFeature: ingressManifest.tensors[0].sha256,
  frame0InteractiveHighResolution0: ingressManifest.tensors[1].sha256,
  frame0InteractiveHighResolution1: ingressManifest.tensors[2].sha256,
  frame0PropagationFeature: ingressManifest.tensors[3].sha256,
  frame0PropagationPosition: ingressManifest.tensors[4].sha256,
  frame1PropagationFeature: ingressManifest.tensors[5].sha256,
  frame1PropagationPosition: ingressManifest.tensors[6].sha256,
  frame1HighResolutionS0: ingressManifest.tensors[7].sha256,
  frame1HighResolutionS1: ingressManifest.tensors[8].sha256,
};
const twoImageReference = {
  model: { id: 'facebook/sam3.1', revision: 'daa63191845a41281374e725f4c9e51c7a824460', sha256: 'sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6' },
  source: { repository: 'facebookresearch/sam3', commit: '5dd401d1c5c1d5c3eedff06d41b77af824517619', workingTreeClean: true },
};
const dynamicEpisodeShape = {
  ...twoImageAuthority.shape,
  queryHeight: 4,
  queryWidth: 4,
  queryTokens: 16,
  memorySpatialTokens: 16,
  memoryTokens: 32,
  maskHeight: 16,
  maskWidth: 16,
  sourceImageHeight: 56,
  sourceImageWidth: 56,
  sourceMaskHeight: 64,
  sourceMaskWidth: 64,
  promptMaskHeight: 16,
  promptMaskWidth: 16,
  decoderMaskHeight: 16,
  decoderMaskWidth: 16,
  memoryInputMaskHeight: 64,
  memoryInputMaskWidth: 64,
};
async function makeTwoImageEpisode(bindings, shape = dynamicEpisodeShape) {
  const episode = {
    schema: twoImageAuthority.manifestSchema,
    boundary: twoImageAuthority.boundary,
    mode: twoImageAuthority.mode,
    reference: twoImageReference,
    shape,
    plan: twoImageAuthority.plan,
    checkpointAudit: { allMappedOfficialKeysPresent: true },
    stateTransition: twoImageAuthority.stateTransition,
    claims: twoImageAuthority.claims,
    imageIngress: {
      schema: ingressManifest.schema,
      boundary: ingressManifest.boundary,
      tensorManifestSha256: ingressManifestSha256,
      sourceImages: ingressManifest.sourceImages,
      bindings,
    },
  };
  const text = JSON.stringify(episode, null, 2);
  const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const sha = `sha256:${Array.from(new Uint8Array(digestBytes), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  return {
    episode,
    text,
    sha,
    receipt: {
      ok: true,
      schema: twoImageAuthority.receiptSchema,
      boundary: episode.boundary,
      reference: episode.reference,
      shape: episode.shape,
      plan: episode.plan,
      checkpointAudit: episode.checkpointAudit,
      stateTransition: episode.stateTransition,
      outputs: { tensorManifestSha256: sha },
    },
  };
}
const authenticatedIngress = {
  manifest: ingressManifest,
  authority: { passed: true, manifestSha256: ingressManifestSha256 },
};
const validTwoImageEpisode = await makeTwoImageEpisode(ingressBindings);
assert.equal((await verifySam31TwoFramePacketAuthority({
  name: 'episode',
  authorityName: 'twoImageEpisode',
  manifestText: validTwoImageEpisode.text,
  manifest: validTwoImageEpisode.episode,
  referenceReceipt: validTwoImageEpisode.receipt,
  expectedManifestSha256: validTwoImageEpisode.sha,
  authenticatedIngress,
})).passed, true);

const substitutedBindings = { ...ingressBindings, frame1HighResolutionS0: `sha256:${'0'.repeat(64)}` };
const substitutedEpisode = await makeTwoImageEpisode(substitutedBindings);
await assert.rejects(
  () => verifySam31TwoFramePacketAuthority({
    name: 'episode',
    authorityName: 'twoImageEpisode',
    manifestText: substitutedEpisode.text,
    manifest: substitutedEpisode.episode,
    referenceReceipt: substitutedEpisode.receipt,
    expectedManifestSha256: substitutedEpisode.sha,
    authenticatedIngress,
  }),
  /twoImageEpisode packet authority mismatch for manifest\.imageIngress\.bindings\.frame1HighResolutionS0/,
  'a coordinated episode manifest and receipt rewrite must not false-pass an ingress-owned high-resolution binding',
);

const wrongGeometryEpisode = await makeTwoImageEpisode(ingressBindings, {
  ...dynamicEpisodeShape,
  queryHeight: 2,
  queryWidth: 2,
  queryTokens: 4,
  memorySpatialTokens: 4,
  memoryTokens: 20,
  maskHeight: 8,
  maskWidth: 8,
});
await assert.rejects(
  () => verifySam31TwoFramePacketAuthority({
    name: 'episode',
    authorityName: 'twoImageEpisode',
    manifestText: wrongGeometryEpisode.text,
    manifest: wrongGeometryEpisode.episode,
    referenceReceipt: wrongGeometryEpisode.receipt,
    expectedManifestSha256: wrongGeometryEpisode.sha,
    authenticatedIngress,
  }),
  /twoImageEpisode packet authority mismatch for manifest\.shape\.queryHeight/,
  'two-image authority must reject internally valid episode geometry that does not match the authenticated ingress',
);

const wrongSourceMaskGeometryEpisode = await makeTwoImageEpisode(ingressBindings, {
  ...dynamicEpisodeShape,
  sourceMaskHeight: 32,
});
await assert.rejects(
  () => verifySam31TwoFramePacketAuthority({
    name: 'episode',
    authorityName: 'twoImageEpisode',
    manifestText: wrongSourceMaskGeometryEpisode.text,
    manifest: wrongSourceMaskGeometryEpisode.episode,
    referenceReceipt: wrongSourceMaskGeometryEpisode.receipt,
    expectedManifestSha256: wrongSourceMaskGeometryEpisode.sha,
    authenticatedIngress,
  }),
  /twoImageEpisode packet authority mismatch for manifest\.shape\.sourceMaskHeight/,
  'two-image authority must reject source-mask geometry that does not match the authenticated ingress',
);

const pointerAuthority = SAM31_TWO_FRAME_PACKET_AUTHORITIES.pointer;
const pointerIngressBindings = {
  frame0ImageEmbedding: ingressManifest.tensors[0].sha256,
  frame0HighResolutionS0: ingressManifest.tensors[1].sha256,
  frame0HighResolutionS1: ingressManifest.tensors[2].sha256,
};
const pointerIngressAuthority = {
  passed: true,
  schema: ingressManifest.schema,
  manifestSha256: ingressManifestSha256,
  bindings: pointerIngressBindings,
};
async function makePointerPacket(shape, {
  manifestIngressAuthority = null,
  receiptIngressAuthority = manifestIngressAuthority,
} = {}) {
  const pointer = {
    schema: pointerAuthority.manifestSchema,
    routeId: pointerAuthority.routeId,
    boundary: pointerAuthority.boundary,
    reference: twoImageReference,
    shape,
    checkpointAudit: { mappedTensorCount: 158, allMappedOfficialKeysPresent: true },
    ...(manifestIngressAuthority ? { ingressAuthority: manifestIngressAuthority } : {}),
  };
  const text = JSON.stringify(pointer, null, 2);
  const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const sha = `sha256:${Array.from(new Uint8Array(digestBytes), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  return {
    pointer,
    text,
    sha,
    receipt: {
      ok: true,
      schema: pointerAuthority.receiptSchema,
      routeId: pointerAuthority.routeId,
      boundary: pointerAuthority.boundary,
      reference: twoImageReference,
      shape,
      checkpointAudit: pointer.checkpointAudit,
      ...(receiptIngressAuthority ? { ingressAuthority: receiptIngressAuthority } : {}),
      outputs: { tensorManifestSha256: sha },
    },
  };
}
const dynamicPointerShape = {
  ...pointerAuthority.shape,
  imageHeight: 4,
  imageWidth: 4,
  imageTokens: 16,
  sourceImageHeight: 56,
  sourceImageWidth: 56,
  sourceMaskHeight: 64,
  sourceMaskWidth: 64,
  promptMaskHeight: 16,
  promptMaskWidth: 16,
  decoderMaskHeight: 16,
  decoderMaskWidth: 16,
};
const dynamicPointer = await makePointerPacket(dynamicPointerShape, { manifestIngressAuthority: pointerIngressAuthority });
assert.equal((await verifySam31TwoFramePacketAuthority({
  name: 'pointer',
  manifestText: dynamicPointer.text,
  manifest: dynamicPointer.pointer,
  referenceReceipt: dynamicPointer.receipt,
  expectedManifestSha256: dynamicPointer.sha,
  authenticatedIngress,
})).passed, true, 'pointer authority must accept authenticated ingress-derived spatial geometry');

const staleIngressAuthority = { ...pointerIngressAuthority, manifestSha256: `sha256:${'6'.repeat(64)}` };
const stalePointer = await makePointerPacket(dynamicPointerShape, { manifestIngressAuthority: staleIngressAuthority });
await assert.rejects(
  () => verifySam31TwoFramePacketAuthority({
    name: 'pointer',
    manifestText: stalePointer.text,
    manifest: stalePointer.pointer,
    referenceReceipt: stalePointer.receipt,
    expectedManifestSha256: stalePointer.sha,
    authenticatedIngress,
  }),
  /pointer packet authority mismatch for manifest\.ingressAuthority\.manifestSha256/,
  'same-geometry pointer authority must reject a stale ingress manifest digest',
);

const substitutedPointerBindings = { ...pointerIngressBindings, frame0HighResolutionS1: `sha256:${'0'.repeat(64)}` };
const substitutedPointer = await makePointerPacket(dynamicPointerShape, {
  manifestIngressAuthority: { ...pointerIngressAuthority, bindings: substitutedPointerBindings },
});
await assert.rejects(
  () => verifySam31TwoFramePacketAuthority({
    name: 'pointer',
    manifestText: substitutedPointer.text,
    manifest: substitutedPointer.pointer,
    referenceReceipt: substitutedPointer.receipt,
    expectedManifestSha256: substitutedPointer.sha,
    authenticatedIngress,
  }),
  /pointer packet authority mismatch for manifest\.ingressAuthority\.bindings\.frame0HighResolutionS1/,
  'coordinated pointer manifest and receipt binding substitution must not false-pass',
);

const falseReceiptPointer = await makePointerPacket(dynamicPointerShape, {
  manifestIngressAuthority: pointerIngressAuthority,
  receiptIngressAuthority: { ...pointerIngressAuthority, passed: false },
});
await assert.rejects(
  () => verifySam31TwoFramePacketAuthority({
    name: 'pointer',
    manifestText: falseReceiptPointer.text,
    manifest: falseReceiptPointer.pointer,
    referenceReceipt: falseReceiptPointer.receipt,
    expectedManifestSha256: falseReceiptPointer.sha,
    authenticatedIngress,
  }),
  /pointer packet authority mismatch for referenceReceipt\.ingressAuthority\.passed/,
  'authenticated pointer authority requires a passed ingress authority on its reference receipt',
);

const wrongPointer = await makePointerPacket({ ...dynamicPointerShape, sourceMaskHeight: 32 }, { manifestIngressAuthority: pointerIngressAuthority });
await assert.rejects(
  () => verifySam31TwoFramePacketAuthority({
    name: 'pointer',
    manifestText: wrongPointer.text,
    manifest: wrongPointer.pointer,
    referenceReceipt: wrongPointer.receipt,
    expectedManifestSha256: wrongPointer.sha,
    authenticatedIngress,
  }),
  /pointer packet authority mismatch for manifest\.shape\.sourceMaskHeight/,
  'pointer authority must reject source-mask geometry that does not match authenticated ingress H*16',
);

const standalonePointer = await makePointerPacket(pointerAuthority.shape);
assert.equal((await verifySam31TwoFramePacketAuthority({
  name: 'pointer',
  manifestText: standalonePointer.text,
  manifest: standalonePointer.pointer,
  referenceReceipt: standalonePointer.receipt,
  expectedManifestSha256: standalonePointer.sha,
})).passed, true, 'explicitly standalone pointer fixtures must remain valid without authenticated ingress');

const sam31PackageContract = {
  modelPackageSchema: 'kaminos.sam31-browser-tracker-legacy-model-package.v0',
  invocationSchema: 'kaminos.sam31-browser-tracker-legacy-invocation.v0',
  verificationSchema: 'kaminos.sam31-browser-tracker-legacy-verification.v0',
  modelPackagePrefix: 'sam31-tracker-legacy-model-package:',
  invocationPrefix: 'sam31-tracker-legacy-invocation:',
  verificationPrefix: 'sam31-tracker-legacy-verification:',
  evidenceSchema: 'kaminos.sam31-browser-tracker-legacy-package-invocation-evidence.v0',
  modelPackageFields: ['packageId', 'model', 'source', 'routeIds', 'geometry', 'staticArtifacts'],
  invocationFields: ['invocationId', 'sourceImages', 'initialMask', 'session'],
  verificationFields: ['verificationId', 'verifiedPackageId', 'verifiedInvocationId', 'reference', 'tolerances', 'tensors'],
};
const packageArtifacts = new Map();
const encodeArtifact = value => JSON.stringify(value, null, 2);
const sha256TextSync = value => createHash('sha256').update(value).digest('hex');
const identityId = (prefix, value, fields, identityField) => {
  const contract = Object.fromEntries(fields.filter(field => field !== identityField && Object.hasOwn(value, field)).map(field => [field, value[field]]));
  return `${prefix}${sha256TextSync(canonicalSam3IdentityJson(contract))}`;
};
const addPackageArtifact = (file, value) => {
  const text = encodeArtifact(value);
  packageArtifacts.set(file, text);
  return { file, sha256: sha256TextSync(text), schema: value.schema };
};
const trackerModelPackage = {
  schema: sam31PackageContract.modelPackageSchema,
  packageId: 'pending',
  model: { id: 'facebook/sam3.1', revision: 'daa63191845a41281374e725f4c9e51c7a824460' },
  source: { repository: 'facebookresearch/sam3', commit: '5dd401d1c5c1d5c3eedff06d41b77af824517619' },
  routeIds: ['sam3.image-preprocess.phase-program.webgpu-local.v0', 'sam3.1.multiplex-mask-decoder.phase-program.webgpu-local.v0'],
  geometry: { frameCount: 2, imageResolution: 28, queryHeight: 2, queryWidth: 2 },
  staticArtifacts: [{ role: 'vit-weight', file: 'vit-weight.bin', sha256: `sha256:${'a'.repeat(64)}` }],
};
trackerModelPackage.packageId = identityId(sam31PackageContract.modelPackagePrefix, trackerModelPackage, sam31PackageContract.modelPackageFields, 'packageId');
const trackerInvocation = {
  schema: sam31PackageContract.invocationSchema,
  invocationId: 'pending',
  sourceImages: [{ frameIndex: 0, file: 'frame-0.rgba.bin', sha256: `sha256:${'b'.repeat(64)}` }, { frameIndex: 1, file: 'frame-1.rgba.bin', sha256: `sha256:${'c'.repeat(64)}` }],
  initialMask: { file: 'initial-mask.bin', sha256: `sha256:${'d'.repeat(64)}` },
  session: { sessionId: 'session-one', conditioningFrameIndex: 0, propagationFrameIndices: [1] },
};
trackerInvocation.invocationId = identityId(sam31PackageContract.invocationPrefix, trackerInvocation, sam31PackageContract.invocationFields, 'invocationId');
const trackerVerification = {
  schema: sam31PackageContract.verificationSchema,
  verificationId: 'pending',
  verifiedPackageId: trackerModelPackage.packageId,
  verifiedInvocationId: trackerInvocation.invocationId,
  reference: { sourceCommit: trackerModelPackage.source.commit },
  tolerances: { finalMaskMaxAbsDiff: 0.001 },
  tensors: [{ role: 'expected-final-mask', file: 'expected-mask.bin', sha256: `sha256:${'e'.repeat(64)}` }],
};
trackerVerification.verificationId = identityId(sam31PackageContract.verificationPrefix, trackerVerification, sam31PackageContract.verificationFields, 'verificationId');
const trackerRoot = {
  schema: 'kaminos.sam31-browser-tracker-root.v0',
  modelPackage: addPackageArtifact('sam31-model-package.json', trackerModelPackage),
  invocation: addPackageArtifact('sam31-invocation.json', trackerInvocation),
  verification: addPackageArtifact('sam31-verification.json', trackerVerification),
};
const trackerResolution = resolveSam3BrowserPackageManifestSync(trackerRoot, {
  contract: sam31PackageContract,
  readArtifactText: file => packageArtifacts.get(file),
  sha256Text: sha256TextSync,
});
assert.equal(trackerResolution.manifest.packageId, trackerModelPackage.packageId);
assert.equal(trackerResolution.manifest.invocationId, trackerInvocation.invocationId);
assert.equal(trackerResolution.manifest.sourceImages.length, 2);
assert.equal(trackerResolution.manifest.tensors[0].role, 'expected-final-mask');
assert.equal(trackerResolution.evidence.schema, sam31PackageContract.evidenceSchema);
const verificationFreeTracker = resolveSam3BrowserPackageManifestSync({ ...trackerRoot, verification: undefined }, {
  contract: sam31PackageContract,
  readArtifactText: file => packageArtifacts.get(file),
  sha256Text: sha256TextSync,
});
assert.equal(verificationFreeTracker.evidence.verification.attached, false);
assert.equal(verificationFreeTracker.manifest.tensors, undefined, 'verification-free tracker invocation must not acquire expected tensors');

const packageEntry = (role, digit) => ({ role, file: `${role}.bin`, sha256: `sha256:${digit.repeat(64)}`, byteLength: 4, shape: [1], dtype: 'float32' });
const sharedWeight = packageEntry('shared-weight', '1');
const packagePackets = {
  ingress: {
    schema: 'ingress', routeIds: ['image-route'], shape: { imageHeight: 28 }, reference: twoImageReference,
    sourceImages: [
      { frameIndex: 0, originalSha256: `sha256:${'8'.repeat(64)}`, rgbaSha256: `sha256:${'2'.repeat(64)}` },
      { frameIndex: 1, originalSha256: `sha256:${'9'.repeat(64)}`, rgbaSha256: `sha256:${'3'.repeat(64)}` },
    ],
    weights: [sharedWeight],
    tensors: [packageEntry('frame-0-rgba', '2'), packageEntry('frame-1-rgba', '3'), packageEntry('expected-ingress', '4')],
    tolerances: { maximum: 0.001 },
  },
  decoder: { schema: 'decoder', routeId: 'decoder-route', shape: { channels: 256 }, reference: twoImageReference, weights: [sharedWeight], tensors: [packageEntry('expected-decoder', '5')], tolerances: { maximum: 0.001 } },
  memory: { schema: 'memory', routeIds: ['memory-route'], shape: { channels: 256 }, reference: twoImageReference, weights: [packageEntry('memory-weight', '6')], tensors: [packageEntry('expected-memory', '7')], tolerances: { maximum: 0.001 } },
  temporal: {
    schema: 'temporal', routeId: 'temporal-route', shape: { channels: 256 }, reference: twoImageReference,
    attentionWeights: [packageEntry('attention-weight', '8')],
    tensors: [packageEntry('maskmem-temporal-embeddings', '9'), packageEntry('pointer-position-projection-weight', 'a'), packageEntry('pointer-position-projection-bias', 'b'), packageEntry('expected-temporal', 'c')],
    tolerances: { maximum: 0.001 },
  },
  episode: {
    schema: 'episode', shape: { channels: 256 }, plan: { frameIndex: 1 }, reference: twoImageReference,
    tensors: [packageEntry('frame-0-binary-mask-inputs', 'd'), packageEntry('frame-0-extra-per-object-embedding', 'e'), packageEntry('frame-1-extra-per-object-embedding', 'f'), packageEntry('expected-episode', '0')],
    tolerances: { maximum: 0.001 },
  },
  pointer: {
    schema: 'pointer', routeId: 'pointer-route', shape: { channels: 256 }, reference: twoImageReference,
    ingressAuthority: { passed: true, manifestSha256: `sha256:${'4'.repeat(64)}`, bindings: { frame0HighResolutionS1: `sha256:${'5'.repeat(64)}` } },
    weights: [packageEntry('pointer-weight', '2')], tensors: [packageEntry('expected-pointer', '3')], tolerances: { maximum: 0.001 },
  },
};
const packageAuthorities = { ingress: { passed: true }, pointer: packagePackets.pointer.ingressAuthority };
const packageProjection = await createSam31BrowserTrackerPackageProjection({ packets: packagePackets, sessionId: 'fixture-session', componentAuthorities: packageAuthorities });
const repeatedProjection = await createSam31BrowserTrackerPackageProjection({ packets: packagePackets, sessionId: 'fixture-session', componentAuthorities: packageAuthorities });
const changedPointerAuthorityPackets = structuredClone(packagePackets);
changedPointerAuthorityPackets.pointer.ingressAuthority = {
  passed: true,
  manifestSha256: `sha256:${'6'.repeat(64)}`,
  bindings: { frame0HighResolutionS1: `sha256:${'7'.repeat(64)}` },
};
const changedPointerAuthorityProjection = await createSam31BrowserTrackerPackageProjection({
  packets: changedPointerAuthorityPackets,
  sessionId: 'fixture-session',
  componentAuthorities: { ...packageAuthorities, pointer: changedPointerAuthorityPackets.pointer.ingressAuthority },
});
const substitutedEncodedSourcePackets = structuredClone(packagePackets);
substitutedEncodedSourcePackets.ingress.sourceImages[0].originalSha256 = `sha256:${'7'.repeat(64)}`;
const substitutedEncodedSourceProjection = await createSam31BrowserTrackerPackageProjection({ packets: substitutedEncodedSourcePackets, sessionId: 'fixture-session', componentAuthorities: { ingress: { passed: true } } });
const mismatchedRgbaPackets = structuredClone(packagePackets);
mismatchedRgbaPackets.ingress.sourceImages[0].rgbaSha256 = `sha256:${'6'.repeat(64)}`;
await assert.rejects(
  () => createSam31BrowserTrackerPackageProjection({ packets: mismatchedRgbaPackets, sessionId: 'fixture-session', componentAuthorities: { ingress: { passed: true } } }),
  /RGBA identity does not match its invocation artifact/,
);
assert.equal(packageProjection.modelPackage.packageId, repeatedProjection.modelPackage.packageId, 'rerunning package projection must preserve content identity');
assert.equal(
  packageProjection.modelPackage.packageId,
  changedPointerAuthorityProjection.modelPackage.packageId,
  'invocation-specific pointer ingress authority must not contaminate reusable model-package identity',
);
assert.equal(packageProjection.modelPackage.components.pointer.ingressAuthority, undefined, 'pointer ingress authority must not be projected into immutable model metadata');
assert.notEqual(
  packageProjection.verification.verificationId,
  changedPointerAuthorityProjection.verification.verificationId,
  'pointer ingress authority changes must remain identity-bearing verification evidence',
);
assert.deepEqual(packageProjection.verification.componentAuthorities.pointer, packagePackets.pointer.ingressAuthority);
assert.equal(packageProjection.invocation.invocationId, repeatedProjection.invocation.invocationId, 'rerunning invocation projection must preserve content identity');
assert.notEqual(packageProjection.invocation.invocationId, substitutedEncodedSourceProjection.invocation.invocationId, 'encoded-image substitution must alter invocation identity even when RGBA tensor bytes are unchanged');
assert.deepEqual(
  packageProjection.invocation.sourceImages.map(image => [image.originalSha256, image.rgbaSha256]),
  packagePackets.ingress.sourceImages.map(image => [image.originalSha256, image.rgbaSha256]),
  'package projection must preserve both authenticated source-image identities',
);
assert.equal(packageProjection.verification.verificationId, repeatedProjection.verification.verificationId, 'rerunning verification projection must preserve content identity');
assert.equal(packageProjection.modelPackage.staticArtifacts.filter(entry => entry.sha256 === sharedWeight.sha256).length, 1, 'identical checkpoint bytes must be stored once');
assert.equal(packageProjection.modelPackage.staticArtifacts.find(entry => entry.sha256 === sharedWeight.sha256).aliases.length, 2, 'deduplicated bytes must preserve both component aliases');
assert.deepEqual(packageProjection.invocation.dynamicArtifacts.map(entry => entry.role).sort(), ['frame-0-binary-mask-inputs', 'frame-0-rgba', 'frame-1-rgba']);
assert.deepEqual(
  packageProjection.invocation.dynamicArtifacts.map(entry => `${entry.packetName}:${entry.role}`).sort(),
  ['episode:frame-0-binary-mask-inputs', 'ingress:frame-0-rgba', 'ingress:frame-1-rgba'],
  'invocation artifacts must carry their authoritative component ownership into the browser package',
);
assert.equal(packageProjection.verification.tensors.ingress.some(entry => entry.role === 'frame-0-rgba'), false, 'source images must not remain verification-owned');
assert.equal(packageProjection.verification.tensors.episode.some(entry => entry.role === 'frame-0-binary-mask-inputs'), false, 'initial mask must not remain verification-owned');
assert.equal(packageProjection.modelPackage.components.temporal.staticTensors.length, 3, 'temporal embeddings and pointer projection must be package-owned');
assert.equal(packageProjection.modelPackage.components.episode.staticTensors.length, 2, 'per-object embeddings must be package-owned');
assert.match(packageProjection.modelPackage.packageId, /^sam31-tracker-model-package:sha256:/);
assert.match(packageProjection.invocation.invocationId, /^sam31-tracker-invocation:sha256:/);
assert.match(packageProjection.verification.verificationId, /^sam31-tracker-verification:sha256:/);
const projectedArtifacts = new Map([
  ['sam31-model-package.json', packageProjection.texts.modelPackage],
  ['sam31-invocation.json', packageProjection.texts.invocation],
  ['sam31-verification.json', packageProjection.texts.verification],
]);
const resolveProjection = root => resolveSam3BrowserPackageManifestSync(root, {
  contract: SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT,
  readArtifactText: file => projectedArtifacts.get(file),
  sha256Text: text => `sha256:${sha256TextSync(text)}`,
});
const verifiedProjection = resolveProjection(packageProjection.root);
assert.equal(verifiedProjection.evidence.packageId, packageProjection.modelPackage.packageId);
assert.equal(verifiedProjection.manifest.tensors.episode[0].file.startsWith('verification/'), true);
const runtimeProjection = resolveProjection(packageProjection.runtimeRoot);
assert.equal(runtimeProjection.evidence.verification.attached, false);
assert.equal(runtimeProjection.manifest.tensors, undefined, 'runtime root must execute without verification-owned expected tensors');

const substitutedModelPackage = structuredClone(packageProjection.modelPackage);
substitutedModelPackage.claims = { ...substitutedModelPackage.claims, packageSubstitutionProbe: 'different-package' };
substitutedModelPackage.packageId = `${SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.modelPackagePrefix}sha256:${sha256TextSync(canonicalSam3IdentityJson(
  Object.fromEntries(SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.modelPackageFields
    .filter(field => field !== 'packageId' && Object.hasOwn(substitutedModelPackage, field))
    .map(field => [field, substitutedModelPackage[field]])),
))}`;
const omittedBindingInvocation = structuredClone(packageProjection.invocation);
delete omittedBindingInvocation.modelPackageId;
omittedBindingInvocation.invocationId = `${SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.invocationPrefix}sha256:${sha256TextSync(canonicalSam3IdentityJson(
  Object.fromEntries(SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.invocationFields
    .filter(field => field !== 'invocationId' && Object.hasOwn(omittedBindingInvocation, field))
    .map(field => [field, omittedBindingInvocation[field]])),
))}`;
const omittedBindingArtifacts = new Map([
  ['sam31-model-package.json', encodeArtifact(substitutedModelPackage)],
  ['sam31-invocation.json', encodeArtifact(omittedBindingInvocation)],
]);
const omittedBindingRoot = {
  ...packageProjection.runtimeRoot,
  modelPackage: {
    ...packageProjection.runtimeRoot.modelPackage,
    sha256: `sha256:${sha256TextSync(omittedBindingArtifacts.get('sam31-model-package.json'))}`,
  },
  invocation: {
    ...packageProjection.runtimeRoot.invocation,
    sha256: `sha256:${sha256TextSync(omittedBindingArtifacts.get('sam31-invocation.json'))}`,
  },
};
assert.throws(
  () => resolveSam3BrowserPackageManifestSync(omittedBindingRoot, {
    contract: SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT,
    readArtifactText: file => omittedBindingArtifacts.get(file),
    sha256Text: text => `sha256:${sha256TextSync(text)}`,
  }),
  /invocation missing required identity field modelPackageId/,
  'a same-schema invocation must not omit package binding and authenticate against a substituted package',
);

const weakenedSameSchemaContract = {
  ...SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT,
  invocationFields: SAM31_BROWSER_TRACKER_PACKAGE_CONTRACT.invocationFields
    .filter(field => field !== 'modelPackageId'),
};
assert.throws(
  () => resolveSam3BrowserPackageManifestSync(omittedBindingRoot, {
    contract: weakenedSameSchemaContract,
    readArtifactText: file => omittedBindingArtifacts.get(file),
    sha256Text: text => `sha256:${sha256TextSync(text)}`,
  }),
  /SAM 3\.1 invocation contract must require modelPackageId/,
  'the current SAM 3.1 invocation schema must not be weakened by a caller-supplied field list',
);

console.log('sam3.1 packet byte and temporal authority contracts passed');
