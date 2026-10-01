import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bindArchStructuralProxy, buildArchStructuralProxy, fractureArchStructuralProxy, solveArchStructuralForce } from '../structural-material-arch-core.js';
import { buildArchVolumeFrame, releaseArchStructuralLoad, resolveArchVolumeEquilibrium } from '../structural-material-arch-volume-view.js';
import { findArchVolumeEvidenceContradictions } from '../structural-material-arch-volume-evidence.mjs';

const state = {
  layers: 3,
  nodes: [
    { x: 0, y: 0, z: 0.18, layer: 2, componentId: 0, pinned: false, displacement: { x: 0.02, y: -0.03, z: 0 } },
    { x: 0.1, y: 0, z: 0.18, layer: 2, componentId: 1, pinned: true, displacement: { x: 0, y: 0, z: 0 } },
  ],
  bonds: [{ a: 0, b: 1, alive: false, lastStrain: 0.08 }],
  components: [{ id: 0, size: 1 }, { id: 1, size: 1 }],
};

const frame = buildArchVolumeFrame(state);
assert.equal(frame.nodes.length, 2);
assert.deepEqual(frame.nodes[0].position, [0.02, -0.03, 0.18]);
assert.equal(frame.nodes[0].componentId, 0);
assert.equal(frame.nodes[0].strain, 0.08);
assert.equal(frame.nodes[1].pinned, true);
assert.equal(frame.brokenSegments.length, 1);
assert.deepEqual(frame.brokenSegments[0], [0.02, -0.03, 0.18, 0.1, 0, 0.18]);
const equilibrium = {
  ...state,
  nodes: state.nodes.map((node, index) => ({
    ...node,
    displacement: index === 0 ? { x: 0.04, y: -0.09, z: 0 } : node.displacement,
  })),
};
const opened = buildArchVolumeFrame(state, equilibrium);
assert.deepEqual(opened.nodes[0].position, [0.04, -0.09, 0.18]);
assert.deepEqual(opened.brokenSegments[0], [0.04, -0.09, 0.18, 0.1, 0, 0.18]);
assert.equal(opened.nodes[0].componentId, state.nodes[0].componentId);
const profile = JSON.parse(fs.readFileSync(new URL('../artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/intact-profile.json', import.meta.url)));
const base = buildArchStructuralProxy(profile, { layers: 3 });
for (const [force, mode] of [[2, 'fracture-event-pose'], [2.5, 'accepted-pose-unanchored']]) {
  const load = { x: -0.05, y: 0.29, threshold: 0.04, iterations: 600, force };
  const damaged = fractureArchStructuralProxy(solveArchStructuralForce(base, load), { threshold: load.threshold });
  const display = resolveArchVolumeEquilibrium(damaged, load);
  assert.equal(display.mode, mode);
  assert.equal(display.state.nodes.length, damaged.nodes.length);
  if (force === 2) {
    assert.equal(display.state, damaged, 'fracture must retain the accepted loaded pose instead of solving a new damaged-graph equilibrium');
    const released = releaseArchStructuralLoad(damaged, load);
    assert.equal(released.mode, 'unloaded-damaged');
    assert.equal(released.state.bonds.filter(bond => !bond.alive).length, damaged.bonds.filter(bond => !bond.alive).length);
    assert.equal(released.state.connectivityEpoch, damaged.connectivityEpoch);
    assert.equal(released.state.events.length, damaged.events.length);
    assert.equal(released.state.load.requestedForce, 0);
    assert.ok(released.state.nodes.every(node => Math.hypot(node.displacement.x, node.displacement.y, node.displacement.z) < 1e-12));
    const rebound = bindArchStructuralProxy(released.state, { bondIds: released.state.bonds.filter(bond => !bond.alive).map(bond => bond.id) });
    const reboundDisplay = resolveArchVolumeEquilibrium(rebound, { ...load, force: 0 });
    assert.equal(reboundDisplay.mode, 'repaired-graph-equilibrium');
    assert.equal(reboundDisplay.state.bonds.filter(bond => !bond.alive).length, 0);
    assert.equal(reboundDisplay.state.components.length, 1);
  }
  if (force === 2.5) {
    assert.equal(display.state, damaged);
  }
}
const page = fs.readFileSync(new URL('../structural-material-arch-volume.html', import.meta.url), 'utf8');
const smoke = fs.readFileSync(new URL('../structural-material-arch-volume-smoke.mjs', import.meta.url), 'utf8');
assert.match(page, /id="release"/, 'the operator can release the applied force without resetting damage');
assert.match(page, /releaseArchStructuralLoad/, 'the release control uses the damage-preserving unload transition');
assert.match(page, /let released = false/, 'Bind must be gated until an explicit release');
assert.match(page, /if \(!applied \|\| !released\) return/, 'the Bind handler refuses direct loaded-state binding');
assert.match(page, /solverAuthority: item\.base\.solverAuthority/, 'the route witness exposes the effective structural solver authority');
assert.match(smoke, /witness ended without reaching a terminal status/, 'an incomplete browser run becomes an explicit failed report');
assert.ok(smoke.includes('  save();\n  await close()'), 'the smoke persists its terminal result before cleanup can fail');
const evidenceModulePath = new URL('../structural-material-arch-volume-evidence.mjs', import.meta.url);
assert.ok(fs.existsSync(evidenceModulePath), 'the smoke acceptance predicates must be replayable against false source/render claims');
const evidenceInput = {
  expectedSources: { 'volume.html': 'page-hash', 'profile.json': 'profile-hash' },
  servedSources: { 'volume.html': { status: 200, sha256: 'page-hash' }, 'profile.json': { status: 200, sha256: 'profile-hash' } },
  expectedProfileSourceHashes: { intact: 'trellis-intact-hash' },
  cases: { intact: { sourceSha256: 'trellis-intact-hash', nodes: 24, renderedInstances: 24 } },
};
assert.deepEqual(findArchVolumeEvidenceContradictions(evidenceInput), []);
assert.match(findArchVolumeEvidenceContradictions({
  ...evidenceInput,
  cases: { intact: { ...evidenceInput.cases.intact, sourceSha256: 'WRONG-SOURCE-PROFILE' } },
})[0], /profile source mismatch/, 'the witness rejects a profile identity that differs from the admitted profile');
assert.match(findArchVolumeEvidenceContradictions({
  ...evidenceInput,
  servedSources: { ...evidenceInput.servedSources, 'volume.html': { status: 200, sha256: 'STALE-SERVER-HASH' } },
})[0], /served source mismatch/, 'the witness rejects source bytes served by a different implementation');
assert.match(findArchVolumeEvidenceContradictions({
  ...evidenceInput,
  servedSources: { ...evidenceInput.servedSources, 'profile.json': { status: 404, sha256: 'profile-hash' } },
})[0], /served source mismatch/, 'the witness rejects a missing served profile even when its expected bytes are known');
assert.match(findArchVolumeEvidenceContradictions({
  ...evidenceInput,
  cases: { intact: { ...evidenceInput.cases.intact, renderedInstances: 0 } },
})[0], /rendered population mismatch/, 'the witness rejects a populated graph with no rendered instances');
console.log('arch volume frame contracts passed');
