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
const ingressManifestSha256 = `sha256:${'1'.repeat(64)}`;
const ingressManifest = {
  schema: 'kaminos.sam31-two-image-ingress-meta-packet.v0',
  boundary: 'sam31-two-distinct-raw-images-to-interactive-propagation-backbone-features',
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
async function makeTwoImageEpisode(bindings) {
  const episode = {
    schema: twoImageAuthority.manifestSchema,
    boundary: twoImageAuthority.boundary,
    mode: twoImageAuthority.mode,
    reference: twoImageReference,
    shape: twoImageAuthority.shape,
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

const sam31PackageContract = {
  modelPackageSchema: 'kaminos.sam31-browser-tracker-model-package.v0',
  invocationSchema: 'kaminos.sam31-browser-tracker-invocation.v0',
  verificationSchema: 'kaminos.sam31-browser-tracker-verification.v0',
  modelPackagePrefix: 'sam31-tracker-model-package:',
  invocationPrefix: 'sam31-tracker-invocation:',
  verificationPrefix: 'sam31-tracker-verification:',
  evidenceSchema: 'kaminos.sam31-browser-tracker-package-invocation-evidence.v0',
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
  pointer: { schema: 'pointer', routeId: 'pointer-route', shape: { channels: 256 }, reference: twoImageReference, weights: [packageEntry('pointer-weight', '2')], tensors: [packageEntry('expected-pointer', '3')], tolerances: { maximum: 0.001 } },
};
const packageProjection = await createSam31BrowserTrackerPackageProjection({ packets: packagePackets, sessionId: 'fixture-session', componentAuthorities: { ingress: { passed: true } } });
const repeatedProjection = await createSam31BrowserTrackerPackageProjection({ packets: packagePackets, sessionId: 'fixture-session', componentAuthorities: { ingress: { passed: true } } });
assert.equal(packageProjection.modelPackage.packageId, repeatedProjection.modelPackage.packageId, 'rerunning package projection must preserve content identity');
assert.equal(packageProjection.invocation.invocationId, repeatedProjection.invocation.invocationId, 'rerunning invocation projection must preserve content identity');
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

console.log('sam3.1 packet byte and temporal authority contracts passed');
