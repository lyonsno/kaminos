import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const witnessUrl = new URL('../volume-projected-area-optical-unit-witness.mjs', import.meta.url);
assert.equal(
  existsSync(witnessUrl),
  true,
  'projected-area optical-unit browser witness is missing',
);

const witness = readFileSync(witnessUrl, 'utf8');
assert.match(witness, /coefficient-state-120/, 'witness does not bind the authenticated source state');
assert.match(witness, /4a93aeefe7eebec06f039dd35bd2947e4e76f292eadd7b7719e02235d062ac20/, 'witness does not bind the cohort manifest checksum');
assert.match(witness, /projected-native-cell-area-integral-normalized-v0/, 'witness omits the physical optical-unit arm');
assert.match(witness, /legacy-global-path-scale-diagnostic-v0/, 'witness omits the legacy raw-scale control arm');
assert.match(witness, /same-state-capture-id/, 'witness does not bind both arms to one state');
assert.match(witness, /camera.*drift|camera-drift/i, 'witness does not reject camera drift');
assert.match(witness, /fallback/i, 'witness does not reject renderer fallback');
assert.match(witness, /blank/i, 'witness does not reject blank visual output');
assert.match(witness, /failurePhase/, 'witness cannot report a phase-specific failure');
assert.match(witness, /writeFileSync\(reportPath/, 'witness does not persist its report on failure');
assert.match(witness, /emissionOnlyLinearLuma/, 'witness omits emission-only linear luma');
assert.match(witness, /extinctionOnlyMeanOpacity/, 'witness omits extinction-only mean opacity');
assert.match(witness, /combinedLinearLuma/, 'witness omits combined linear luma');
assert.match(witness, /kernelIntegral/, 'witness omits kernel integral conservation');
assert.match(
  witness,
  /physicalArm\.probe\.emissionOnlyLinearLuma > legacyArm\.probe\.emissionOnlyLinearLuma \* 2/,
  'witness does not reject a collapsed physical emission discriminator',
);
assert.match(
  witness,
  /physicalArm\.probe\.extinctionOnlyMeanOpacity > legacyArm\.probe\.extinctionOnlyMeanOpacity \* 2/,
  'witness does not reject a collapsed physical extinction discriminator',
);
assert.match(
  witness,
  /physicalArm\.probe\.combinedLinearLuma > legacyArm\.probe\.combinedLinearLuma \* 2/,
  'witness does not reject a collapsed physical combined discriminator',
);
assert.match(
  witness,
  /analytical-construction-not-gpu-measured-v0/,
  'witness lets analytical kernel normalization look GPU-measured',
);
assert.match(
  witness,
  /requestedRoute: route\.href/,
  'arm probes do not preserve the exact requested browser route',
);

console.log('volume projected-area optical-unit witness contracts: passed');
