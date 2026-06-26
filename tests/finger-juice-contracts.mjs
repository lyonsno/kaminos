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
assert.match(coreSource, /simulation_authority/, 'normalization records whole-packet simulation authority');
assert.match(coreSource, /hand_sample_space/, 'packet records source hand sample space');
assert.match(coreSource, /lerms_world_frame/, 'packet records destination LERMS world frame');
assert.match(coreSource, /world_from_hand_sample/, 'packet records transform identity instead of guessing signs');
assert.match(coreSource, /force_safe/, 'per-emitter authority records force safety');
assert.match(coreSource, /synthetic_fixture/, 'synthetic fixture authority is explicitly labeled');
assert.match(coreSource, /origin_world/, 'per-finger packet carries world origin');
assert.match(coreSource, /aim_world/, 'per-finger packet carries world aim');
assert.match(coreSource, /motion_world/, 'per-finger packet carries world motion');
assert.match(coreSource, /surface_flow/, 'particle state records surface-flow phase');
assert.match(coreSource, /visual_trail/, 'particle state records visual trail samples');
assert.match(coreSource, /source_anchor/, 'trail debug state separates source anchor from recent path');
assert.match(coreSource, /trailSampleCount/, 'debug state records trail sample coverage');
assert.match(coreSource, /surfaceStreakCount/, 'debug state records surface streak coverage');
assert.match(coreSource, /maxTrailSegmentLength/, 'debug state records maximum trail segment length');
assert.match(coreSource, /airborneBreadcrumbCount/, 'debug state records airborne breadcrumb coverage');
assert.match(coreSource, /impactRingCount/, 'debug state records impact/contact ring coverage');
assert.match(coreSource, /surfaceSmearCount/, 'debug state records phase-aware surface smear coverage');
assert.match(coreSource, /velocity_hint/, 'trail debug state carries velocity hints');
assert.match(coreSource, /lerm_impulse/, 'particle hit records lerm impulse events');
assert.match(coreSource, /goin_impulse/, 'particle hit records goin impulse events');
assert.match(coreSource, /terrain_frame/, 'debug state records terrain frame identity');
assert.match(coreSource, /export function normalizeWorldFingerJuiceEmitterPacket/, 'core exports packet normalizer');
assert.match(coreSource, /export function createWorldFingerJuiceTransportPrototype/, 'core exports deterministic transport prototype');

assert.match(pageSource, /lerms_world_finger_juice=1/, 'prototype page declares its smoke route query');
assert.match(pageSource, /window\.__lermsFingerJuiceDebug/, 'prototype exposes route debug state for witnesses');
assert.match(pageSource, /window\.__lermsFingerJuiceStepForWitness/, 'prototype exposes deterministic witness stepping');
assert.match(pageSource, /world-space-ballistic-surface-flow-particles-v0/, 'prototype page displays effective route identity');
assert.match(pageSource, /hill-of-hills-heightfield-collision-v0/, 'prototype page displays terrain contract');
assert.match(pageSource, /drawJuiceTrails/, 'prototype page draws persistent juice trails');
assert.match(pageSource, /source-legible-phase-breadcrumbs-v2/, 'prototype page labels the phase-aware breadcrumb renderer');
assert.match(pageSource, /drawAirborneBreadcrumb/, 'prototype page draws airborne breadcrumb ticks');
assert.match(pageSource, /drawImpactRing/, 'prototype page draws contact/impact rings');
assert.match(pageSource, /drawSurfaceSmear/, 'prototype page draws surface-flow smears');
assert.doesNotMatch(pageSource, /globalCompositeOperation\s*=\s*['"]lighter['"]/, 'trail renderer must not use additive lighter compositing');

assert.match(witnessSource, /lerms_world_finger_juice=1/, 'witness captures the explicit LERMS finger-juice route');
assert.match(witnessSource, /effectiveRoute/, 'witness records effective route identity');
assert.match(witnessSource, /__lermsFingerJuiceStepForWitness/, 'witness advances simulation through explicit route hook');
assert.match(witnessSource, /world-space-ballistic-surface-flow-particles-v0/, 'witness requires the world-space transport route');
assert.match(witnessSource, /trailSampleCount/, 'witness requires trail sample evidence');
assert.match(witnessSource, /trailEmitterCount/, 'witness requires multi-emitter trail evidence');
assert.match(witnessSource, /maxTrailSegmentLength/, 'witness rejects false long trail bridges');
assert.match(witnessSource, /airborneBreadcrumbCount/, 'witness requires airborne breadcrumb evidence');
assert.match(witnessSource, /impactRingCount/, 'witness requires impact/contact ring evidence');
assert.match(witnessSource, /surfaceSmearCount/, 'witness requires surface smear evidence');
assert.match(witnessSource, /primary_output_written/, 'witness records primary output durability');
assert.match(witnessSource, /failure_phase/, 'witness records failure phase before throwing');

const mod = await import(corePath);
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_EMITTERS_SCHEMA, 'lerms.world-finger-juice-emitters.v0');
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_ROUTE, 'world-space-ballistic-surface-flow-particles-v0');
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_TERRAIN_CONTRACT, 'hill-of-hills-heightfield-collision-v0');
assert.equal(mod.LERMS_WORLD_FINGER_JUICE_ARC_CONTRACT, 'finger-aim-ballistic-arc-range-v0');

const packet = mod.normalizeWorldFingerJuiceEmitterPacket({
  packet_id: 'test-live-packet-1',
  source_route: 'perceptasia-finger-fluid-swarm',
  source_backend: 'perceptasia.synthetic-hand-route',
  source_frame_id: 'perceptasia-swarm-world-v0',
  sidecar_sequence: 42,
  evidence_kind: 'synthetic_fixture',
  sample_age_ms: 24,
  simulation_authority: 'synthetic_fixture',
  hand_sample_space: {
    id: 'perceptasia.hand-sample-space.v0',
    handedness: 'right',
    screen_x: 'operator_unmirrored',
  },
  lerms_world_frame: {
    id: 'palm-daddy-rounded-channel',
    units: 'normalized_world',
    projection_contract: 'sampled_triangle_mesh_rounded_channel_manifold_v0',
    world_from_hand_sample: 'synthetic-fixture-transform-v0',
  },
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
      authority: { valid: true, stale: false, confidence: 0.93, force_safe: true },
      active: true,
    },
    {
      id: 'middle',
      tip_index: 12,
      origin_world: [0.12, 0.35, -0.78],
      aim_world: [0, 0.22, 1.0],
      extension: 0.45,
      chemistry: 'pooling',
      authority: { valid: true, stale: false, confidence: 0.82, force_safe: true },
      active: true,
    },
  ],
});

assert.equal(packet.schema, 'lerms.world-finger-juice-emitters.v0');
assert.equal(packet.packet_id, 'test-live-packet-1');
assert.equal(packet.source_route, 'perceptasia-finger-fluid-swarm');
assert.equal(packet.source_frame_id, 'perceptasia-swarm-world-v0');
assert.equal(packet.sidecar_sequence, 42);
assert.equal(packet.evidence_kind, 'synthetic_fixture');
assert.equal(packet.simulation_authority, 'synthetic_fixture');
assert.equal(packet.authority.simulation_safe, true);
assert.equal(packet.hand_sample_space.screen_x, 'operator_unmirrored');
assert.equal(packet.lerms_world_frame.world_from_hand_sample, 'synthetic-fixture-transform-v0');
assert.equal(packet.active_emitter_count, 2);
assert.equal(packet.authority.stale_visual_only, false);
assert.equal(packet.emitters[0].id, 'index');
assert.equal(packet.emitters[0].authority.force_safe, true);
assert.equal(packet.emitters[0].origin_screen, null);
assert.equal(packet.emitters[0].aim_screen, null);
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
assert.ok(settled.trailSampleCount >= 96, 'late state retains enough trail samples to show motion');
assert.ok(settled.trailEmitterCount >= 2, 'late state preserves multiple emitter trail identities');
assert.ok(settled.surfaceStreakCount > 0, 'late state exposes surface-flow streak evidence');
assert.ok(settled.trailSpanZ > 0.35, 'late trails preserve forward travel span');
assert.ok(settled.sourceAnchorCount >= 2, 'late state preserves separate source anchors');
assert.ok(settled.maxTrailSegmentLength < 0.34, 'late state does not draw false long trail bridges');
assert.ok(settled.airborneBreadcrumbCount > 0, 'late state preserves airborne breadcrumb evidence');
assert.ok(settled.impactRingCount > 0, 'late state preserves contact/impact ring evidence');
assert.ok(settled.surfaceSmearCount > 0, 'late state preserves phase-aware surface smear evidence');
assert.ok(settled.trails.some(trail => trail.samples.some(sample => Array.isArray(sample.velocity_hint))), 'trail samples carry velocity hints');
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

for (const simulation_authority of ['visual_only', 'stale_hold', 'invalid']) {
  const unsafe = mod.normalizeWorldFingerJuiceEmitterPacket({
    simulation_authority,
    source_route: 'perceptasia-finger-fluid-swarm',
    source_backend: 'perceptasia.synthetic-hand-route',
    source_frame_id: 'perceptasia-swarm-world-v0',
    evidence_kind: simulation_authority,
    hand_sample_space: { id: 'perceptasia.hand-sample-space.v0' },
    lerms_world_frame: {
      id: 'palm-daddy-rounded-channel',
      units: 'normalized_world',
      world_from_hand_sample: 'visual-only-transform-v0',
    },
    emitters: [{
      id: 'index',
      origin_world: [0, 0.38, -0.82],
      aim_world: [0.18, 0.48, 1.0],
      extension: 0.95,
      chemistry: 'knockback',
      authority: { valid: true, stale: simulation_authority !== 'visual_only', confidence: 0.9, force_safe: true },
      active: true,
    }],
  });
  assert.equal(unsafe.authority.simulation_safe, false, `${simulation_authority} packet must not be simulation-safe`);
  assert.equal(unsafe.emitters[0].active, false, `${simulation_authority} emitter must not apply force`);
  assert.equal(unsafe.emitters[0].authority.render_safe, true, `${simulation_authority} emitter can remain render/debug safe`);
  const unsafePrototype = mod.createWorldFingerJuiceTransportPrototype({
    maxParticles: 64,
    seed: 5,
    lerms: [{ id: 'red-lerm-unsafe', position: [0.11, 0.1, -0.13], radius: 0.18 }],
  });
  unsafePrototype.setEmitters(unsafe);
  for (let i = 0; i < 90; i += 1) {
    unsafePrototype.step(1 / 60);
  }
  const unsafeState = unsafePrototype.debugState();
  assert.equal(unsafeState.particleCount, 0, `${simulation_authority} packet must not spawn particles`);
  assert.equal(unsafeState.lermImpulseCount, 0, `${simulation_authority} packet must not apply lerm force`);
}

const missingFrame = mod.normalizeWorldFingerJuiceEmitterPacket({
  simulation_authority: 'live_simulation',
  source_backend: 'perceptasia.synthetic-hand-route',
  emitters: [{
    id: 'index',
    origin_world: [0, 0.38, -0.82],
    aim_world: [0.18, 0.48, 1.0],
    extension: 0.95,
    authority: { valid: true, stale: false, confidence: 0.9, force_safe: true },
    active: true,
  }],
});
assert.equal(missingFrame.simulation_authority, 'invalid');
assert.equal(missingFrame.authority.simulation_safe, false);
assert.match(missingFrame.authority.reason, /missing.*frame/i);
