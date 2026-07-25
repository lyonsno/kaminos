import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  exerciseHillMovingSupportConsumer,
} from '../hill-moving-support-consumer.mjs';

const packageReportPath = process.env.HILL_SUPPORT_PACKAGE_REPORT;
assert.ok(
  packageReportPath,
  'HILL_SUPPORT_PACKAGE_REPORT must name the exact LERMS package witness report',
);
const packageReport = JSON.parse(
  readFileSync(resolve(packageReportPath), 'utf8'),
);
const packageCoordinate =
  '@lerms/hill-of-hills-support/hill-of-hills/analytic-impact-support';
const hillSupportModule = await import(packageCoordinate);
const analyticModuleUrl = import.meta.resolve(packageCoordinate);
const hillTerrainModule = await import(
  new URL('./hill-of-hills.js', analyticModuleUrl)
);

const receipt = exerciseHillMovingSupportConsumer({
  hillSupportModule,
  hillTerrainModule,
  packageReport,
});

assert.equal(
  receipt.schema,
  'kaminos.hill-moving-support-consumer-exercise.v1',
);
assert.equal(receipt.status, 'passed');
assert.equal(receipt.requested.hillPackageCoordinate, packageCoordinate);
assert.equal(
  receipt.requested.bigPapaRevision,
  'f8e1f6db64fb3a505151d16f83d5131b588d2516',
);
assert.equal(
  receipt.effective.hillPackageSourceRevision,
  '62d5d348663b901304745d9649ae85d0a74394c0',
);
assert.equal(
  receipt.effective.hillPackageArtifactSha256,
  packageReport.artifact.sha256,
);
assert.equal(receipt.effective.fallbackRoute, null);
assert.equal(receipt.retainedQuery.sameObjectAcrossMeasureAndCreate, true);
assert.ok(receipt.retainedQuery.measureSampleCount > 1);
assert.ok(receipt.retainedQuery.remeasurementSampleCount > 1);
assert.deepEqual(
  receipt.parity.directHillPoint,
  receipt.parity.bigPapaImpactPoint,
);
assert.deepEqual(
  receipt.parity.directHillNormal,
  receipt.parity.bigPapaImpactNormal,
);
assert.deepEqual(
  receipt.parity.bigPapaImpactPoint,
  receipt.parity.bigPapaHandoffPoint,
);
assert.deepEqual(
  receipt.parity.bigPapaImpactNormal,
  receipt.parity.bigPapaHandoffNormal,
);
assert.equal(receipt.parity.identityExactAcrossQueryDescriptorImpactHandoff, true);
assert.ok(receipt.bounds.maximumSpatialLipschitz > 0);
assert.ok(receipt.bounds.maximumSignedDistanceRate > 0);
assert.equal(
  receipt.bounds.maximumCombinedDistanceRate,
  receipt.bounds.maximumSpatialLipschitz
    * receipt.bounds.maximumCarrierSpeed
    + receipt.bounds.maximumSignedDistanceRate,
);
assert.deepEqual(
  Object.keys(receipt.falseProviderFailures).sort(),
  [
    'fallback_identity',
    'partial_identity',
    'skipped_support_epoch',
    'stale_default_frame',
    'stale_identity',
    'understated_spatial_bound',
    'understated_temporal_bound',
    'unsupported_world_time',
  ],
);
for (const [name, failure] of Object.entries(receipt.falseProviderFailures)) {
  assert.equal(failure.rejected, true, `${name} did not fail loud`);
  assert.equal(typeof failure.message, 'string');
  assert.ok(failure.message.length > 0);
}

process.stdout.write('hill moving-support consumer contracts passed\n');
