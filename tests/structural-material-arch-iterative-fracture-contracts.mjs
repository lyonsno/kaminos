import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as volume from '../structural-material-arch-volume-view.js';
import * as evidence from '../structural-material-arch-volume-evidence.mjs';
import { advanceArchStructuralForce, buildArchStructuralProxy, fractureArchStructuralProxy } from '../structural-material-arch-core.js';

assert.equal(typeof volume.advanceArchVolumeLoad, 'function',
  'Apply must advance the existing damaged arch through another force interval');
const spring = {
  layers: 3, bounds: { min: [0, 0], max: [1, 1] }, events: [], connectivityEpoch: 0,
  nodes: [
    { x: 0, y: 0, z: 0, column: 0, row: 0, layer: 1, pinned: true, displacement: { x: 0, y: 0, z: 0 } },
    { x: 0, y: 1, z: 0, column: 0, row: 1, layer: 1, pinned: false, displacement: { x: 0, y: 0, z: 0 } },
  ],
  bonds: [{ id: 'spring', a: 0, b: 1, alive: true, rest: 1, direction: [0, 1, 0], stiffness: 1, lastStrain: 0 }],
};
const single = advanceArchStructuralForce(spring, { x: 0, y: 1, force: 0.2 }, { timeStep: 0.1, damping: 2 });
assert.ok(Math.abs(single.nodes[1].displacement.y + 0.2 / 21) < 1e-12,
  'one spring must satisfy (damping/dt + stiffness) u_next = force + damping/dt u_previous');
const nextSingle = advanceArchStructuralForce(single, { x: 0, y: 1, force: 0.2 }, { timeStep: 0.1, damping: 2 });
assert.ok(Math.abs(nextSingle.nodes[1].displacement.y - (-0.2 + 20 * single.nodes[1].displacement.y) / 21) < 1e-12);
const detached = advanceArchStructuralForce({ ...single, bonds: [{ ...single.bonds[0], alive: false }] },
  { x: 0, y: 1, force: 0.2 }, { timeStep: 0.1, damping: 2 });
assert.ok(Math.abs(detached.nodes[1].displacement.y - (single.nodes[1].displacement.y - 0.01)) < 1e-12,
  'a disconnected contact moves under finite force without pretending to have a static equilibrium');
assert.throws(() => advanceArchStructuralForce(spring, { force: 1 }, { damping: 0 }), /damping/);
const fractional = volume.advanceArchVolumeLoad(spring, { x: 0, y: 1, force: 0.01, threshold: 1 }, { duration: 0.035, timeStep: 0.02 });
assert.equal(fractional.loadApplication.duration, 0.035);
assert.equal(fractional.loadApplication.steps, 2, 'the entire caller duration includes the final partial step');
const profileRoot = new URL('../artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/', import.meta.url);
const load = { x: -0.05, y: 0.29, force: 2, patchRadius: 0.025, threshold: 0.04, iterations: 600,
  contactDepthMode: 'camera-facing-surface', contactLayer: 2 };
for (const name of ['intact', 'outer-notch']) {
  const profile = JSON.parse(fs.readFileSync(new URL(`${name}-profile.json`, profileRoot)));
  const base = buildArchStructuralProxy(profile, { layers: 3 });
  const before = JSON.stringify(base);
  let state = base;
  let priorBroken = new Set();
  let priorEvents = 0;
  const rounds = [];
  for (let round = 0; round < 4; round += 1) {
    state = volume.advanceArchVolumeLoad(state, round < 2 ? load : { ...load, x: -0.22, y: 0.18 });
    const broken = new Set(state.bonds.filter(bond => !bond.alive).map(bond => bond.id));
    for (const id of priorBroken) assert.ok(broken.has(id), `${name}: Apply resurrected ${id}`);
    assert.ok(state.events.length >= priorEvents);
    assert.equal(state.load.requestedForce, 2);
    assert.deepEqual(state.load.loadedNodeLayers, [2]);
    assert.equal(state.loadApplication.round, round + 1);
    assert.ok(state.nodes.every(node => [node.displacement.x, node.displacement.y, node.displacement.z].every(Number.isFinite)));
    assert.ok(state.nodes.filter(node => node.pinned).every(node => Math.hypot(...Object.values(node.displacement)) === 0));
    const frame = volume.resolveArchVolumeEquilibrium(state, load);
    assert.equal(frame.state, state, 'display must use the accepted evolving pose');
    assert.equal(frame.mode, 'evolving-force-pose');
    rounds.push({ broken: broken.size, travel: state.load.travel });
    priorBroken = broken;
    priorEvents = state.events.length;
  }
  assert.ok(rounds[0].broken > 0, `${name}: first force interval must fracture`);
  assert.ok(rounds[1].broken > rounds[0].broken, `${name}: second interval must add fractures`);
  assert.ok(rounds[2].broken > rounds[1].broken, `${name}: third interval must add fractures`);
  assert.ok(rounds[1].travel > rounds[0].travel, `${name}: renewed force must continue motion`);
  assert.equal(JSON.stringify(base), before, 'the reference graph is immutable');
  const released = volume.releaseArchStructuralLoad(state, load).state;
  assert.deepEqual(released.bonds.filter(bond => !bond.alive).map(bond => bond.id), [...priorBroken]);
  assert.equal(released.events.length, state.events.length);
  const reloaded = volume.advanceArchVolumeLoad(released, { ...load, force: 0.1 });
  for (const id of priorBroken) assert.equal(reloaded.bonds.find(bond => bond.id === id).alive, false);
  const bound = volume.bindReleasedArchVolume(released, load);
  assert.equal(bound.maxStrain, 0);
  assert.ok(bound.bonds.every(bond => bond.alive && bond.lastStrain === 0),
    'zero-load Bind must refresh repaired-bond strain at the released reference pose');
  assert.throws(() => volume.bindReleasedArchVolume(state, load), /released/);
  const reevaluated = fractureArchStructuralProxy(bound, { threshold: load.threshold });
  assert.equal(reevaluated.events.length, bound.events.length, 'a stress-relieved repair must not break again without new movement');
  const boundLoaded = volume.advanceArchVolumeLoad(bound, { ...load, force: 0.1 });
  const intactLoaded = volume.advanceArchVolumeLoad(base, { ...load, force: 0.1 });
  assert.ok(reloaded.load.travel > boundLoaded.load.travel, 'retained damage must affect renewed force response');
  assert.ok(Math.abs(boundLoaded.load.travel - intactLoaded.load.travel) < 1e-10, 'Bind must restore load transmission');
  assert.throws(() => volume.advanceArchVolumeLoad(state, load, { duration: -1 }), /duration/);
  assert.throws(() => volume.advanceArchVolumeLoad(state, load, { timeStep: 0 }), /time step/);
  console.log(name, rounds);
}
assert.equal(typeof evidence.findArchVolumeContinuationContradictions, 'function',
  'continuation evidence must reject reset, stale, and incomplete snapshots');
const prior = { intact: { broken: 1, brokenBondIds: ['a'], crackEventCount: 1, eventCount: 1,
  connectivityEpoch: 1, loadApplication: { round: 1, elapsed: 0.1 } } };
const after = { intact: { broken: 2, brokenBondIds: ['a', 'b'], crackEventCount: 2, eventCount: 2,
  connectivityEpoch: 2, loadApplication: { round: 2, elapsed: 0.2 } } };
assert.deepEqual(evidence.findArchVolumeContinuationContradictions(prior, after), []);
for (const corrupt of [
  {},
  { intact: { ...after.intact, brokenBondIds: ['b', 'c'] } },
  { intact: { ...after.intact, loadApplication: prior.intact.loadApplication } },
  { intact: { ...after.intact, eventCount: 0 } },
  { intact: { ...after.intact, brokenBondIds: [] } },
]) assert.ok(evidence.findArchVolumeContinuationContradictions(prior, corrupt).length > 0);
console.log('arch iterative fracture contracts passed');
