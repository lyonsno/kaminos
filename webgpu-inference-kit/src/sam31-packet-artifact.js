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
