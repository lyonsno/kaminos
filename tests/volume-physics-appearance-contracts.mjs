// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PHYSICS_MATERIAL_LAW,
  PHYSICS_APPEARANCE_DEFAULTS,
  PHYSICS_APPEARANCE_UNCOUPLED_CONTROLS,
  resolvePhysicsAppearance,
  physicsAppearanceUniformValues,
  physicsSootKelvin,
  sootBurnoutSurvival,
  physicsEmissiveMaterial,
} from '../volume-physics-appearance.mjs';
import { thermalRadianceRGB } from '../volume-emissive-transport.mjs';

// Physics appearance (operator, 2026-10-14): under the reactant law the flame is
// drawn from the simulated soot and temperature alone. Hot soot emits as a
// blackbody at the temperature the heat field implies (one calibration, Kelvin
// per heat unit, owned by the operator); the same soot absorbs and scatters;
// fresh burning adds reaction light. None of the appearance carriers, nor the
// carrier-built coverage gate, is read. Soot can burn out where it is hot and
// meets oxygen (a sim term, off at rate 0).

const params = {
  density: 1, extinction: 2, albedo: 0.35, thermalGain: 1, cleanGain: 0.08,
  kelvinPerHeat: 1600, burnReference: 0.05, smokeVisible: 1,
};

test('the physics law is a third material law, requested by material law 2', () => {
  assert.equal(PHYSICS_MATERIAL_LAW, 2);
  const resolved = resolvePhysicsAppearance({ physicalMaterialLaw: 2 }, { reactantAdmitted: true, emissiveRouteEffective: true });
  assert.equal(resolved.requested, true);
  assert.deepEqual(resolved.effective, { render: true, sootBurnout: false }, 'burnout is off at its default rate 0');
  assert.equal(resolved.reason, null);
  assert.equal(resolved.kelvinPerHeat, PHYSICS_APPEARANCE_DEFAULTS.kelvinPerHeat);
  // Physics is the one material law (the law select is retired, 2026-10-18): no saved field selects it.
  assert.equal(resolvePhysicsAppearance({}, { reactantAdmitted: true, emissiveRouteEffective: true }).requested, true, 'the law is not read from a retired control');
  assert.equal(resolvePhysicsAppearance({ physicalMaterialLaw: 1 }, { reactantAdmitted: true, emissiveRouteEffective: true }).requested, true, 'a stale saved law value cannot reinstate a retired law');
  const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(core, /controlsSnapshot\.physicalColorMode|controlsSnapshot\.physicalMaterialLaw/, 'the colour route and material law are not read from retired controls (a snapshot without them rendered the legacy transfer: no emission)');
  assert.match(core, /const physicalColorMode = 2;/, 'emissive transport is the one colour route');
});

test('it draws under every reaction law; the soot burnout still follows the reactant law, never the view', () => {
  // Physics is the one material law (operator, 2026-10-18): there is no stand-in
  // for the authored reaction law any more, so the view draws Physics there too.
  const authored = resolvePhysicsAppearance({ physicalSootBurnoutRate: 0.4 }, { reactantAdmitted: false, emissiveRouteEffective: true });
  assert.deepEqual(authored.effective, { render: true, sootBurnout: false }, 'the authored law renders Physics; burnout needs the reactant oxidizer field');
  assert.equal(authored.reason, null);
  const offRoute = resolvePhysicsAppearance({ physicalSootBurnoutRate: 0.4 }, { reactantAdmitted: true, emissiveRouteEffective: false });
  assert.deepEqual(offRoute.effective, { render: false, sootBurnout: true }, 'a diagnostic view must not change the simulation');
  assert.equal(offRoute.reason, 'physics-appearance-draws-only-on-the-emissive-transport-route');
  assert.deepEqual(physicsAppearanceUniformValues(authored), [1, authored.kelvinPerHeat, 0, authored.sootBurnoutKelvin]);
  assert.deepEqual(physicsAppearanceUniformValues(offRoute), [0, offRoute.kelvinPerHeat, 0.4, offRoute.sootBurnoutKelvin]);
  const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(core, /transportedEmissiveMaterial|transported-heat-soot-v1|mixed-carrier-soot-floor-v2/, 'the transported and mixed-carrier stand-ins are gone from the core');
});

test('controls are clamped to their ranges and non-finite input falls back to the defaults', () => {
  const r = resolvePhysicsAppearance({ physicalMaterialLaw: 2, physicalKelvinPerHeat: 1e9, physicalSootBurnoutRate: -3, physicalSootBurnoutKelvin: 'x' }, { reactantAdmitted: true, emissiveRouteEffective: true });
  assert.equal(r.kelvinPerHeat, 6000);
  assert.equal(r.sootBurnoutRate, 0);
  assert.equal(r.sootBurnoutKelvin, PHYSICS_APPEARANCE_DEFAULTS.sootBurnoutKelvin);
});

test('temperature is linear in heat from a cold 300 K', () => {
  assert.equal(physicsSootKelvin(0, 1600), 300);
  assert.equal(physicsSootKelvin(1, 1600), 1900);
  assert.equal(physicsSootKelvin(-1, 1600), 300, 'negative heat is clamped');
});

test('hot soot emits by its absorption times the blackbody power: no soot, no glow; cold soot, no glow; glow rises steeply with temperature', () => {
  const none = physicsEmissiveMaterial({ soot: 0, heat: 1.5, freshBurn: 0 }, params);
  assert.deepEqual(none.emission, [0, 0, 0]);
  const cold = physicsEmissiveMaterial({ soot: 1, heat: 0.2, freshBurn: 0 }, params);
  assert.ok(Math.max(...cold.emission) < 1e-6, `soot at ${physicsSootKelvin(0.2, 1600)} K does not glow visibly`);
  const warm = physicsEmissiveMaterial({ soot: 1, heat: 0.8, freshBurn: 0 }, params);
  const hot = physicsEmissiveMaterial({ soot: 1, heat: 1.0, freshBurn: 0 }, params);
  assert.ok(hot.emission[1] / warm.emission[1] > 2, '1580 K -> 1900 K more than doubles visible emission');
  const absorbing = 1 * params.extinction * (1 - params.albedo);
  assert.ok(Math.abs(hot.absorption - absorbing) < 1e-9);
  assert.ok(Math.abs(hot.scattering - params.extinction * params.albedo) < 1e-9);
  const planck = thermalRadianceRGB(1900);
  hot.emission.forEach((v, i) => assert.ok(Math.abs(v - absorbing * planck[i]) < 1e-9, 'emission = absorption x blackbody (gain 1)'));
});

test('reaction light follows the fresh burn and soot suppresses it locally', () => {
  const clean = physicsEmissiveMaterial({ soot: 0, heat: 0, freshBurn: 0.05 }, params);
  const none = physicsEmissiveMaterial({ soot: 0, heat: 0, freshBurn: 0 }, params);
  const sooty = physicsEmissiveMaterial({ soot: 0.5, heat: 0, freshBurn: 0.05 }, params);
  assert.deepEqual(none.emission, [0, 0, 0]);
  assert.ok(clean.emission[2] > 0);
  assert.ok(sooty.emission[2] < clean.emission[2]);
});

test('soot burnout: off at rate 0, needs heat and oxygen, and is a survival in (0, 1]', () => {
  const p = { sootBurnoutRate: 0.5, sootBurnoutKelvin: 1300, kelvinPerHeat: 1600 };
  assert.equal(sootBurnoutSurvival({ heat: 2, oxidizerFraction: 1, timeStep: 1 }, { ...p, sootBurnoutRate: 0 }), 1);
  assert.equal(sootBurnoutSurvival({ heat: 2, oxidizerFraction: 0, timeStep: 1 }, p), 1, 'no oxygen, no burnout');
  assert.ok(sootBurnoutSurvival({ heat: 0.2, oxidizerFraction: 1, timeStep: 1 }, p) > 0.999999, 'cold soot survives');
  const hot = sootBurnoutSurvival({ heat: 1.5, oxidizerFraction: 1, timeStep: 1 }, p);
  assert.ok(Math.abs(hot - Math.exp(-0.5)) < 1e-9, 'well above the burnout temperature it is exp(-rate * dt * O2)');
  const twoSteps = sootBurnoutSurvival({ heat: 1.5, oxidizerFraction: 1, timeStep: 2 }, p);
  assert.ok(Math.abs(twoSteps - hot * hot) < 1e-9, 'time-step consistent');
});

test('the kernel and the renderer carry the same laws as these references', () => {
  const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
  const transport = readFileSync(new URL('../volume-emissive-transport.mjs', import.meta.url), 'utf8');
  const physicsBranch = transport.slice(transport.indexOf('fn physicsEmissiveMaterial('), transport.indexOf('\n}\n', transport.indexOf('fn physicsEmissiveMaterial(')));
  assert.ok(physicsBranch.length > 0, 'the WGSL physics material exists');
  assert.doesNotMatch(physicsBranch, /fireLayer|microLayer|frontTopology|coverage/, 'no carrier and no carrier-built coverage is read');
  assert.match(physicsBranch, /physicsSootKelvin\(m\.y, u\.emissive_physics\.y\)/);
  assert.match(transport, /if \(u\.emissive_physics\.x > 0\.5\) \{ return physicsEmissiveMaterial\(r, smokeVisible\); \}/, 'emissiveMaterial switches before reading anything else');
  assert.match(core, /smoke = smoke \* sootBurnoutSurvival\(heat, clamp\(oxidizer \/ max\(u\.reactant_combustion_c\.z, 1e-6\), 0\.0, 1\.0\), timeStep\);/, 'the step kernel applies the burnout to soot');
  assert.match(core, /emissive_physics: vec4<f32>,/);
});

test('the uncoupled-control list names real cockpit controls and the switch lives in the Emissive transport group', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // The paintings were retired with the legacy material laws (2026-10-18); only the carrier drivers remain uncoupled.
  assert.equal(PHYSICS_APPEARANCE_UNCOUPLED_CONTROLS.length, 3, 'Fire licks, Shred and Microdetail (Detail Scale retired 2026-10-21)');
  assert.ok(PHYSICS_APPEARANCE_UNCOUPLED_CONTROLS.every(c => c.reason === 'carriers-only'));
  for (const { id, reason } of PHYSICS_APPEARANCE_UNCOUPLED_CONTROLS) {
    assert.ok(index.includes(`id="${id}"`), `${id} exists in the cockpit`);
    assert.ok(['unused', 'carriers-only'].includes(reason), `${id}: ${reason}`);
  }
  for (const id of ['volume-fire-licks', 'volume-interface-shred', 'volume-microdetail']) {
    assert.ok(PHYSICS_APPEARANCE_UNCOUPLED_CONTROLS.some(c => c.id === id), `${id} is marked`);
  }
  for (const id of ['volume-physical-exposure', 'volume-physical-white', 'volume-physical-smoke-extinction', 'volume-density', 'volume-reactant-mixing-time']) {
    assert.ok(!PHYSICS_APPEARANCE_UNCOUPLED_CONTROLS.some(c => c.id === id), `${id} still couples`);
  }
  assert.doesNotMatch(index, /id="volume-physical-material-law"/, 'the material law select is retired: Physics is the law');
  for (const id of ['volume-physical-kelvin-per-heat', 'volume-physical-soot-burnout-rate', 'volume-physical-soot-burnout-kelvin']) {
    assert.ok(index.includes(`id="${id}"`), `${id} is in the cockpit`);
  }
});

test('in a saved layout the new controls join the material law; an existing placement is left alone; they show only under the physics law', async () => {
  const { VOLUME_COCKPIT_LAYOUT_IDENTITY, reconcileVolumeCockpitLayoutDocument, volumeCockpitModeAvailability } = await import('../volume-cockpit-layout.mjs');
  const layout = { identity: VOLUME_COCKPIT_LAYOUT_IDENTITY, layoutId: 'physics-test', label: 'Physics', groups: [
    { id: 'source', label: 'Source', surface: 'primary', collapsed: false, controlIds: ['volume-flow-rate'] },
    { id: 'flame', label: 'Flame', surface: 'primary', collapsed: false, controlIds: ['volume-physical-mode', 'volume-physical-material-law', 'volume-physical-temperature'] },
  ] };
  const physicsIds = ['volume-physical-kelvin-per-heat', 'volume-physical-soot-burnout-rate', 'volume-physical-soot-burnout-kelvin'];
  const ids = ['volume-flow-rate', 'volume-physical-mode', 'volume-physical-material-law', 'volume-physical-temperature', ...physicsIds];
  const added = reconcileVolumeCockpitLayoutDocument({ document: layout, authorableControlIds: ids });
  assert.deepEqual(added.document.groups.find(g => g.id === 'flame').controlIds,
    ['volume-physical-mode', 'volume-physical-material-law', ...physicsIds, 'volume-physical-temperature']);
  assert.ok(!added.document.groups.some(g => g.id === 'new-controls'), 'not parked in New controls');
  const placed = structuredClone(layout); placed.groups[0].controlIds.push(...physicsIds);
  assert.deepEqual(reconcileVolumeCockpitLayoutDocument({ document: placed, authorableControlIds: ids }).document, placed);
  const emissive = { effective: 'emissive-transport-v2' };
  // The Physics law is the only material law (legacy laws retired 2026-10-18); the renderer receipt decides.
  assert.equal(volumeCockpitModeAvailability({}, [], emissive)['volume-physical-kelvin-per-heat'], '');
  assert.match(volumeCockpitModeAvailability({}, [], { effective: 'legacy' })['volume-physical-soot-burnout-rate'], /emissive transport route/);
});
