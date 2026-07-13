import assert from 'node:assert/strict';

import {
  SAM31_TEMPORAL_PACKET_AUTHORITY,
  verifySam31PacketFloat32Bytes,
  verifySam31TemporalPacketAuthority,
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

console.log('sam3.1 packet byte and temporal authority contracts passed');
