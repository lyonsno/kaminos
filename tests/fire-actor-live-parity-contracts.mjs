import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const contractPath = join(root, 'fire-actor-live-parity-contract.mjs');
assert.ok(existsSync(contractPath), 'shared promoted-fire live parity contract must exist');

const {
  FIRE_ACTOR_LIVE_PARITY_ARMS,
  createFireActorLiveParityDescriptor,
  validateFireActorLiveParityReceipt,
} = await import('../fire-actor-live-parity-contract.mjs');

assert.deepEqual(FIRE_ACTOR_LIVE_PARITY_ARMS, ['splats', 'smoke', 'composite']);
const descriptor = await createFireActorLiveParityDescriptor();
assert.equal(descriptor.schema, 'kaminos.fire-actor-live-parity-descriptor.v1');
assert.match(descriptor.descriptorId, /^fireparity-[a-f0-9]{64}$/);
assert.equal(descriptor.basin.revision, 'basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95');
assert.equal(descriptor.engine.sha256, 'c7062f944a1153be5bf5a1cf2167a2bf80b57a14e9025389d76beebd0dc016f0');
assert.equal(descriptor.state.targetSimStep, 120);
assert.equal(descriptor.state.pauseAuthority, 'renderer-internal-exact-sim-step-pause-gpu-complete-v0');
assert.deepEqual(descriptor.camera.position, [1.65, 0.42, 3.15]);
assert.deepEqual(descriptor.camera.target, [0, 0.08, 0]);
assert.deepEqual(descriptor.actor.transform, { translate: [0, 0, 0], scale: 1 });

const receipt = {
  schema: 'kaminos.fire-actor-live-parity-receipt.v1',
  status: 'effective',
  surface: 'cockpit',
  descriptorId: descriptor.descriptorId,
  basin: structuredClone(descriptor.basin),
  engine: structuredClone(descriptor.engine),
  state: {
    requestedSimStep: 120,
    effectiveSimStep: 120,
    paused: true,
    gpuComplete: true,
    pauseAuthority: descriptor.state.pauseAuthority,
    controlsSignature: descriptor.state.controlsSignature,
  },
  camera: structuredClone(descriptor.camera),
  actor: structuredClone(descriptor.actor),
  viewport: { cssWidth: 960, cssHeight: 720, backingWidth: 1920, backingHeight: 1440, dpr: 2 },
  presentation: { arm: 'composite', smoke: 'on', splats: 'on', composition: 'smoke-raymarch-under-splats-v0' },
  controls: { basin: 186, renderer: 3 },
  fallbackReason: null,
};
assert.doesNotThrow(() => validateFireActorLiveParityReceipt(receipt, descriptor));

for (const [name, mutate, pattern] of [
  ['wrong step', value => { value.state.effectiveSimStep = 121; }, /simulation step/],
  ['not paused', value => { value.state.paused = false; }, /GPU-complete pause/],
  ['wrong camera', value => { value.camera.fov = 41; }, /camera/],
  ['wrong actor', value => { value.actor.transform.scale = 1.1; }, /actor/],
  ['fallback', value => { value.fallbackReason = 'ordinary-renderer'; }, /fallback/],
  ['wrong arm', value => { value.presentation.arm = 'beauty'; }, /presentation arm/],
]) {
  const candidate = structuredClone(receipt);
  mutate(candidate);
  assert.throws(() => validateFireActorLiveParityReceipt(candidate, descriptor), pattern, name);
}

const index = readFileSync(join(root, 'index.html'), 'utf8');
const browserContract = readFileSync(join(root, 'fire-actor-live-parity-browser.mjs'), 'utf8');
const volumeCore = readFileSync(join(root, 'volume-core.js'), 'utf8');
assert.match(
  volumeCore,
  /'smoke-raymarch-only-v0'[\s\S]*?raymarch:\s*true,[\s\S]*?splat:\s*false,[\s\S]*?raymarchFireAuthority:\s*0/,
  'smoke-only parity arm must raymarch broad smoke without raymarched or splatted fire',
);
assert.match(index, /window\.kaminosFireActorParity\s*=/, 'cockpit exposes the shared live parity API');
assert.match(browserContract, /pauseAtExactStep/, 'cockpit parity uses exact-step GPU-complete pause');
assert.match(browserContract, /setArm/, 'cockpit parity exposes live presentation arms');
assert.match(browserContract, /applyCamera/, 'cockpit parity accepts exact camera transfer');
assert.match(browserContract, /kaminos-fire-parity-command/, 'cockpit parity accepts workbench postMessage commands');

console.log('promoted fire actor live parity contracts passed');
