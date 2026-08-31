#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const runtimeUrl = new URL('../volume-layer-coefficient-live-union-overlay.mjs', import.meta.url);
assert.ok(existsSync(fileURLToPath(runtimeUrl)), 'live-union coefficient browser loader must exist');

const {
  auditLayerCoefficientLiveUnionPopulation,
  createLayerCoefficientLiveUnionGpuResources,
  loadLayerCoefficientLiveUnionOverlay,
} = await import(runtimeUrl);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonicalize = value => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
};
const canonicalIdentity = value => {
  const payload = { ...value };
  delete payload.identity;
  return `sha256:${sha256(Buffer.from(JSON.stringify(canonicalize(payload))))}`;
};
const artifact = (relativePath, bytes, dtype, shape, semanticRole) => ({
  path: `/ignored/absolute/${relativePath}`,
  relativePath,
  bytes: bytes.byteLength,
  sha256: sha256(bytes),
  dtype,
  shape,
  semanticRole,
});

const coefficients = Buffer.from(new Float32Array([
  1, 2, 3, 4, 5, 6, 7, 8,
  9, 10, 11, 12, 13, 14, 15, 16,
]).buffer);
const nativeCellIndices = Buffer.from(new Uint32Array([2, 6]).buffer);
const denseLookup = Buffer.from(new Uint32Array([0, 0, 1, 0, 0, 0, 2, 0]).buffer);
const sourceHashes = {
  boundarySidecarSha256: '1'.repeat(64),
  fluidSha256: '2'.repeat(64),
  frontSha256: '3'.repeat(64),
};
const manifest = {
  schema: 'kaminos.volume.layer-coefficient-live-union-overlay.v1',
  status: 'complete',
  failurePhase: null,
  authority: 'exact-native-cell-identity-overlay-remap-v0',
  selector: {
    authority: 'explicit-source-field-operator-v0',
    recipeSha256: '541836e6c45ef014ab0b8be23ebd8dce9898900a7639a0c4e21f38336daef8f9',
    compositionIdentity: 'separate-ridge-nonridge-shared-total-extinction-v0',
  },
  source: {
    overlayIdentity: `sha256:${'5'.repeat(64)}`,
    model: { sha256: '6'.repeat(64) },
    state: {
      id: 'coefficient-state-test',
      rowCount: 2,
      admissionIndexSha256: sha256(nativeCellIndices),
      sourceHashes,
    },
  },
  routing: {
    grid: 2,
    gridCellCount: 8,
    admittedRowCount: 2,
    lookupEncoding: 'row-plus-one-zero-missing-v0',
    missingRowValue: 0,
    coefficientRowOffset: -1,
    coefficientOrder: [
      'ridge.emission.r', 'ridge.emission.g', 'ridge.emission.b', 'ridge.extinction',
      'nonRidge.emission.r', 'nonRidge.emission.g', 'nonRidge.emission.b', 'nonRidge.extinction',
    ],
  },
  artifacts: {
    coefficients: artifact('coefficients.f32', coefficients, 'float32-le', [2, 8], 'compact-live-union-layer-coefficients'),
    nativeCellIndices: artifact('native-cell-indices.u32', nativeCellIndices, 'uint32-le', [2], 'checksum-bound-admitted-native-cell-identities'),
    denseLookup: artifact('native-cell-row-plus-one.u32', denseLookup, 'uint32-le', [8], 'native-cell-to-compact-coefficient-row-plus-one'),
  },
  execution: {
    sampleCap: null,
    droppedRowCount: 0,
    unmappedAdmittedRowCount: 0,
  },
};
manifest.identity = canonicalIdentity(manifest);
const expectedLiveSource = {
  grid: 2,
  admissionIndexSha256: sha256(nativeCellIndices),
  sourceOverlayIdentity: manifest.source.overlayIdentity,
  sourceHashes,
};

const manifestUrl = 'https://fixture.invalid/runtime-overlay.json';
const responseMap = new Map([
  [manifestUrl, Buffer.from(`${JSON.stringify(manifest)}\n`)],
  ['https://fixture.invalid/coefficients.f32', coefficients],
  ['https://fixture.invalid/native-cell-indices.u32', nativeCellIndices],
  ['https://fixture.invalid/native-cell-row-plus-one.u32', denseLookup],
]);
const fetchImpl = async url => {
  const bytes = responseMap.get(String(url));
  return bytes
    ? { ok: true, status: 200, json: async () => JSON.parse(bytes), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
    : { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
};

const loaded = await loadLayerCoefficientLiveUnionOverlay({
  manifestUrl,
  fetchImpl,
  expectedSource: expectedLiveSource,
});
assert.equal(loaded.receipt.status, 'complete');
assert.equal(loaded.receipt.authority, 'checksum-bound-live-union-overlay-loader-v0');
assert.equal(loaded.receipt.overlayIdentity, manifest.identity);
assert.equal(loaded.receipt.admittedRowCount, 2);
assert.equal(loaded.receipt.lookupPopulation, 2);
assert.equal(loaded.receipt.lookupMissCount, 0);
assert.equal(loaded.receipt.sampleCap, null);
assert.equal(loaded.coefficients.length, 16);
assert.deepEqual([...loaded.nativeCellIndices], [2, 6]);
assert.deepEqual([...loaded.denseLookup], [0, 0, 1, 0, 0, 0, 2, 0]);

const exactPopulationAudit = {
  stableNativeCellIdSha256: sha256(nativeCellIndices),
  stableNativeCellIds: [2, 6],
  stableNativeCellIdAuthority: 'gpu-compacted-native-grid-linear-index-v0',
  candidateCount: 2,
  instanceCount: 2,
  overflowCount: 0,
  unionReceipt: { identity: 'test-live-union-receipt-v0' },
};
const exactPopulation = auditLayerCoefficientLiveUnionPopulation({
  overlay: loaded,
  audit: exactPopulationAudit,
  exactUnionModeEffective: true,
});
assert.equal(exactPopulation.status, 'effective');
assert.equal(exactPopulation.lookupMissCount, 0);
assert.equal(exactPopulation.lookupExtraCount, 0);
assert.deepEqual(exactPopulation.failures, []);

const wrongIdentity = auditLayerCoefficientLiveUnionPopulation({
  overlay: loaded,
  audit: { ...exactPopulationAudit, stableNativeCellIdSha256: '0'.repeat(64) },
  exactUnionModeEffective: true,
});
assert.equal(wrongIdentity.status, 'failed');
assert.match(wrongIdentity.failures.join('|'), /stable-native-cell-sha256-mismatch/);

const partialPopulation = auditLayerCoefficientLiveUnionPopulation({
  overlay: loaded,
  audit: { ...exactPopulationAudit, candidateCount: 2, instanceCount: 1, overflowCount: 1 },
  exactUnionModeEffective: true,
});
assert.equal(partialPopulation.status, 'failed');
assert.match(partialPopulation.failures.join('|'), /partial-live-union-population/);

const missingLookupOverlay = { ...loaded, denseLookup: new Uint32Array([0, 0, 1, 0, 0, 0, 0, 0]) };
const missingLookup = auditLayerCoefficientLiveUnionPopulation({
  overlay: missingLookupOverlay,
  audit: exactPopulationAudit,
  exactUnionModeEffective: true,
});
assert.equal(missingLookup.status, 'failed');
assert.equal(missingLookup.lookupMissCount, 1);
assert.equal(missingLookup.lookupExtraCount, 1);

const staleExtra = auditLayerCoefficientLiveUnionPopulation({
  overlay: loaded,
  audit: {
    ...exactPopulationAudit,
    stableNativeCellIdSha256: sha256(Buffer.from(new Uint32Array([2]).buffer)),
    stableNativeCellIds: [2],
    candidateCount: 1,
    instanceCount: 1,
  },
  exactUnionModeEffective: true,
});
assert.equal(staleExtra.status, 'failed');
assert.equal(staleExtra.lookupExtraCount, 1);
assert.match(staleExtra.failures.join('|'), /lookup-extras/);

const writes = [];
const buffers = [];
const originalUsage = globalThis.GPUBufferUsage;
globalThis.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2 };
try {
  const resources = createLayerCoefficientLiveUnionGpuResources({
    device: {
      createBuffer(descriptor) {
        const buffer = { descriptor };
        buffers.push(buffer);
        return buffer;
      },
      queue: {
        writeBuffer(buffer, offset, values) {
          writes.push({ buffer, offset, byteLength: values.byteLength });
        },
      },
    },
    overlay: loaded,
  });
  assert.equal(buffers.length, 2);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map(write => write.byteLength), [coefficients.byteLength, denseLookup.byteLength]);
  assert.equal(resources.receipt.coefficientBufferBytes, coefficients.byteLength);
  assert.equal(resources.receipt.lookupBufferBytes, denseLookup.byteLength);
  assert.equal(resources.receipt.overlayIdentity, manifest.identity);
} finally {
  globalThis.GPUBufferUsage = originalUsage;
}

async function rejection(label, mutateManifest, mutateResponses, expected) {
  const candidate = structuredClone(manifest);
  mutateManifest(candidate);
  if (!candidate.identity?.startsWith('sha256:') || candidate.identity === manifest.identity) {
    candidate.identity = canonicalIdentity(candidate);
  }
  const candidateMap = new Map(responseMap);
  candidateMap.set(manifestUrl, Buffer.from(`${JSON.stringify(candidate)}\n`));
  mutateResponses(candidateMap);
  const candidateFetch = async url => {
    const bytes = candidateMap.get(String(url));
    return bytes
      ? { ok: true, status: 200, json: async () => JSON.parse(bytes), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
      : { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  await assert.rejects(
    loadLayerCoefficientLiveUnionOverlay({ manifestUrl, fetchImpl: candidateFetch, expectedSource: expectedLiveSource }),
    expected,
    label,
  );
}

await rejection('selector drift fails loud', candidate => { candidate.selector.recipeSha256 = '0'.repeat(64); }, () => {}, /selector recipe drift/);
await rejection('hidden row loss fails loud', candidate => { candidate.execution.droppedRowCount = 1; }, () => {}, /dropped rows/);
await rejection('manifest source-hash key drift fails loud', candidate => { candidate.source.state.sourceHashes.staleSha256 = '7'.repeat(64); }, () => {}, /source hash key set drift/);
await rejection('manifest identity drift fails loud', candidate => { candidate.identity = `sha256:${'0'.repeat(64)}`; }, () => {}, /manifest identity mismatch/);
await rejection('partial coefficient artifact fails loud', () => {}, map => { map.set('https://fixture.invalid/coefficients.f32', coefficients.subarray(0, 32)); }, /byte length mismatch/);
await rejection('coefficient checksum drift fails loud', () => {}, map => { const changed = Buffer.from(coefficients); changed[0] ^= 1; map.set('https://fixture.invalid/coefficients.f32', changed); }, /sha256 mismatch/);
const emptyLookup = Buffer.from(new Uint32Array(8).buffer);
await rejection(
  'checksum-valid lookup population drift fails loud',
  candidate => {
    candidate.artifacts.denseLookup.sha256 = sha256(emptyLookup);
  },
  map => { map.set('https://fixture.invalid/native-cell-row-plus-one.u32', emptyLookup); },
  /lookup population mismatch/,
);
const negativeCoefficients = Buffer.from(coefficients);
new Float32Array(negativeCoefficients.buffer, negativeCoefficients.byteOffset, negativeCoefficients.byteLength / 4)[0] = -1;
await rejection(
  'checksum-valid negative coefficients fail loud',
  candidate => {
    candidate.artifacts.coefficients.sha256 = sha256(negativeCoefficients);
  },
  map => { map.set('https://fixture.invalid/coefficients.f32', negativeCoefficients); },
  /negative coefficients/,
);

await assert.rejects(
  loadLayerCoefficientLiveUnionOverlay({
    manifestUrl,
    fetchImpl,
    expectedSource: { ...expectedLiveSource, sourceHashes: { ...sourceHashes, fluidSha256: 'f'.repeat(64) } },
  }),
  /source hash mismatch: fluidSha256/,
  'live source checksum mismatch fails before artifact loading',
);
await assert.rejects(
  loadLayerCoefficientLiveUnionOverlay({
    manifestUrl,
    fetchImpl,
    expectedSource: {
      ...expectedLiveSource,
      sourceHashes: { ...sourceHashes, staleSha256: '7'.repeat(64) },
    },
  }),
  /expected source hash key set drift/,
  'live source identity cannot carry extra stale source hashes',
);
await assert.rejects(
  loadLayerCoefficientLiveUnionOverlay({
    manifestUrl,
    fetchImpl,
    expectedSource: { ...expectedLiveSource, sourceOverlayIdentity: 'sha256:wrong-producer' },
  }),
  /source overlay identity mismatch/,
  'underlying coefficient producer substitution fails before artifact loading',
);

console.log('volume layer coefficient live-union overlay contracts passed');
