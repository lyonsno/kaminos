import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import {
  runExactTerrainSupportPersistenceAssay,
} from '../lirm-terrain-support-persistence-assay.mjs';
import {
  SUPPORT_IDS,
  TERRAIN_SUPPORT_PERSISTENCE_ASSAY_ROUTE,
} from '../lirm-terrain-support-persistence-assay-core.mjs';

const root = resolve(import.meta.dirname, '..');
const exactReportPath = resolve(
  root,
  'artifacts/lirm-719024-terrain-support-persistence-assay-v0/report.json',
);
const report = JSON.parse(await readFile(exactReportPath, 'utf8'));
const exactSourceRoot = resolve(
  root,
  '../kaminos-mushfinger-support-velocity-assay-exact-0724',
);
const exactInputPaths = {
  sourcePath: resolve(exactSourceRoot, 'artifacts/motion-ready-719024/creature.glb'),
  samplesPath: resolve(
    exactSourceRoot,
    'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/flat-support-probe-samples.json',
  ),
  atlasPath: resolve(
    exactSourceRoot,
    'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/admitted-contact-atlas.json',
  ),
  phaseReportPath: resolve(
    exactSourceRoot,
    'artifacts/lirm-719024-smooth-fitted-phase-exercise-v0/report.json',
  ),
  fittedRegistrationPath: resolve(
    exactSourceRoot,
    'artifacts/lirm-719024-fitted-proxy-rig-mechanism-witness-v1/registration.json',
  ),
  axialRegistrationPath: resolve(
    exactSourceRoot,
    'artifacts/motion-ready-719024/registration.json',
  ),
  hillPacketPath: resolve(
    exactSourceRoot,
    'artifacts/motion-ready-719024/hill/motion-affordance-packet.json',
  ),
  hillDataPath: resolve(
    exactSourceRoot,
    'artifacts/motion-ready-719024/hill/motion-affordance-data.json',
  ),
  stationaryFixturePath: resolve(
    exactSourceRoot,
    'artifacts/motion-ready-719024/stationary-contact-constraints/producer-fixture.json',
  ),
};
const inputPathByReportId = {
  source: exactInputPaths.sourcePath,
  samples: exactInputPaths.samplesPath,
  atlas: exactInputPaths.atlasPath,
  phaseReport: exactInputPaths.phaseReportPath,
  fittedRegistration: exactInputPaths.fittedRegistrationPath,
  axialRegistration: exactInputPaths.axialRegistrationPath,
  hillPacket: exactInputPaths.hillPacketPath,
  hillData: exactInputPaths.hillDataPath,
  stationaryFixture: exactInputPaths.stationaryFixturePath,
};

assert.equal(report.schema, 'kaminos.lirm-terrain-support-persistence-assay.v0');
assert.equal(report.status, 'measured');
assert.equal(report.failurePhase, null);
assert.equal(report.requestedRoute, TERRAIN_SUPPORT_PERSISTENCE_ASSAY_ROUTE);
assert.equal(report.effectiveRoute, TERRAIN_SUPPORT_PERSISTENCE_ASSAY_ROUTE);
assert.equal(report.effectiveConfig.effectiveSampleCount, 48);
assert.equal(report.effectiveConfig.duplicateClosureExcluded, true);
assert.equal(report.effectiveConfig.supportObjectCount, SUPPORT_IDS.length);
assert.equal(report.effectiveConfig.permutationCount, 24);
assert.equal(report.assay.permutations.length, 24);
assert.equal(report.result.hypothesisGate, (
  report.result.dynamicWitnessEarned ? 'earned' : 'rejected'
));
assert.equal(
  report.result.dynamicWitnessEarned,
  Object.values(report.result.criteria).every(Boolean),
);
assert.ok(Object.values(report.supportObjects).every(support => (
  support.hillSourceRef === report.sourceTruth.hillSourceRef
  && support.hillRevision === report.sourceTruth.hillRevision
  && support.transportAuthority === 'none-static-hill-exact-point'
)));
for (const family of ['persistent', 'transient', 'absent']) {
  assert.equal(report.assay.supportHoldouts[family].length, SUPPORT_IDS.length);
  assert.equal(report.assay.timeHoldouts[family].length, 2);
  for (const fold of report.assay.timeHoldouts[family]) {
    assert.equal(fold.reconstructions.length, 24);
    assert.ok(fold.reconstructions.every(reconstruction => (
      reconstruction.previousFitSampleId
      && reconstruction.nextFitSampleId
      && Number.isFinite(reconstruction.weight)
      && typeof reconstruction.periodicWrap === 'boolean'
    )));
  }
}

const reproductionRoot = await mkdtemp(
  resolve(tmpdir(), 'kaminos-support-assay-reproduction-'),
);
try {
  const reproduced = await runExactTerrainSupportPersistenceAssay({
    ...exactInputPaths,
    outDir: resolve(reproductionRoot, 'output'),
  });
  const reproducedFromDisk = JSON.parse(await readFile(
    resolve(reproductionRoot, 'output/report.json'),
    'utf8',
  ));
  assert.deepEqual(
    reproducedFromDisk,
    JSON.parse(JSON.stringify(reproduced)),
  );
  for (const [id, expectedPath] of Object.entries(inputPathByReportId)) {
    assert.equal(
      resolve(dirname(exactReportPath), report.inputs[id].path),
      expectedPath,
      `saved ${id} path must resolve to the frozen producer input`,
    );
    assert.equal(
      resolve(reproductionRoot, 'output', reproduced.inputs[id].path),
      expectedPath,
      `reproduced ${id} path must resolve to the frozen producer input`,
    );
    assert.equal(reproduced.inputs[id].sha256, report.inputs[id].sha256);
  }
  assert.equal(reproduced.status, 'measured');
  assert.equal(reproduced.failurePhase, null);
  assert.equal(reproduced.requestedRoute, report.requestedRoute);
  assert.equal(reproduced.effectiveRoute, report.effectiveRoute);
  assert.deepEqual(reproduced.requestedConfig, report.requestedConfig);
  assert.deepEqual(reproduced.effectiveConfig, report.effectiveConfig);
  assert.deepEqual(reproduced.sourceTruth, report.sourceTruth);
  assert.deepEqual(reproduced.result, report.result);
  assert.deepEqual(reproduced.result.criteria, report.result.criteria);
  assert.deepEqual(reproduced.assay.summaries, report.assay.summaries);
  assert.equal(
    reproduced.assay.permutations.length,
    report.assay.permutations.length,
  );
  for (const family of ['persistent', 'transient', 'absent']) {
    assert.equal(
      reproduced.assay.supportHoldouts[family].length,
      report.assay.supportHoldouts[family].length,
    );
    assert.equal(
      reproduced.assay.timeHoldouts[family].length,
      report.assay.timeHoldouts[family].length,
    );
  }
} finally {
  await rm(reproductionRoot, { recursive: true, force: true });
}

const failureRoot = await mkdtemp(resolve(tmpdir(), 'kaminos-support-assay-failure-'));
try {
  await assert.rejects(
    runExactTerrainSupportPersistenceAssay({
      sourcePath: resolve(failureRoot, 'missing-creature.glb'),
      samplesPath: resolve(failureRoot, 'missing-samples.json'),
      atlasPath: resolve(failureRoot, 'missing-atlas.json'),
      phaseReportPath: resolve(failureRoot, 'missing-phase-report.json'),
      fittedRegistrationPath: resolve(failureRoot, 'missing-fitted-registration.json'),
      axialRegistrationPath: resolve(failureRoot, 'missing-axial-registration.json'),
      hillPacketPath: resolve(failureRoot, 'missing-hill-packet.json'),
      hillDataPath: resolve(failureRoot, 'missing-hill-data.json'),
      stationaryFixturePath: resolve(failureRoot, 'missing-stationary-fixture.json'),
      outDir: resolve(failureRoot, 'output'),
    }),
    /source does not exist/,
  );
  const failureReport = JSON.parse(await readFile(
    resolve(failureRoot, 'output/report.json'),
    'utf8',
  ));
  assert.equal(failureReport.status, 'failed');
  assert.equal(failureReport.failurePhase, 'input-admission');
  assert.equal(failureReport.effectiveRoute, null);
  assert.equal(failureReport.result, null);
  assert.match(failureReport.lastTrustworthyEvidence, /failed during input-admission/);
} finally {
  await rm(failureRoot, { recursive: true, force: true });
}

console.log('lirm exact terrain support persistence assay contracts passed');
