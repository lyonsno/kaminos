const RUNTIME_SCHEMA = 'kaminos.volume.layer-coefficient-live-union-overlay.v0';
const RUNTIME_AUTHORITY = 'exact-native-cell-identity-overlay-remap-v0';
const LOADER_AUTHORITY = 'checksum-bound-live-union-overlay-loader-v0';
const SELECTOR_AUTHORITY = 'explicit-source-field-operator-v0';
const SELECTOR_RECIPE_SHA256 = '541836e6c45ef014ab0b8be23ebd8dce9898900a7639a0c4e21f38336daef8f9';
const COMPOSITION_IDENTITY = 'separate-ridge-nonridge-shared-total-extinction-v0';
const LOOKUP_ENCODING = 'row-plus-one-zero-missing-v0';
const COEFFICIENT_ORDER = [
  'ridge.emission.r', 'ridge.emission.g', 'ridge.emission.b', 'ridge.extinction',
  'nonRidge.emission.r', 'nonRidge.emission.g', 'nonRidge.emission.b', 'nonRidge.extinction',
];
const SOURCE_HASH_KEYS = [
  'fluidSha256',
  'frontSha256',
  'boundarySidecarSha256',
  'majorantSha256',
];

function requireContract(condition, message) {
  if (!condition) throw new Error(`live-union coefficient overlay ${message}`);
}

function validSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function hasCanonicalSourceHashKeys(value) {
  return value && typeof value === 'object'
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...SOURCE_HASH_KEYS].sort());
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

async function manifestIdentity(manifest) {
  const payload = { ...manifest };
  delete payload.identity;
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(payload)));
  return `sha256:${await sha256Hex(bytes)}`;
}

function validateArtifactReceipt(artifact, expected) {
  requireContract(artifact && typeof artifact === 'object', `${expected.label} receipt is missing`);
  requireContract(artifact.relativePath === expected.relativePath, `${expected.label} relative path drift`);
  requireContract(Number.isSafeInteger(artifact.bytes) && artifact.bytes === expected.bytes, `${expected.label} declared byte length mismatch`);
  requireContract(artifact.dtype === expected.dtype, `${expected.label} dtype drift`);
  requireContract(JSON.stringify(artifact.shape) === JSON.stringify(expected.shape), `${expected.label} shape drift`);
  requireContract(artifact.semanticRole === expected.semanticRole, `${expected.label} semantic role drift`);
  requireContract(validSha256(artifact.sha256), `${expected.label} sha256 is missing`);
}

async function fetchArtifact({ manifestUrl, artifact, fetchImpl, label }) {
  const url = new URL(artifact.relativePath, manifestUrl).href;
  const response = await fetchImpl(url, { cache: 'no-store' });
  requireContract(response?.ok === true, `${label} fetch failed: ${response?.status ?? 'unknown'}`);
  const bytes = await response.arrayBuffer();
  requireContract(bytes.byteLength === artifact.bytes, `${label} byte length mismatch: ${bytes.byteLength} != ${artifact.bytes}`);
  const actualSha256 = await sha256Hex(bytes);
  requireContract(actualSha256 === artifact.sha256, `${label} sha256 mismatch: ${actualSha256} != ${artifact.sha256}`);
  return { url, bytes, sha256: actualSha256 };
}

function validateExpectedSource(manifest, expectedSource) {
  requireContract(expectedSource && typeof expectedSource === 'object', 'expected live source identity is required');
  const { routing, source } = manifest;
  requireContract(expectedSource.grid === routing.grid, `live grid mismatch: ${expectedSource.grid} != ${routing.grid}`);
  requireContract(
    expectedSource.admissionIndexSha256 === source.state.admissionIndexSha256,
    'live admission index sha256 mismatch',
  );
  requireContract(
    typeof expectedSource.sourceOverlayIdentity === 'string'
      && expectedSource.sourceOverlayIdentity === source.overlayIdentity,
    'source overlay identity mismatch',
  );
  requireContract(expectedSource.sourceHashes && typeof expectedSource.sourceHashes === 'object', 'expected live source hashes are required');
  requireContract(hasCanonicalSourceHashKeys(expectedSource.sourceHashes), 'expected source hash key set drift');
  for (const key of SOURCE_HASH_KEYS) {
    requireContract(validSha256(expectedSource.sourceHashes[key]), `expected source hash is missing: ${key}`);
    requireContract(
      expectedSource.sourceHashes[key] === source.state.sourceHashes[key],
      `source hash mismatch: ${key}`,
    );
  }
}

function validateManifestStructure(manifest) {
  requireContract(manifest?.schema === RUNTIME_SCHEMA, `schema drift: ${manifest?.schema ?? 'missing'}`);
  requireContract(manifest.status === 'complete' && manifest.failurePhase === null, 'manifest is incomplete');
  requireContract(manifest.authority === RUNTIME_AUTHORITY, `authority drift: ${manifest.authority ?? 'missing'}`);
  requireContract(manifest.selector?.authority === SELECTOR_AUTHORITY, 'selector authority drift');
  requireContract(manifest.selector?.recipeSha256 === SELECTOR_RECIPE_SHA256, 'selector recipe drift');
  requireContract(manifest.selector?.compositionIdentity === COMPOSITION_IDENTITY, 'composition identity drift');
  requireContract(manifest.execution?.sampleCap === null, 'contains a hidden sample cap');
  requireContract(manifest.execution?.droppedRowCount === 0, 'contains dropped rows');
  requireContract(manifest.execution?.unmappedAdmittedRowCount === 0, 'contains unmapped admitted rows');
  requireContract(Number.isSafeInteger(manifest.routing?.grid) && manifest.routing.grid > 0, 'grid is invalid');
  requireContract(
    manifest.routing.gridCellCount === manifest.routing.grid ** 3,
    'grid cell count differs from cubic grid',
  );
  requireContract(Number.isSafeInteger(manifest.routing.admittedRowCount) && manifest.routing.admittedRowCount > 0, 'admitted row count is invalid');
  requireContract(manifest.source?.state?.rowCount === manifest.routing.admittedRowCount, 'source and routing row counts differ');
  requireContract(validSha256(manifest.source.state.admissionIndexSha256), 'source admission index sha256 is missing');
  requireContract(manifest.source.state.sourceHashes && typeof manifest.source.state.sourceHashes === 'object', 'source hashes are missing');
  requireContract(hasCanonicalSourceHashKeys(manifest.source.state.sourceHashes), 'source hash key set drift');
  for (const key of SOURCE_HASH_KEYS) requireContract(validSha256(manifest.source.state.sourceHashes[key]), `source hash is missing: ${key}`);
  requireContract(manifest.routing.lookupEncoding === LOOKUP_ENCODING, 'lookup encoding drift');
  requireContract(manifest.routing.missingRowValue === 0, 'lookup missing-row sentinel drift');
  requireContract(manifest.routing.coefficientRowOffset === -1, 'coefficient row offset drift');
  requireContract(JSON.stringify(manifest.routing.coefficientOrder) === JSON.stringify(COEFFICIENT_ORDER), 'coefficient order drift');
  requireContract(typeof manifest.source.overlayIdentity === 'string', 'source overlay identity is missing');
}

function validateDecodedArtifacts({ coefficients, nativeCellIndices, denseLookup, rowCount, gridCellCount }) {
  let nonfiniteCoefficientCount = 0;
  let negativeCoefficientCount = 0;
  for (const value of coefficients) {
    if (!Number.isFinite(value)) nonfiniteCoefficientCount += 1;
    else if (value < 0) negativeCoefficientCount += 1;
  }
  requireContract(nonfiniteCoefficientCount === 0, `contains ${nonfiniteCoefficientCount} nonfinite coefficients`);
  requireContract(negativeCoefficientCount === 0, `contains ${negativeCoefficientCount} negative coefficients`);

  let lookupPopulation = 0;
  let lookupRangeErrorCount = 0;
  for (const rowPlusOne of denseLookup) {
    if (rowPlusOne === 0) continue;
    lookupPopulation += 1;
    if (rowPlusOne > rowCount) lookupRangeErrorCount += 1;
  }
  requireContract(lookupRangeErrorCount === 0, `contains ${lookupRangeErrorCount} out-of-range lookup rows`);
  requireContract(lookupPopulation === rowCount, `lookup population mismatch: ${lookupPopulation} != ${rowCount}`);

  let lookupMissCount = 0;
  let lookupOrderMismatchCount = 0;
  for (let row = 0; row < nativeCellIndices.length; row += 1) {
    const nativeCellIndex = nativeCellIndices[row];
    if (nativeCellIndex >= gridCellCount) {
      lookupMissCount += 1;
      continue;
    }
    const rowPlusOne = denseLookup[nativeCellIndex];
    if (rowPlusOne === 0) lookupMissCount += 1;
    else if (rowPlusOne !== row + 1) lookupOrderMismatchCount += 1;
  }
  requireContract(lookupMissCount === 0, `lookup has ${lookupMissCount} admitted native-cell misses`);
  requireContract(lookupOrderMismatchCount === 0, `lookup has ${lookupOrderMismatchCount} row-order mismatches`);
  return { lookupPopulation, lookupMissCount, lookupOrderMismatchCount };
}

export async function loadLayerCoefficientLiveUnionOverlay({ manifestUrl, fetchImpl = globalThis.fetch, expectedSource }) {
  requireContract(typeof manifestUrl === 'string' && manifestUrl.length > 0, 'manifest URL is required');
  requireContract(typeof fetchImpl === 'function', 'fetch implementation is required');
  const response = await fetchImpl(manifestUrl, { cache: 'no-store' });
  requireContract(response?.ok === true, `manifest fetch failed: ${response?.status ?? 'unknown'}`);
  const manifest = await response.json();
  validateManifestStructure(manifest);
  requireContract(manifest.identity === await manifestIdentity(manifest), 'manifest identity mismatch');
  validateExpectedSource(manifest, expectedSource);

  const rowCount = manifest.routing.admittedRowCount;
  const gridCellCount = manifest.routing.gridCellCount;
  validateArtifactReceipt(manifest.artifacts?.coefficients, {
    label: 'coefficient artifact',
    relativePath: 'coefficients.f32',
    bytes: rowCount * 8 * Float32Array.BYTES_PER_ELEMENT,
    dtype: 'float32-le',
    shape: [rowCount, 8],
    semanticRole: 'compact-live-union-layer-coefficients',
  });
  validateArtifactReceipt(manifest.artifacts?.nativeCellIndices, {
    label: 'native-cell index artifact',
    relativePath: 'native-cell-indices.u32',
    bytes: rowCount * Uint32Array.BYTES_PER_ELEMENT,
    dtype: 'uint32-le',
    shape: [rowCount],
    semanticRole: 'checksum-bound-admitted-native-cell-identities',
  });
  validateArtifactReceipt(manifest.artifacts?.denseLookup, {
    label: 'dense lookup artifact',
    relativePath: 'native-cell-row-plus-one.u32',
    bytes: gridCellCount * Uint32Array.BYTES_PER_ELEMENT,
    dtype: 'uint32-le',
    shape: [gridCellCount],
    semanticRole: 'native-cell-to-compact-coefficient-row-plus-one',
  });
  requireContract(
    manifest.artifacts.nativeCellIndices.sha256 === manifest.source.state.admissionIndexSha256,
    'native-cell artifact differs from source admission identity',
  );

  const [coefficientArtifact, nativeCellArtifact, lookupArtifact] = await Promise.all([
    fetchArtifact({ manifestUrl, artifact: manifest.artifacts.coefficients, fetchImpl, label: 'coefficient artifact' }),
    fetchArtifact({ manifestUrl, artifact: manifest.artifacts.nativeCellIndices, fetchImpl, label: 'native-cell index artifact' }),
    fetchArtifact({ manifestUrl, artifact: manifest.artifacts.denseLookup, fetchImpl, label: 'dense lookup artifact' }),
  ]);
  const coefficients = new Float32Array(coefficientArtifact.bytes);
  const nativeCellIndices = new Uint32Array(nativeCellArtifact.bytes);
  const denseLookup = new Uint32Array(lookupArtifact.bytes);
  const audit = validateDecodedArtifacts({ coefficients, nativeCellIndices, denseLookup, rowCount, gridCellCount });
  return {
    manifest,
    coefficients,
    nativeCellIndices,
    denseLookup,
    receipt: {
      identity: 'layer-coefficient-live-union-overlay-load-receipt-v0',
      status: 'complete',
      authority: LOADER_AUTHORITY,
      manifestUrl,
      overlayIdentity: manifest.identity,
      sourceOverlayIdentity: manifest.source.overlayIdentity,
      selectorAuthority: SELECTOR_AUTHORITY,
      selectorRecipeSha256: SELECTOR_RECIPE_SHA256,
      compositionIdentity: COMPOSITION_IDENTITY,
      grid: manifest.routing.grid,
      gridCellCount,
      admittedRowCount: rowCount,
      lookupPopulation: audit.lookupPopulation,
      lookupMissCount: audit.lookupMissCount,
      lookupOrderMismatchCount: audit.lookupOrderMismatchCount,
      sampleCap: null,
      droppedRowCount: 0,
      artifacts: {
        coefficients: { url: coefficientArtifact.url, bytes: coefficientArtifact.bytes.byteLength, sha256: coefficientArtifact.sha256 },
        nativeCellIndices: { url: nativeCellArtifact.url, bytes: nativeCellArtifact.bytes.byteLength, sha256: nativeCellArtifact.sha256 },
        denseLookup: { url: lookupArtifact.url, bytes: lookupArtifact.bytes.byteLength, sha256: lookupArtifact.sha256 },
      },
    },
  };
}

export function auditLayerCoefficientLiveUnionPopulation({ overlay, audit, exactUnionModeEffective }) {
  requireContract(overlay?.receipt?.status === 'complete', 'validated overlay is required for population audit');
  requireContract(audit?.ok === true || Array.isArray(audit?.stableNativeCellIds), 'live population audit is missing');
  const stableNativeCellIdSha256 = audit.stableNativeCellIdSha256;
  const admissionIndexSha256 = overlay.manifest.source.state.admissionIndexSha256;
  const stableNativeCellIds = audit.stableNativeCellIds || [];
  let lookupMissCount = 0;
  let matchedLookupCount = 0;
  for (const nativeCellId of stableNativeCellIds) {
    const rowPlusOne = overlay.denseLookup[nativeCellId] || 0;
    if (rowPlusOne === 0) lookupMissCount += 1;
    else matchedLookupCount += 1;
  }
  const lookupExtraCount = overlay.receipt.lookupPopulation - matchedLookupCount;
  const failures = [];
  if (!exactUnionModeEffective) failures.push('exact-live-union-mode-not-effective');
  if (stableNativeCellIdSha256 !== admissionIndexSha256) {
    failures.push(`stable-native-cell-sha256-mismatch:${stableNativeCellIdSha256}:${admissionIndexSha256}`);
  }
  if (audit.overflowCount !== 0 || audit.candidateCount !== audit.instanceCount) {
    failures.push(`partial-live-union-population:${audit.candidateCount}:${audit.instanceCount}:${audit.overflowCount}`);
  }
  if (audit.instanceCount !== overlay.receipt.admittedRowCount) {
    failures.push(`admitted-row-count-mismatch:${audit.instanceCount}:${overlay.receipt.admittedRowCount}`);
  }
  if (lookupMissCount !== 0) failures.push(`lookup-misses:${lookupMissCount}`);
  if (lookupExtraCount !== 0) failures.push(`lookup-extras:${lookupExtraCount}`);
  return {
    identity: 'layer-coefficient-live-union-population-audit-v0',
    status: failures.length === 0 ? 'effective' : 'failed',
    stableNativeCellIdSha256,
    admissionIndexSha256,
    candidateCount: audit.candidateCount,
    instanceCount: audit.instanceCount,
    overflowCount: audit.overflowCount,
    admittedRowCount: overlay.receipt.admittedRowCount,
    lookupPopulation: overlay.receipt.lookupPopulation,
    lookupMissCount,
    lookupExtraCount,
    failures,
  };
}

export function createLayerCoefficientLiveUnionGpuResources({ device, overlay }) {
  requireContract(device?.queue && typeof device.createBuffer === 'function' && typeof device.queue.writeBuffer === 'function', 'WebGPU device is invalid');
  requireContract(overlay?.receipt?.status === 'complete' && overlay.receipt.authority === LOADER_AUTHORITY, 'validated overlay load receipt is required');
  requireContract(globalThis.GPUBufferUsage, 'GPUBufferUsage is unavailable');
  const coefficientBuffer = device.createBuffer({
    label: `kaminos live-union coefficients ${overlay.receipt.overlayIdentity}`,
    size: overlay.coefficients.byteLength,
    usage: globalThis.GPUBufferUsage.STORAGE | globalThis.GPUBufferUsage.COPY_DST,
  });
  const lookupBuffer = device.createBuffer({
    label: `kaminos live-union coefficient lookup ${overlay.receipt.overlayIdentity}`,
    size: overlay.denseLookup.byteLength,
    usage: globalThis.GPUBufferUsage.STORAGE | globalThis.GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(coefficientBuffer, 0, overlay.coefficients);
  device.queue.writeBuffer(lookupBuffer, 0, overlay.denseLookup);
  return {
    coefficientBuffer,
    lookupBuffer,
    receipt: {
      identity: 'layer-coefficient-live-union-gpu-resources-v0',
      status: 'complete',
      authority: LOADER_AUTHORITY,
      overlayIdentity: overlay.receipt.overlayIdentity,
      coefficientBufferBytes: overlay.coefficients.byteLength,
      lookupBufferBytes: overlay.denseLookup.byteLength,
      admittedRowCount: overlay.receipt.admittedRowCount,
      lookupMissCount: overlay.receipt.lookupMissCount,
    },
  };
}
