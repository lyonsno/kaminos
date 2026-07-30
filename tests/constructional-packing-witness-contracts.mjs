import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  createSyntheticHipCrossSection,
} from '../constructional-packing-core.mjs';
import {
  writeConstructionalPackingWitness,
} from '../constructional-packing-witness.mjs';

const root = await mkdtemp(join(tmpdir(), 'constructional-packing-witness-'));
try {
  const successRoot = join(root, 'success');
  const result = await writeConstructionalPackingWitness({
    outDir: successRoot,
    source: createSyntheticHipCrossSection(),
  });
  assert.equal(result.report.status, 'complete');
  assert.equal(
    result.report.route.requested,
    'constructional-packing-cross-section-v0',
  );
  assert.equal(
    result.report.route.effective,
    'constructional-packing-cross-section-v0',
  );
  assert.equal(result.report.source.authority, 'synthetic-proxy');
  assert.equal(result.report.source.anatomicalAdmission, 'none');
  assert.deepEqual(
    result.report.cases.map(item => item.id),
    ['baseline', 'interior-pressure', 'exterior-compression'],
  );
  assert.ok(
    result.report.cases.every(item => item.metrics.unownedCellCount === 0),
  );
  assert.ok(
    result.report.cases.every(item => item.metrics.anchorViolationCount === 0),
  );
  assert.ok(
    result.report.cases.every(item => item.metrics.excludedObstacleCellCount > 0),
  );

  const html = await readFile(join(successRoot, 'index.html'), 'utf8');
  assert.match(html, /Synthetic proxy/);
  assert.match(html, /Baseline packing/);
  assert.match(html, /Interior pressure/);
  assert.match(html, /Exterior compression/);
  assert.match(html, /hip-joint-clearance/);
  assert.match(html, /data-witness-route="constructional-packing-cross-section-v0"/);

  const persistedReport = JSON.parse(
    await readFile(join(successRoot, 'report.json'), 'utf8'),
  );
  assert.deepEqual(persistedReport, result.report);

  const failureRoot = join(root, 'failure');
  await assert.rejects(
    writeConstructionalPackingWitness({
      outDir: failureRoot,
      source: {
        ...createSyntheticHipCrossSection(),
        schema: 'wrong.schema',
      },
    }),
    /source schema mismatch/,
  );
  const failureReport = JSON.parse(
    await readFile(join(failureRoot, 'report.json'), 'utf8'),
  );
  assert.equal(failureReport.status, 'failed');
  assert.equal(failureReport.failurePhase, 'solve-baseline');
  assert.equal(failureReport.route.effective, null);
  assert.match(failureReport.error.message, /source schema mismatch/);
  assert.deepEqual(failureReport.lastTrustworthyEvidence, {
    phase: 'source-received',
    sourceId: 'synthetic-fitted-hip-cross-section-v0',
    sourceSchema: 'wrong.schema',
  });

  const partialWriteRoot = join(root, 'partial-write');
  let injectedFailureCount = 0;
  await assert.rejects(
    writeConstructionalPackingWitness({
      outDir: partialWriteRoot,
      source: createSyntheticHipCrossSection(),
      io: {
        mkdir,
        rename,
        async writeFile(path, contents) {
          if (String(path).endsWith('interior-pressure.json')) {
            injectedFailureCount += 1;
            throw new Error('injected supporting artifact failure');
          }
          return writeFile(path, contents);
        },
      },
    }),
    /injected supporting artifact failure/,
  );
  assert.equal(injectedFailureCount, 1);
  const partialWriteReport = JSON.parse(
    await readFile(join(partialWriteRoot, 'report.json'), 'utf8'),
  );
  assert.equal(partialWriteReport.status, 'failed');
  assert.equal(partialWriteReport.failurePhase, 'write-supporting-artifacts');
  assert.equal(partialWriteReport.route.effective, null);
  assert.match(
    partialWriteReport.error.message,
    /injected supporting artifact failure/,
  );

  const blockedOutputRoot = join(root, 'blocked-output');
  await writeFile(blockedOutputRoot, 'blocks directory creation');
  let prepareError = null;
  try {
    await writeConstructionalPackingWitness({
      outDir: blockedOutputRoot,
      source: createSyntheticHipCrossSection(),
    });
  } catch (error) {
    prepareError = error;
  }
  assert.ok(prepareError, 'blocked output root must reject');
  assert.equal(
    prepareError.failureReportPath,
    `${blockedOutputRoot}.failure-report.json`,
  );
  const prepareFailureReport = JSON.parse(
    await readFile(prepareError.failureReportPath, 'utf8'),
  );
  assert.equal(prepareFailureReport.status, 'failed');
  assert.equal(prepareFailureReport.failurePhase, 'prepare-output');
  assert.equal(prepareFailureReport.route.effective, null);

  const detachedObstacleRoot = join(root, 'detached-obstacle');
  const detachedObstacleSource = createSyntheticHipCrossSection();
  detachedObstacleSource.obstacles[0].center = [50, 50];
  await assert.rejects(
    writeConstructionalPackingWitness({
      outDir: detachedObstacleRoot,
      source: detachedObstacleSource,
    }),
    /obstacle center must remain inside the fitted envelope/,
  );
  const detachedObstacleReport = JSON.parse(
    await readFile(join(detachedObstacleRoot, 'report.json'), 'utf8'),
  );
  assert.equal(detachedObstacleReport.status, 'failed');
  assert.equal(detachedObstacleReport.failurePhase, 'solve-baseline');
  assert.equal(detachedObstacleReport.route.effective, null);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('Constructional packing witness contracts passed');
