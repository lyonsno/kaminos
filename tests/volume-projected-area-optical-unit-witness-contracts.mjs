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
assert.match(
  witness,
  /flow-kernel-moment-gaussian-raster-v0/,
  'witness does not bind the historical one-deposit Gaussian raster',
);
assert.match(
  witness,
  /setFullSupportDepositionMode\(HISTORICAL_DEPOSITION_MODE\)/,
  'witness does not apply the requested historical deposition mode after cohort bootstrap',
);
assert.match(
  witness,
  /volume_boundary_splat_mode', HISTORICAL_SPLAT_MODE/,
  'witness does not preserve the historical learned round-covariance mode',
);
assert.match(
  witness,
  /volume_boundary_splat_radius', String\(HISTORICAL_SPLAT_RADIUS\)/,
  'witness does not preserve the historical splat radius',
);
assert.match(
  witness,
  /volume_boundary_splat_sharpness', String\(HISTORICAL_SPLAT_SHARPNESS\)/,
  'witness does not preserve the historical splat sharpness',
);
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
  /maximumComponentRelativeDelta > 0\.05/,
  'witness does not reject materially identical component arms',
);
assert.match(
  witness,
  /combinedRelativeDelta > 0\.05/,
  'witness does not reject materially identical combined arms',
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
assert.match(
  witness,
  /fullSupportDepositionEffective,\s*HISTORICAL_DEPOSITION_MODE/,
  'witness does not reject effective deposition substitution',
);
assert.match(
  witness,
  /fullSupportRasterDepositCount,\s*arm\.probe\.population\.candidates/,
  'witness does not require one effective raster deposit per candidate',
);
assert.match(
  witness,
  /fullSupportGaussianGeometryIdentity,\s*HISTORICAL_GAUSSIAN_GEOMETRY_IDENTITY/,
  'witness does not reject substitution of the historical round Gaussian geometry',
);
assert.match(
  witness,
  /boundarySplatFootprintAuthority,\s*HISTORICAL_FOOTPRINT_AUTHORITY/,
  'witness does not bind the historical camera-facing covariance authority',
);
assert.match(
  witness,
  /boundarySplatRendererIdentity,\s*HISTORICAL_RENDERER_IDENTITY/,
  'witness does not bind the historical learned renderer identity',
);
assert.match(
  witness,
  /boundarySplatAttributeModelIdentity,\s*HISTORICAL_ATTRIBUTE_MODEL_IDENTITY/,
  'witness does not bind the historical learned attribute identity',
);
assert.match(
  witness,
  /boundarySplatSourceAuthority,\s*HISTORICAL_OPTICAL_SOURCE_AUTHORITY/,
  'witness does not bind the authenticated persistent-cohort optical source',
);

console.log('volume projected-area optical-unit witness contracts: passed');
