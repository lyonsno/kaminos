import assert from 'node:assert/strict';

import {
  SAM31_TWO_FRAME_PACKET_AUTHORITIES,
  SAM31_TEMPORAL_PACKET_AUTHORITY,
  verifySam31PacketFloat32Bytes,
  verifySam31TemporalPacketAuthority,
  verifySam31TwoFramePacketAuthority,
} from '../src/index.js';

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

console.log('sam3.1 packet byte and temporal authority contracts passed');
