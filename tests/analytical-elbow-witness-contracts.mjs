import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAnalyticalElbowDescriptor } from '../analytical-elbow-core.mjs';
import { writeAnalyticalElbowWitness } from '../analytical-elbow-witness.mjs';

const root = await mkdtemp(join(tmpdir(), 'analytical-elbow-witness-'));
try {
  const successRoot = join(root, 'success');
  const result = await writeAnalyticalElbowWitness({
    outDir: successRoot,
    descriptor: createAnalyticalElbowDescriptor(),
  });
  assert.equal(result.report.status, 'complete');
  assert.deepEqual(result.report.route, {
    requested: 'analytical-elbow-orbitable-v0',
    effective: 'analytical-elbow-orbitable-v0',
    fallbackUsed: false,
  });
  assert.deepEqual(result.report.source, {
    id: 'synthetic-mammalian-elbow-v0',
    schema: 'kaminos.analytical-elbow-descriptor.v0',
    authority: 'synthetic-proxy',
    anatomicalAdmission: 'structural-hypothesis',
  });
  assert.deepEqual(
    result.report.poses.map(pose => pose.flexionDegrees),
    [0, 35, 80],
  );
  assert.ok(result.report.poses.every(pose => pose.clearanceViolationCount === 0));

  const html = await readFile(join(successRoot, 'index.html'), 'utf8');
  assert.match(html, /data-witness-route="analytical-elbow-orbitable-v0"/);
  assert.match(html, /OrbitControls/);
  assert.match(html, /Synthetic structural hypothesis/);
  assert.match(html, /brachialis-like flexor/);
  assert.match(html, /triceps-like extensor/);
  assert.match(html, /requested analytical-elbow-orbitable-v0/);
  assert.match(html, /effective analytical-elbow-orbitable-v0/);
  assert.match(html, /URLSearchParams/);
  assert.match(html, /header \{ flex-direction:column;/);
  assert.match(html, /\.metrics \{ right:10px; left:10px;/);

  const consumerExport = JSON.parse(
    await readFile(join(successRoot, 'consumer-export.json'), 'utf8'),
  );
  assert.equal(consumerExport.effectiveRoute, 'analytical-cage');
  assert.equal(consumerExport.fallbackUsed, false);
  assert.equal(consumerExport.poses.length, 3);

  const persistedReport = JSON.parse(
    await readFile(join(successRoot, 'report.json'), 'utf8'),
  );
  assert.deepEqual(persistedReport, result.report);

  const failureRoot = join(root, 'failure');
  const invalidDescriptor = createAnalyticalElbowDescriptor();
  invalidDescriptor.schema = 'wrong.schema';
  await assert.rejects(
    writeAnalyticalElbowWitness({
      outDir: failureRoot,
      descriptor: invalidDescriptor,
    }),
    /unsupported analytical elbow descriptor schema/,
  );
  const failureReport = JSON.parse(
    await readFile(join(failureRoot, 'report.json'), 'utf8'),
  );
  assert.equal(failureReport.status, 'failed');
  assert.equal(failureReport.failurePhase, 'solve-consumer-export');
  assert.equal(failureReport.route.effective, null);
  assert.deepEqual(failureReport.lastTrustworthyEvidence, {
    phase: 'descriptor-received',
    sourceId: 'synthetic-mammalian-elbow-v0',
    sourceSchema: 'wrong.schema',
  });

  const detachedRoot = join(root, 'detached-process-root');
  const detachedDescriptor = createAnalyticalElbowDescriptor();
  detachedDescriptor.segments
    .find(segment => segment.id === 'ulna')
    .processes.find(process => process.id === 'olecranon-process')
    .localStart = [4, -0.14, 0];
  await assert.rejects(
    writeAnalyticalElbowWitness({
      outDir: detachedRoot,
      descriptor: detachedDescriptor,
    }),
    /skeletal process olecranon-process root is detached from owning bone ulna/,
  );
  const detachedFailureReport = JSON.parse(
    await readFile(join(detachedRoot, 'report.json'), 'utf8'),
  );
  assert.equal(detachedFailureReport.status, 'failed');
  assert.equal(detachedFailureReport.failurePhase, 'solve-consumer-export');
  assert.equal(detachedFailureReport.route.effective, null);

  const blockedOutputRoot = join(root, 'blocked-output');
  await writeFile(blockedOutputRoot, 'blocks directory creation');
  let prepareError = null;
  try {
    await writeAnalyticalElbowWitness({
      outDir: blockedOutputRoot,
      descriptor: createAnalyticalElbowDescriptor(),
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
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('analytical elbow witness contracts passed');
