import assert from 'node:assert/strict';

import { createLayeredStructuralMaterial } from '../structural-material-3d-core.js';
import {
  STRUCTURAL_COMBUSTION_AUTHORITY,
  STRUCTURAL_COMBUSTION_SCHEMA,
  simulateStructuralCombustionReference,
} from '../structural-combustion-gpu.mjs';

const target = createLayeredStructuralMaterial({ columns: 7, rows: 5, layers: 4, notch: true });
const control = createLayeredStructuralMaterial({ columns: 7, rows: 5, layers: 4, notch: true });
const options = {
  structures: [
    { id: 'target', state: target, control: false },
    { id: 'control', state: control, control: true },
  ],
  steps: 240,
  dt: 1 / 60,
  exposure: {
    position: [0.52, 0.5, 0.0],
    radius: 0.28,
    intensity: 5.2,
  },
  ambientTemperature: 0.08,
  ignitionTemperature: 0.62,
  heatCapacity: 1,
  cooling: 0.035,
  conduction: 0.22,
  burnRate: 0.005,
  charStrengthLoss: 0.82,
};

const result = simulateStructuralCombustionReference(options);
assert.equal(result.schema, STRUCTURAL_COMBUSTION_SCHEMA);
assert.equal(result.authority, STRUCTURAL_COMBUSTION_AUTHORITY);

const targetResult = result.structures.find(structure => structure.id === 'target');
const controlResult = result.structures.find(structure => structure.id === 'control');
const nearNodes = targetResult.nodes.filter(node => node.position[2] === 0 && Math.abs(node.position[0] - 0.5) <= 0.18);
const farNodes = targetResult.nodes.filter(node => node.position[2] === 1 && Math.abs(node.position[0] - 0.5) <= 0.18);
const ignitedNear = nearNodes.filter(node => node.ignitionStep > 0);

assert.ok(ignitedNear.length > 0, 'live spatial exposure ignites contacted front-face nodes');
assert.ok(
  Math.min(...ignitedNear.map(node => node.ignitionStep)) <
    Math.min(...farNodes.filter(node => node.ignitionStep > 0).map(node => node.ignitionStep)),
  'contacted front-face nodes ignite before through-thickness nodes',
);
assert.ok(
  Math.max(...farNodes.map(node => node.temperature)) > options.ambientTemperature + 0.04,
  'bond conduction heats the far face above ambient',
);
assert.ok(
  controlResult.nodes.every(node => node.temperature === options.ambientTemperature && node.ignitionStep === 0),
  'the matched control remains cool and unignited',
);

const weakenedTargetBonds = targetResult.bonds.filter(bond => bond.strength < bond.initialStrength * 0.75);
assert.ok(weakenedTargetBonds.length > 0, 'char damage progressively lowers adjacent structural bond strength');
assert.ok(
  controlResult.bonds.every(bond => bond.strength === bond.initialStrength),
  'the matched control retains its authored strength',
);
assert.ok(result.emissions.length > 0, 'ignited structural nodes emit source-accounted Pyro records');
assert.ok(
  result.emissions.every(emission => emission.step >= emission.ignitionStep && emission.objectId === 'target'),
  'target emission begins only after node-local ignition and never aliases the control',
);
assert.ok(result.ledger.emittedFuel > 0 && result.ledger.emittedSoot > 0);
assert.equal(result.ledger.sourceCount, result.emissions.length);

const noConduction = simulateStructuralCombustionReference({ ...options, conduction: 0 });
const insulatedFar = noConduction.structures
  .find(structure => structure.id === 'target')
  .nodes.filter(node => node.position[2] === 1 && Math.abs(node.position[0] - 0.5) <= 0.18);
assert.ok(
  Math.max(...farNodes.map(node => node.temperature)) > Math.max(...insulatedFar.map(node => node.temperature)) + 0.035,
  'far-face heating is carried by explicit bond conduction rather than an oversized exposure radius',
);

console.log('structural combustion spatial contracts: ok');
