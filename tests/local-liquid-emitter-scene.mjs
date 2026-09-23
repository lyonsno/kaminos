import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildSceneDocument, isReloadableSceneObjectRecord, planSceneRestore} from '../scene-persistence-core.js';
import {defaultLocalLiquidSetup, localLiquidInletPacket} from '../local-liquid-setup.mjs';
import {normalizeFingerFluidLiveInletPacket,planFingerFluidLiveInletEconomics} from '../finger-fluid-webgpu-core.js';

const emitter = (id, position, rate = 900) => ({
  id,
  source: 'kaminos:local-liquid-emitter',
  type: 'local-liquid-emitter',
  fileName: 'Water emitter',
  label: id,
  transform: {position, rotation: [0, 0, 0], scale: [1, 1, 1]},
  localLiquidEmitter: {schema: 'kaminos.local-liquid-emitter.v1', baseRadius: .08, strength: 1.15, rate},
});

test('water emitter identity, pose and authored controls round-trip as scene objects', () => {
  const setup = defaultLocalLiquidSetup();
  assert.equal(setup.schema, 'kaminos.local-liquid-setup.v1');
  assert.equal(Object.hasOwn(setup, 'source'), false, 'source pose and controls belong to scene objects');

  const source = emitter('water-emitter-a', [-.35, .4, -1.65]);
  const saved = buildSceneDocument({objects: [source], activeObjectId: source.id, localLiquid: setup});
  assert.equal(isReloadableSceneObjectRecord(source), true, 'built-in water emitters reload without an external mesh');
  assert.deepEqual(saved.objects[0].localLiquidEmitter, source.localLiquidEmitter);
  const restored = planSceneRestore(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.activeObjectId, source.id);
  assert.deepEqual(restored.objects[0].transform, source.transform);
  assert.deepEqual(restored.objects[0].localLiquidEmitter, source.localLiquidEmitter);
});

test('legacy coordinate-source setup migrates into one authored water-emitter object', () => {
  const legacy = {schema: 'kaminos.local-liquid-setup.v0', support: 'retained_analytical_basin',
    particleCount: 49152, densityIterations: 3,
    source: {x: -.35, y: .4, z: -1.65, radius: .08, strength: 1.15, rate: 1200}};
  const saved = buildSceneDocument({localLiquid: legacy});
  assert.equal(Object.hasOwn(saved.localLiquid, 'source'), false, 'new saves must not preserve duplicate coordinate controls');
  assert.equal(saved.objects.length, 1);
  assert.equal(saved.objects[0].type, 'local-liquid-emitter');
  assert.deepEqual(saved.objects[0].transform.position, [-.35, .4, -1.65]);
  assert.deepEqual(saved.objects[0].localLiquidEmitter, {
    schema: 'kaminos.local-liquid-emitter.v1', baseRadius: .08, strength: 1.15, rate: 1200,
  });
});

test('every placed emitter contributes its object transform and settings to the retained inlet packet', () => {
  const setup = defaultLocalLiquidSetup();
  const first = emitter('water-a', [-.35, .4, -1.65], 800);
  const second = emitter('water-b', [.45, .5, -.8], 450);
  second.transform.rotation = [Math.PI / 2, 0, 0];
  second.transform.scale = [1.25, 1.25, 1.25];
  const packet = localLiquidInletPacket(setup, [first, second], 7);
  assert.deepEqual(packet.emitters.map(item => item.id), ['water-a', 'water-b']);
  assert.deepEqual(packet.emitters.map(item => item.origin_world), [[-.35, .4, -1.65], [.45, .5, -.8]]);
  assert.deepEqual(packet.emitters.map(item => item.source_flux_particles_per_second), [800, 450]);
  const effective = normalizeFingerFluidLiveInletPacket(packet);
  assert.equal(effective.requestedActiveInletCount, 2);
  assert.deepEqual(effective.inlets.filter(item => item.active).map(item => item.id), ['water-a', 'water-b']);
  assert.ok(Math.abs(effective.inlets[1].radius - .1) < 1e-12, 'uniform scene scale sets aperture');
});

test('multiple active scene emitters share the existing particle pool instead of duplicating it', () => {
  const setup = defaultLocalLiquidSetup();
  const packet = localLiquidInletPacket(setup, [
    emitter('water-a', [-.35, .4, -1.65], 800),
    emitter('water-b', [.45, .5, -.8], 450),
  ], 9);
  const economics = planFingerFluidLiveInletEconomics(packet, setup.particleCount);
  const active = economics.inlets.filter(item => item.active);
  assert.deepEqual(active.map(item => item.effective.releasePoolBudget), [24576, 24576]);
  assert.equal(economics.effectiveReleasePoolBudget, setup.particleCount);
});

test('scene cannot exceed the retained solver inlet capacity or orphan a water emitter from its basin setup', () => {
  const setup = defaultLocalLiquidSetup();
  const six = Array.from({length: 6}, (_, index) => emitter(`water-${index}`, [index, .4, -1]));
  assert.throws(() => localLiquidInletPacket(setup, six, 8), /capacity 5/);
  assert.throws(() => planSceneRestore(buildSceneDocument({objects: [emitter('orphan', [0, 0, 0])]})), /local liquid setup/);
});
