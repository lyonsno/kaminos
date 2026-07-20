import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const packageRoot = new URL('../artifacts/motion-ready-lirm03-4203/', import.meta.url);
const manifestUrl = new URL(
  '../artifacts/species-asset-contract-v0/motion-ready-lirm03-4203.json',
  import.meta.url,
);

function readGlbPositionAccessor(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'fixture must be a glTF binary');
  let offset = 12;
  let gltf;
  let binary;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) gltf = JSON.parse(payload.toString('utf8').trim());
    if (type === 0x004e4942) binary = payload;
    offset += 8 + length;
  }
  const accessor = gltf?.accessors?.[gltf?.meshes?.[0]?.primitives?.[0]?.attributes?.POSITION];
  const view = gltf?.bufferViews?.[accessor?.bufferView];
  assert.equal(accessor?.componentType, 5126, 'fixture positions must be float32');
  assert.equal(accessor?.type, 'VEC3', 'fixture positions must be packed vec3 values');
  assert.ok(binary && view, 'fixture must expose one readable binary position accessor');
  const stride = view.byteStride || 12;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const positions = new Float32Array(accessor.count * 3);
  for (let vertex = 0; vertex < accessor.count; vertex++) {
    const source = start + vertex * stride;
    positions[vertex * 3] = binary.readFloatLE(source);
    positions[vertex * 3 + 1] = binary.readFloatLE(source + 4);
    positions[vertex * 3 + 2] = binary.readFloatLE(source + 8);
  }
  return positions;
}

const registration = JSON.parse(await readFile(new URL('registration.json', packageRoot), 'utf8'));
const receipt = JSON.parse(await readFile(new URL('receipt.json', packageRoot), 'utf8'));
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

assert.equal(registration.schema, 'kaminos.axial-crawler-registration.v0');
assert.equal(registration.asset, 'creature.glb');
assert.deepEqual(registration.localForwardAxis, [0, 0, -1]);
assert.deepEqual(registration.localUpAxis, [0, 1, 0]);
assert.equal(registration.contactPlaneY, -0.15831834077835083);
assert.deepEqual(registration.headAnchor, [0, 0, -0.47]);
assert.deepEqual(registration.tailAnchor, [0, 0, 0.47]);
assert.equal(registration.spineStations.length, 7);
assert.ok(registration.spineStations.every((station, index, stations) =>
  index === 0 || station.localPosition[2] < stations[index - 1].localPosition[2]));

assert.equal(receipt.schema, 'kaminos.motion-ready-cast-receipt.v0');
assert.equal(receipt.castId, 'motion-ready-lirm03-4203');
assert.equal(receipt.sourceImage.seed, 4203);
assert.equal(receipt.effectiveRoute.generator, 'trellis2mlx');
assert.equal(receipt.effectiveRoute.seed, 42);
assert.equal(receipt.effectiveRoute.steps, 4);
assert.equal(receipt.effectiveRoute.durationSeconds, 65.6);
assert.equal(receipt.mesh.vertices, 153090);
assert.equal(receipt.mesh.postCleanupFaces, 129804);
assert.deepEqual(receipt.files, {
  'creature.glb': {
    bytes: 8886968,
    sha256: '31036e3e2eea85a14b8921daba67c27779d2a31a4ae61301edc25703817c4ea3',
  },
  'registration.json': {
    bytes: 1912,
    sha256: 'c07e0580fd2076fc68f426fba28370fc27d496ca23eb8228ca7b3047c59c18fe',
  },
  'source.png': {
    bytes: 235245,
    sha256: '0f0cc9dbebd384b437a07001236f917b762804732121d5a8295dbd3e0e502eec',
  },
});

assert.equal(manifest.schema, 'kaminos.species-asset.v0');
assert.equal(manifest.speciesId, 'lirm-crustacean-4203');
assert.equal(
  manifest.packageRef,
  'kaminos:cc/molten-silhouette-basin-0717@3171ec92:artifacts/motion-ready-lirm03-4203/',
);
assert.deepEqual(manifest.asset, {
  path: 'artifacts/motion-ready-lirm03-4203/creature.glb',
  format: 'glTF-2.0-GLB',
  sha256: '31036e3e2eea85a14b8921daba67c27779d2a31a4ae61301edc25703817c4ea3',
  vertices: 153090,
  faces: 129804,
  primitives: 1,
});
assert.deepEqual(manifest.registration, {
  path: 'artifacts/motion-ready-lirm03-4203/registration.json',
  schema: 'kaminos.axial-crawler-registration.v0',
  sha256: 'c07e0580fd2076fc68f426fba28370fc27d496ca23eb8228ca7b3047c59c18fe',
});
assert.deepEqual(manifest.coordinates, {
  handedness: 'right',
  up: [0, 1, 0],
  forward: [0, 0, -1],
  right: [1, 0, 0],
  unit: 'meter',
});
assert.deepEqual(manifest.bounds, {
  min: [-0.2313016653060913, -0.15831834077835083, -0.5001913905143738],
  max: [0.26317015290260315, 0.18766506016254425, 0.49993234872817993],
  width: 0.49447181820869446,
  authoredHeight: 0.3459834009408951,
  bodyLength: 1.0001237392425537,
});
assert.deepEqual(manifest.bounds.min, registration.bounds.min);
assert.deepEqual(manifest.bounds.max, registration.bounds.max);
assert.equal(manifest.root.kind, 'terrain-contact-root');
assert.equal(manifest.root.localPoint[1], manifest.bounds.min[1]);
assert.deepEqual(manifest.root.localToRootTranslation, manifest.root.localPoint.map(value => -value));
assert.equal(manifest.deformation.mode, 'axial-parallel-transport-wave-v1');
assert.equal(manifest.deformation.endpointResidual.mode, 'preserve-signed-axial-residual');
assert.equal(manifest.deformation.endpointResidual.verticesOutsideStationSpan, 2346);
assert.equal(
  manifest.deformation.referenceImplementation,
  'kaminos:cc/mushfinger-motion-ready-719024-0720@5fd08592:motion-ready-719024-core.js',
);
assert.equal(manifest.deformation.stateCompatibility, 'kaminos.motion-ready-719024.axial-squirm-state.v1');
assert.equal(manifest.deformation.reuseProbe.referenceCommit, '5fd08592');
assert.deepEqual(manifest.deformation.reuseProbe.state, {
  amplitude: 0.07,
  verticalAmplitude: 0.015,
  phase: 1.2,
});
assert.ok(manifest.deformation.reuseProbe.maxZeroStateError < 2e-6);
assert.equal(manifest.deformation.reuseProbe.activeStateFinite, true);
assert.equal(manifest.runtimeGate.maxCreatureInstances, 1);
assert.deepEqual(manifest.runtimeGate.required, [
  'consumer rehashes the distinct package bytes',
  'consumer changes registration data without changing the v1 deformation algorithm',
  'shared color and depth attachments',
  'terrain-root placement from this manifest',
  'one inspected in-place wave preserving attached shell plates and limbs',
]);
assert.deepEqual(manifest.runtimeGate.unclaimed, [
  'route locomotion',
  'generalized autorig',
  'non-axial organism support',
  'multi-LOD production population',
  'burn response',
  'third-species compatibility',
]);

for (const [name, expected] of Object.entries(receipt.files)) {
  const bytes = await readFile(new URL(name, packageRoot));
  assert.equal(bytes.byteLength, expected.bytes, `${name} byte count`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, `${name} checksum`);
}

for (const entry of [manifest.asset, manifest.registration]) {
  const name = entry.path.split('/').at(-1);
  const bytes = await readFile(new URL(name, packageRoot));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
}

const referenceSource = execFileSync(
  'git',
  ['show', `${manifest.deformation.reuseProbe.referenceCommit}:motion-ready-719024-core.js`],
  { encoding: 'utf8' },
);
const reference = await import(`data:text/javascript;base64,${Buffer.from(referenceSource).toString('base64')}`);
const validatedRegistration = reference.validateAxialCrawlerRegistration(registration);
const exactPositions = readGlbPositionAccessor(await readFile(new URL('creature.glb', packageRoot)));
const exactNormals = new Float32Array(exactPositions.length);
const binding = reference.createAxialGeometryBinding(
  exactPositions,
  exactNormals,
  validatedRegistration,
  { segments: 128 },
);
const verticesOutsideStationSpan = binding.axialResiduals.reduce(
  (count, residual) => count + (Math.abs(residual) > 1e-7 ? 1 : 0),
  0,
);
assert.equal(exactPositions.length / 3, manifest.deformation.reuseProbe.vertices);
assert.equal(verticesOutsideStationSpan, manifest.deformation.reuseProbe.verticesOutsideStationSpan);

const zeroPositions = new Float32Array(exactPositions.length);
const zeroNormals = new Float32Array(exactNormals.length);
reference.deformAxialGeometryBinding(
  binding,
  reference.createAxialSquirmState(),
  zeroPositions,
  zeroNormals,
);
let maxZeroStateError = 0;
for (let index = 0; index < exactPositions.length; index++) {
  maxZeroStateError = Math.max(maxZeroStateError, Math.abs(zeroPositions[index] - exactPositions[index]));
}
assert.equal(maxZeroStateError, manifest.deformation.reuseProbe.maxZeroStateError);

const activePositions = new Float32Array(exactPositions.length);
const activeNormals = new Float32Array(exactNormals.length);
reference.deformAxialGeometryBinding(
  binding,
  reference.createAxialSquirmState(manifest.deformation.reuseProbe.state),
  activePositions,
  activeNormals,
);
let maxActiveComponentDelta = 0;
for (let index = 0; index < activePositions.length; index++) {
  assert.ok(Number.isFinite(activePositions[index]), `active position ${index} must be finite`);
  maxActiveComponentDelta = Math.max(
    maxActiveComponentDelta,
    Math.abs(activePositions[index] - exactPositions[index]),
  );
}
assert.ok(
  Math.abs(maxActiveComponentDelta - manifest.deformation.reuseProbe.maxActiveComponentDelta) < 1e-12,
  `active deformation delta ${maxActiveComponentDelta} must match the recorded probe`,
);

console.log('species-asset-lirm03-4203 contracts passed');
