import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const corePath = join(root, 'lerms-finger-juice-core.js');
const pagePath = join(root, 'lerms-finger-juice.html');
const witnessPath = join(root, 'lerms-finger-juice-witness.mjs');

assert.ok(existsSync(corePath), 'world finger-juice core module exists');
assert.ok(existsSync(pagePath), 'world finger-juice prototype page exists');
assert.ok(existsSync(witnessPath), 'world finger-juice route witness exists');

const coreSource = readFileSync(corePath, 'utf8');
const pageSource = readFileSync(pagePath, 'utf8');
const witnessSource = readFileSync(witnessPath, 'utf8');

assert.match(coreSource, /LERMS_WORLD_FINGER_JUICE_EMITTERS_SCHEMA\s*=\s*'lerms\.world-finger-juice-emitters\.v0'/, 'emitter packet schema is explicit');
assert.match(coreSource, /LERMS_WORLD_FINGER_JUICE_ROUTE\s*=\s*'world-space-ballistic-surface-flow-particles-v0'/, 'transport route identity is explicit');
assert.match(coreSource, /LERMS_WORLD_FINGER_JUICE_TERRAIN_CONTRACT\s*=\s*'hill-of-hills-heightfield-collision-v0'/, 'terrain collision contract is explicit');
assert.match(coreSource, /LERMS_WORLD_FINGER_JUICE_ARC_CONTRACT\s*=\s*'finger-aim-ballistic-arc-range-v0'/, 'ballistic arc contract is explicit');
assert.match(coreSource, /stale_visual_only/, 'normalization preserves stale visual-only authority');
assert.match(coreSource, /origin_world/, 'per-finger packet carries world origin');
assert.match(coreSource, /aim_world/, 'per-finger packet carries world aim');
assert.match(coreSource, /motion_world/, 'per-finger packet carries world motion');
assert.match(coreSource, /surface_flow/, 'particle state records surface-flow phase');
assert.match(coreSource, /lerm_impulse/, 'particle hit records lerm impulse events');
assert.match(coreSource, /goin_impulse/, 'particle hit records goin impulse events');
assert.match(coreSource, /terrain_frame/, 'debug state records terrain frame identity');
assert.match(coreSource, /export function normalizeWorldFingerJuiceEmitterPacket/, 'core exports packet normalizer');
assert.match(coreSource, /export function createWorldFingerJuiceTransportPrototype/, 'core exports deterministic transport prototype');

assert.match(pageSource, /lerms_world_finger_juice=1/, 'prototype page declares its smoke route query');
assert.match(pageSource, /window\.__lermsFingerJuiceDebug/, 'prototype exposes route debug state for witnesses');
assert.match(pageSource, /world-space-ballistic-surface-flow-particles-v0/, 'prototype page displays effective route identity');
assert.match(pageSource, /hill-of-hills-heightfield-collision-v0/, 'prototype page displays terrain contract');

assert.match(witnessSource, /lerms_world_finger_juice=1/, 'witness captures the explicit LERMS finger-juice route');
assert.match(witnessSource, /effectiveRoute/, 'witness records effective route identity');
assert.match(witnessSource, /world-space-ballistic-surface-flow-particles-v0/, 'witness requires the world-space transport route');
assert.match(witnessSource, /primary_output_written/, 'witness records primary output durability');
assert.match(witnessSource, /failure_phase/, 'witness records failure phase before throwing');

const mod = await import(corePath);
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_EMITTERS_SCHEMA, 'lerms.world-finger-juice-emitters.v0');
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_ROUTE, 'world-space-ballistic-surface-flow-particles-v0');
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_TERRAIN_CONTRACT, 'hill-of-hills-heightfield-collision-v0');
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_ARC_CONTRACT, 'finger-aim-ballistic-arc-range-v0');

const packet = mod.normalizeWorldFingerJuiceEmitterPacket({
  source_backend: 'perceptasia.synthetic-hand-route',
  sample_age_ms: 24,
  terrain_frame: { id: 'palm-daddy-rounded-channel', units: 'normalized_world' },
  emitters: [
    {
      id: 'index',
      tip_index: 8,
      origin_world: [0, 0.38, -0.82],
      aim_world: [0.18, 0.48, 1.0],
      motion_world: [0.08, 0, 0.12],
      extension: 0.95,
      chemistry: 'knockback',
      radius: 0.044,
      strength: 1.25,
      active: true,
    },
    {
      id: 'middle',
      tip_index: 12,
      origin_world: [0.12, 0.35, -0.78],
      aim_world: [0, 0.22, 1.0],
      extension: 0.45,
      chemistry: 'pooling',
      active: true,
    },
  ],
});

assert.equal(packet.schema, 'lerms.world-finger-juice-emitters.v0');
assert.equal(packet.active_emitter_count, 2);
assert.equal(packet.authority.stale_visual_only, false);
assert.equal(packet.emitters[0].id, 'index');
assert.ok(Math.abs(packet.emitters[0].aim_world.y - 0.427) < 0.002, 'world aim is normalized with upward arc intact');
assert.equal(packet.emitters[1].chemistry, 'pooling');
assert.equal(packet.terrain_frame.id, 'palm-daddy-rounded-channel');

const prototype = mod.createWorldFingerJuiceTransportPrototype({ maxParticles: 64, seed: 7 });
prototype.setEmitters(packet);
const afterSpawn = prototype.step(1 / 30);
assert.equal(afterSpawn.effectiveRoute, 'world-space-ballistic-surface-flow-particles-v0');
assert.equal(afterSpawn.emitterSchema, 'lerms.world-finger-juice-emitters.v0');
assert.equal(afterSpawn.arcContract, 'finger-aim-ballistic-arc-range-v0');
assert.equal(afterSpawn.terrainContract, 'hill-of-hills-heightfield-collision-v0');
assert.ok(afterSpawn.particleCount > 0, 'active world emitters spawn particles');
assert.ok(afterSpawn.airborneCount > 0, 'first step preserves ballistic airborne particles');

for (let i = 0; i < 75; i += 1) {
  prototype.step(1 / 60);
}
const settled = prototype.debugState();
assert.ok(settled.surfaceFlowCount > 0, 'particles collide with heightfield and enter surface flow');
assert.ok(settled.poolingCount > 0, 'surface-flow particles can pool on the terrain');
assert.ok(settled.maxRangeZ > 0.25, 'ballistic arc produces forward range');
assert.ok(settled.heightfieldSamples.length >= 5, 'debug state records heightfield samples');

const hitPrototype = mod.createWorldFingerJuiceTransportPrototype({
  maxParticles: 64,
  seed: 3,
  lerms: [{ id: 'red-lerm-1', position: [0.11, 0.1, -0.13], radius: 0.18, mass: 1.4 }],
  goins: [{ id: 'goin-1', position: [0.22, 0.1, -0.08], radius: 0.14, mass: 2 }],
});
hitPrototype.setEmitters(packet);
for (let i = 0; i < 90; i += 1) {
  hitPrototype.step(1 / 60);
}
const hitState = hitPrototype.debugState();
assert.ok(hitState.lermImpulseCount > 0, 'world particles apply lerm impulses');
assert.ok(hitState.goinImpulseCount > 0, 'world particles apply goin impulses');
