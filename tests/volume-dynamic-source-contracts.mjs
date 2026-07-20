import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = join(root, 'volume-dynamic-source-contract.mjs');
assert.ok(existsSync(contractPath), 'shared dynamic volume source ABI module is missing');

const {
  DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY,
  DYNAMIC_VOLUME_SOURCE_COORDINATE_SPACE,
  DYNAMIC_VOLUME_SOURCE_SCHEMA,
  legacyExternalEmittersToDynamicSourceFrame,
  normalizeDynamicVolumeSourceFrame,
} = await import(pathToFileURL(contractPath));

assert.equal(DYNAMIC_VOLUME_SOURCE_SCHEMA, 'kaminos.volume.dynamic-sources.v0');
assert.equal(DYNAMIC_VOLUME_SOURCE_CONTRACT_IDENTITY, 'kaminos-dynamic-volume-source-runtime-v0');
assert.equal(DYNAMIC_VOLUME_SOURCE_COORDINATE_SPACE, 'volume-local-normalized-cube-v0');

const frame = normalizeDynamicVolumeSourceFrame({
  schema: DYNAMIC_VOLUME_SOURCE_SCHEMA,
  coordinateSpace: DYNAMIC_VOLUME_SOURCE_COORDINATE_SPACE,
  producerIdentity: 'scene-host-test-v0',
  frameId: 17,
  timestampMs: 950,
  sources: [
    {
      id: 'contact-sphere',
      ownerObjectId: 'torch-head',
      shape: 'sphere',
      transform: { position: [0.2, -0.5, 0.1], rotation: [0, 0, 0], scale: [1, 1, 1] },
      geometry: { radius: 0.08 },
      channels: {
        strength: 1.2,
        smoke: 0.35,
        heat: 1.4,
        fuel: 0.8,
        flame: 1.6,
        detail: 0.7,
        velocity: [0.1, 0.9, -0.1],
        lifetime: 0.4,
      },
    },
    {
      id: 'spreading-capsule',
      ownerObjectId: 'burning-beam',
      shape: 'capsule',
      transform: { position: [-0.25, -0.3, 0], rotation: [0, 0, Math.PI / 2], scale: [1, 1, 1] },
      geometry: { start: [-0.2, 0, 0], end: [0.2, 0, 0], radius: 0.04 },
      channels: {
        strength: 1,
        smoke: 0.8,
        heat: 1.1,
        fuel: 0.5,
        flame: 1.2,
        detail: 0.6,
        velocity: [0, 0.5, 0],
        lifetime: 0.5,
      },
    },
  ],
}, { nowMs: 1000 });

assert.equal(frame.receipt.requestedSourceCount, 2);
assert.equal(frame.receipt.effectiveSourceCount, 2);
assert.deepEqual(frame.receipt.sourceIds, ['contact-sphere', 'spreading-capsule']);
assert.deepEqual(frame.receipt.ownerObjectIds, ['torch-head', 'burning-beam']);
assert.deepEqual(frame.receipt.effectiveShapes, ['sphere', 'capsule']);
assert.equal(frame.receipt.sourceAgeMs, 50);
assert.equal(frame.externalEmitterPayload.emitters.length, 2);
assert.deepEqual(frame.externalEmitterPayload.emitters[0].start, [0.2, -0.5, 0.1]);
assert.deepEqual(frame.externalEmitterPayload.emitters[0].end, [0.2, -0.5, 0.1]);
assert.ok(Math.abs(frame.externalEmitterPayload.emitters[1].start[0] + 0.25) < 1e-12);
assert.ok(Math.abs(frame.externalEmitterPayload.emitters[1].start[1] + 0.5) < 1e-12);
assert.ok(Math.abs(frame.externalEmitterPayload.emitters[1].end[1] + 0.1) < 1e-12);
assert.deepEqual(frame.externalEmitterPayload.emitters[1].velocity, [0, 0.5, 0]);
assert.deepEqual(frame.receipt.appliedChannels, [
  'strength', 'smoke', 'heat', 'fuel', 'flame', 'detail', 'velocity', 'lifetime-snapshot-fade',
]);

const base = {
  schema: DYNAMIC_VOLUME_SOURCE_SCHEMA,
  coordinateSpace: DYNAMIC_VOLUME_SOURCE_COORDINATE_SPACE,
  producerIdentity: 'scene-host-test-v0',
  timestampMs: 1000,
  frameId: 1,
  sources: [frame.sources[0]],
};
assert.throws(
  () => normalizeDynamicVolumeSourceFrame({ ...base, coordinateSpace: 'world' }, { nowMs: 1000 }),
  /unsupported-coordinate-space:world/,
);
assert.throws(
  () => normalizeDynamicVolumeSourceFrame({ ...base, sources: [{
    ...frame.sources[0],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 1] },
  }] }, { nowMs: 1000 }),
  /nonuniform-scale-unsupported/,
);
assert.throws(
  () => normalizeDynamicVolumeSourceFrame({ ...base, sources: [{ ...frame.sources[0], shape: 'mesh' }] }, { nowMs: 1000 }),
  /unsupported-shape:mesh/,
);
assert.throws(
  () => normalizeDynamicVolumeSourceFrame({ ...base, sources: [{ ...frame.sources[0], ownerObjectId: '' }] }, { nowMs: 1000 }),
  /owner-object-id-required/,
);
assert.throws(
  () => normalizeDynamicVolumeSourceFrame({ ...base, sources: [frame.sources[0], frame.sources[0]] }, { nowMs: 1000 }),
  /duplicate-source-id:contact-sphere/,
);
assert.throws(
  () => normalizeDynamicVolumeSourceFrame({ ...base, sources: Array.from({ length: 33 }, (_, index) => ({
    ...frame.sources[0],
    id: `source-${index}`,
    ownerObjectId: `object-${index}`,
  })) }, { nowMs: 1000 }),
  /source-count-exceeds-runtime-capacity:33:supported=32/,
);

const legacyPointFrame = normalizeDynamicVolumeSourceFrame(
  legacyExternalEmittersToDynamicSourceFrame({
    frameId: 8,
    timestampMs: 1000,
    emitters: [{
      start: [0.3, -0.4, 0.2],
      end: [0.3, -0.4, 0.2],
      radius: 0.05,
    }],
  }, { nowMs: 1000 }),
  { nowMs: 1000 },
);
assert.deepEqual(
  legacyPointFrame.externalEmitterPayload.emitters[0].start,
  [0.3, -0.4, 0.2],
  'the shared ABI adapter preserves a legacy point emitter position',
);
assert.equal(legacyPointFrame.receipt.effectiveMode, 'external');
assert.equal(legacyPointFrame.receipt.effectiveProducerIdentity, 'legacy-external-emitter-adapter-v0');
assert.equal(legacyPointFrame.receipt.expiryAuthority, 'producer-refresh-or-empty-frame-v0');

const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const index = readFileSync(join(root, 'index.html'), 'utf8');
const witness = readFileSync(join(root, 'volume-primitive-product-witness.mjs'), 'utf8');
assert.match(core, /setDynamicVolumeSources\(payload\s*=\s*\{\}\)/, 'runtime exposes the shared dynamic source ABI');
assert.match(core, /setExternalEmitters\(payload\s*=\s*\{\}\)[\s\S]*applyDynamicVolumeSources/, 'legacy emitters converge through the shared ABI implementation');
assert.match(core, /fluidStateResetApplied:\s*state\.fluidStateResetCount !== resetCountBefore/, 'dynamic source updates derive reset truth from the runtime counter');
assert.match(index, /window\.kaminosSetVolumeDynamicSources/, 'the host exposes the shared scene-owned source call');
assert.match(index, /volumeDynamicSourceHostAuthority\s*=\s*'external-host'/, 'external host submission takes authority from the cockpit animator');
assert.match(index, /volume-primitive-product-motion'\)\.checked = false/, 'external host authority disables demo motion explicitly');
assert.match(index, /ownerObjectId/, 'the host interaction surface binds the source to a scene object identity');
assert.match(index, /setDynamicVolumeSources/, 'the product panel drives the dynamic ABI rather than the persisted fixture setter');
assert.doesNotMatch(index, /Live sphere/, 'the product panel does not mislabel the shared ABI as a sphere fixture');
assert.match(index, /id="volume-full-support-optics-panel"/, 'optical controls expose an explicit route-scoping identity');
assert.match(index, /fullSupportPanel\.hidden = volumeDynamicSourceProductEnabled/, 'dynamic source routes hide unrelated optical treatment controls');
assert.match(witness, /litPixelFraction/, 'the visual witness rejects blank output');
assert.match(witness, /changedPixelFraction/, 'the visual witness measures a visible dynamic-source response');
assert.match(witness, /effectiveSourceCount/, 'the visual witness checks the effective shared ABI receipt');
assert.match(witness, /immediate-storage-buffer-write/, 'the visual witness rejects deferred GPU application');
assert.match(witness, /WebGPU:/, 'the visual witness rejects non-WebGPU fallback');

console.log('volume dynamic source contracts passed');
