import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_REPORT_SCHEMA,
  MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_REQUEST_SCHEMA,
  admitMuscleCompartmentPackingSensitivityVisualInspection,
  deriveMuscleCompartmentPackingSensitivitySource,
  writeMuscleCompartmentPackingSensitivityAssay,
} from '../muscle-compartment-packing-sensitivity.mjs';
import {
  createSyntheticMuscleDensityLadder,
  solveMuscleCompartmentPacking,
} from '../muscle-compartment-packing-core.mjs';

const exactSolver = Object.freeze({
  maxIterations: 1,
  relaxationStep: 0.35,
  smoothnessStep: 0.035,
  sampleCount: 25,
  convergenceTolerance: 1e-7,
  pairwiseUpdate: 'reciprocal-batched',
  pairwiseCoordinate: 'source-normal',
  crossSectionUpdate: 'contact-redistributed',
  crossSectionStep: 0.02,
  curvatureUpdate: 'source-sign-halfspace',
  maximumSourceBendEnergyRatio: 1.05,
  minimumSourceCurvatureCosine: 0.3,
  minimumSourceTangentCosine: 0,
});
const execFileAsync = promisify(execFile);
const visualEvidence = Object.freeze({
  nonblank:true,
  statesDistinct:true,
  stableMuscleIdentityLegible:true,
  attachmentAndObstacleLegible:true,
  displacementLegible:true,
  metricsAndSolveStatusLegible:true,
  residualBearingOutputNotPresentedAsAdmission:true,
});
const visualJudgment = Object.freeze({
  sourceFormationPlausible:false,
  packedRelationshipsPlausible:false,
  skeletalClearanceVisuallyPlausible:true,
  pairwiseExclusionVisuallyPlausible:true,
  shapeDegeneracyAbsent:false,
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function radialDistanceFromYAxis(point) {
  return Math.hypot(point[0], point[2]);
}

test('sensitivity derivations preserve the parent and separate attachment, volume, and density authority', () => {
  const source = createSyntheticMuscleDensityLadder(8);
  const parentSnapshot = JSON.stringify(source);

  const attachment = deriveMuscleCompartmentPackingSensitivitySource(source, {
    axis: 'attachment-radial-scale',
    obstacleId: 'central-skeletal-shaft',
    scaleFactor: 1.1,
  });
  assert.equal(JSON.stringify(source), parentSnapshot, 'derivation cannot mutate the parent source');
  assert.equal(attachment.receipt.axis, 'attachment-radial-scale');
  assert.deepEqual(attachment.receipt.requested, attachment.receipt.effective);
  assert.equal(attachment.receipt.fallbackUsed, false);
  for (const [index, muscle] of attachment.source.muscles.entries()) {
    assert.ok(Math.abs(radialDistanceFromYAxis(muscle.attachments.origin.position) - 0.55) < 1e-12);
    assert.ok(Math.abs(radialDistanceFromYAxis(muscle.attachments.insertion.position) - 0.55) < 1e-12);
    assert.deepEqual(muscle.centerline[1], source.muscles[index].centerline[1]);
    assert.equal(muscle.targetVolume, source.muscles[index].targetVolume);
    assert.deepEqual(muscle.identity, source.muscles[index].identity);
  }

  const volume = deriveMuscleCompartmentPackingSensitivitySource(source, {
    axis: 'volume-cross-section-scale',
    factor: 0.9,
  });
  assert.equal(volume.receipt.axis, 'volume-cross-section-scale');
  assert.deepEqual(volume.source.muscles[0].attachments, source.muscles[0].attachments);
  assert.deepEqual(
    volume.source.muscles[0].centerline.map(knot => knot.position),
    source.muscles[0].centerline.map(knot => knot.position),
  );
  assert.ok(
    Math.abs(
      volume.source.muscles[0].centerline[1].radius -
      source.muscles[0].centerline[1].radius * Math.sqrt(0.9),
    ) < 1e-12,
  );
  assert.ok(
    Math.abs(volume.source.muscles[0].targetVolume - source.muscles[0].targetVolume * 0.9) < 1e-12,
  );

  const selectedIds = source.muscles.slice(0, 4).map(muscle => muscle.id);
  const density = deriveMuscleCompartmentPackingSensitivitySource(source, {
    axis: 'selected-muscle-ids',
    muscleIds: selectedIds,
  });
  assert.deepEqual(density.source.muscles.map(muscle => muscle.id), selectedIds);
  assert.deepEqual(
    density.source.muscles.map(muscle => muscle.identity),
    source.muscles.slice(0, 4).map(muscle => muscle.identity),
  );
  assert.notEqual(attachment.source.input.effective.sha256, volume.source.input.effective.sha256);
  assert.notEqual(volume.source.input.effective.sha256, density.source.input.effective.sha256);
  assert.match(attachment.source.input.effective.sha256, /^[a-f0-9]{64}$/);
});

test('clearance-converged attachment spread cannot erase curvature magnitude or fold longitudinal order', () => {
  const source = deriveMuscleCompartmentPackingSensitivitySource(
    createSyntheticMuscleDensityLadder(8),
    {
      axis:'attachment-radial-scale',
      obstacleId:'central-skeletal-shaft',
      scaleFactor:1.1,
    },
  ).source;
  const result = solveMuscleCompartmentPacking(source, {
    maxIterations:820,
    relaxationStep:0.35,
    smoothnessStep:0.035,
    sampleCount:25,
    convergenceTolerance:1e-7,
    pairwiseUpdate:'reciprocal-batched',
    pairwiseCoordinate:'source-normal',
    crossSectionUpdate:'contact-redistributed',
    crossSectionStep:0.02,
    curvatureUpdate:'source-sign-halfspace',
    maximumSourceBendEnergyRatio:1.05,
    minimumSourceCurvatureCosine:0.3,
    minimumSourceTangentCosine:0,
  });

  assert.equal(result.metrics.packed.pairwisePenetration <= 1e-7, true);
  assert.equal(result.status, 'source-formation-failed');
  assert.equal(result.failure?.kind, 'source-formation-constraint');
  assert.ok(result.metrics.packed.maximumBendEnergy > result.metrics.initial.maximumBendEnergy * 1.05);
  assert.ok(result.metrics.packed.minimumSourceCurvatureCosine < 0.3);
  assert.ok(result.metrics.packed.sourceTangentReversalCount > 0);
  assert.equal(result.failure?.dominantMechanism?.kind, 'source-longitudinal-fold');
});

test('assay writes residual-bearing geometry beside exact receipts without mutating source bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'muscle-packing-sensitivity-'));
  const source = createSyntheticMuscleDensityLadder(8);
  const sourceBytes = Buffer.from(`${JSON.stringify(source, null, 2)}\n`);
  const sourcePath = join(root, 'source.json');
  const requestPath = join(root, 'request.json');
  const outDir = join(root, 'out');
  const reportPath = join(root, 'assay-report.json');
  await writeFile(sourcePath, sourceBytes);
  const request = {
    schema: MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_REQUEST_SCHEMA,
    id: 'fail-first-visual-assay',
    variants: [{
      id: 'attachment-110',
      derivation: {
        axis: 'attachment-radial-scale',
        obstacleId: 'central-skeletal-shaft',
        scaleFactor: 1.1,
      },
      solverConfig: exactSolver,
    }],
  };
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);

  const written = await writeMuscleCompartmentPackingSensitivityAssay({
    outDir,
    reportPath,
    sourcePath,
    requestPath,
    receiptRoot:root,
  });

  assert.equal(written.report.schema, MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_REPORT_SCHEMA);
  assert.equal(written.report.status, 'complete');
  assert.deepEqual(written.report.input.source.requested, {
    path: 'repo://source.json',
    sha256: written.report.input.source.effective.sha256,
  });
  assert.equal(written.report.input.source.effective.path, 'repo://source.json');
  assert.equal(written.report.input.request.effective.path, 'repo://request.json');
  assert.equal(written.report.input.source.mutated, false);
  assert.equal(written.report.variants.length, 1);
  assert.notEqual(written.report.variants[0].solve.status, 'converged');
  assert.deepEqual(written.report.variants[0].solve.requestedConfig, exactSolver);
  assert.deepEqual(written.report.variants[0].solve.effectiveConfig, exactSolver);
  assert.equal(written.report.variants[0].solve.fallbackUsed, false);
  assert.deepEqual(written.report.variants[0].route, {
    requested:'muscle-compartment-packing-sensitivity-orbitable-v0',
    effective:'muscle-compartment-packing-sensitivity-orbitable-v0',
    fallbackUsed:false,
  });
  assert.equal(written.report.variants[0].visual.role, 'diagnostic-not-admission');
  assert.equal(written.report.variants[0].visual.route.requested, 'muscle-compartment-packing-sensitivity-orbitable-v0');
  assert.equal(written.report.variants[0].visual.route.effective, 'muscle-compartment-packing-sensitivity-orbitable-v0');
  assert.equal(written.report.variants[0].visual.status, 'pending-agent-inspection');
  const variantRoot = join(outDir, written.report.run.id, 'attachment-110');
  const html = await readFile(join(variantRoot, 'index.html'), 'utf8');
  assert.match(html, /Residual-bearing output/);
  assert.match(html, /diagnostic, not packing admission/i);
  assert.match(html, new RegExp(written.report.variants[0].solve.status));
  assert.deepEqual(await readFile(sourcePath), sourceBytes);
  assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).status, 'complete');
});

test('source identity mismatch fails before primary visual output and still writes the requested report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'muscle-packing-sensitivity-failure-'));
  const sourcePath = join(root, 'source.json');
  const requestPath = join(root, 'request.json');
  const outDir = join(root, 'out');
  const reportPath = join(root, 'terminal-report.json');
  await writeFile(sourcePath, `${JSON.stringify(createSyntheticMuscleDensityLadder(8))}\n`);
  await mkdir(outDir);
  await writeFile(join(outDir, 'index.html'), 'stale-success-portfolio');
  await writeFile(requestPath, `${JSON.stringify({
    schema: MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_REQUEST_SCHEMA,
    id: 'identity-mismatch',
    expectedSourceSha256: '0'.repeat(64),
    variants: [],
  })}\n`);

  await assert.rejects(
    () => writeMuscleCompartmentPackingSensitivityAssay({
      outDir,
      reportPath,
      sourcePath,
      requestPath,
    }),
    /source sha-256 mismatch/i,
  );
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'validate-source-identity');
  assert.equal(report.route.effective, null);
  await assert.rejects(() => readFile(join(outDir, 'index.html')), /ENOENT/);
});

test('path preflight refuses report or portfolio aliases without overwriting protected inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'muscle-packing-sensitivity-alias-'));
  const source = createSyntheticMuscleDensityLadder(8);
  const sourceBytes = Buffer.from(`${JSON.stringify(source, null, 2)}\n`);
  const sourcePath = join(root, 'source.json');
  const requestPath = join(root, 'request.json');
  await writeFile(sourcePath, sourceBytes);
  await writeFile(requestPath, `${JSON.stringify({
    schema:MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_REQUEST_SCHEMA,
    id:'path-alias-refusal',
    variants:[{
      id:'attachment-100',
      derivation:{
        axis:'attachment-radial-scale',
        obstacleId:'central-skeletal-shaft',
        scaleFactor:1,
      },
      solverConfig:exactSolver,
    }],
  })}\n`);

  let reportAliasError = null;
  try {
    await writeMuscleCompartmentPackingSensitivityAssay({
      outDir:join(root, 'output'),
      reportPath:sourcePath,
      sourcePath,
      requestPath,
    });
  } catch (error) {
    reportAliasError = error;
  }
  assert.match(reportAliasError?.message || '', /report path.*alias.*protected input/i);
  assert.notEqual(reportAliasError.failureReportPath, sourcePath);
  assert.deepEqual(await readFile(sourcePath), sourceBytes);
  assert.equal(JSON.parse(await readFile(reportAliasError.failureReportPath, 'utf8')).failurePhase, 'validate-path-custody');

  const portfolioSourcePath = join(root, 'portfolio-output', 'index.html');
  await mkdir(join(root, 'portfolio-output'));
  await writeFile(portfolioSourcePath, sourceBytes);
  await assert.rejects(
    () => writeMuscleCompartmentPackingSensitivityAssay({
      outDir:join(root, 'portfolio-output'),
      reportPath:join(root, 'portfolio-terminal.json'),
      sourcePath:portfolioSourcePath,
      requestPath,
    }),
    /portfolio path.*alias.*protected input/i,
  );
  assert.deepEqual(await readFile(portfolioSourcePath), sourceBytes);
});

test('CLI keeps source, invocation request, visual root, and terminal report as explicit paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'muscle-packing-sensitivity-cli-'));
  const sourcePath = join(root, 'immutable-source.json');
  const requestPath = join(root, 'invocation-request.json');
  const outDir = join(root, 'visual-output');
  const reportPath = join(root, 'persistent-terminal-report.json');
  await writeFile(sourcePath, `${JSON.stringify(createSyntheticMuscleDensityLadder(8), null, 2)}\n`);
  await writeFile(requestPath, `${JSON.stringify({
    schema:MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_REQUEST_SCHEMA,
    id:'cli-path-contract',
    variants:[{
      id:'volume-090',
      derivation:{ axis:'volume-cross-section-scale', factor:0.9 },
      solverConfig:exactSolver,
    }],
  }, null, 2)}\n`);

  const { stdout } = await execFileAsync(process.execPath, [
    'tools/run-muscle-compartment-packing-sensitivity.mjs',
    '--source', sourcePath,
    '--request', requestPath,
    '--out', outDir,
    '--report', reportPath,
  ], { cwd:resolveProjectRoot(), maxBuffer:2_000_000 });
  const summary = JSON.parse(stdout);
  assert.equal(summary.status, 'complete');
  assert.equal(summary.outputRoot, outDir);
  assert.equal(summary.reportPath, reportPath);
  assert.equal(summary.source.effective.path, sourcePath);
  assert.equal(summary.variants[0].solveStatus, 'pairwise-exclusion-failed');
  assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).route.fallbackUsed, false);
});

function resolveProjectRoot() {
  return new URL('..', import.meta.url).pathname.replace(/\/$/, '');
}

test('visual inspection binds every variant state and its independent capture receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'muscle-packing-sensitivity-inspection-'));
  const sourcePath = join(root, 'source.json');
  const requestPath = join(root, 'request.json');
  const outDir = join(root, 'visual-output');
  const reportPath = join(root, 'report.json');
  await writeFile(sourcePath, `${JSON.stringify(createSyntheticMuscleDensityLadder(8), null, 2)}\n`);
  await writeFile(requestPath, `${JSON.stringify({
    schema:MUSCLE_COMPARTMENT_PACKING_SENSITIVITY_REQUEST_SCHEMA,
    id:'visual-inspection-contract',
    variants:[{
      id:'attachment-110',
      derivation:{
        axis:'attachment-radial-scale',
        obstacleId:'central-skeletal-shaft',
        scaleFactor:1.1,
      },
      solverConfig:exactSolver,
    }],
  }, null, 2)}\n`);
  const assay = await writeMuscleCompartmentPackingSensitivityAssay({
    outDir,
    reportPath,
    sourcePath,
    requestPath,
  });
  const variantRoot = join(outDir, assay.report.variants[0].artifacts.relativeRoot);
  const images = [];
  for (const state of ['before', 'packed']) {
    const bytes = Buffer.from(`${state}-distinct-pixels`);
    const imagePath = join(variantRoot, `${state}.png`);
    const captureReportPath = join(variantRoot, `capture-${state}-report.json`);
    await writeFile(imagePath, bytes);
    await writeFile(captureReportPath, `${JSON.stringify({
      schema:'kaminos.receipt-bearing-browser-capture.v0',
      status:'complete',
      route:{
        requested:'independent-headless-screenshot-v0',
        effective:'independent-headless-screenshot-v0',
        fallbackUsed:false,
      },
      browser:{ effective:{ installedStableChrome:false } },
      invocation:{
        url:`http://127.0.0.1:8765/visual-output/${assay.report.variants[0].artifacts.relativeRoot}/?state=${state}`,
      },
      process:{
        cleanup:{ groupPresentAfter:false },
        profileCleanup:{ status:'complete-removed' },
      },
      stderr:{ truncated:false, tail:'' },
      primaryOutput:{
        sha256:sha256(bytes),
        sizeBytes:bytes.length,
        png:{ width:1400, height:900 },
      },
    })}\n`);
    images.push({
      state,
      path:`${assay.report.variants[0].artifacts.relativeRoot}/${state}.png`,
      captureReport:`${assay.report.variants[0].artifacts.relativeRoot}/capture-${state}-report.json`,
    });
  }
  const receiptPath = join(outDir, 'visual-inspection.json');
  const inspection = {
    observedAt:'2026-08-04T20:00:00Z',
    url:'http://127.0.0.1:8765/visual-output/',
    variants:[{
      id:'attachment-110',
      images,
      evidence:visualEvidence,
      judgment:visualJudgment,
      disposition:'visually-rejected',
    }],
  };
  const beforeCaptureReportPath = join(outDir, images[0].captureReport);
  const beforeCaptureReport = JSON.parse(await readFile(beforeCaptureReportPath, 'utf8'));
  const expectedBeforeUrl = beforeCaptureReport.invocation.url;
  beforeCaptureReport.invocation.url = 'http://127.0.0.1:8765/stale-route/?state=before';
  await writeFile(beforeCaptureReportPath, `${JSON.stringify(beforeCaptureReport)}\n`);
  await assert.rejects(
    () => admitMuscleCompartmentPackingSensitivityVisualInspection({
      outDir,
      reportPath,
      receiptPath,
      inspection,
    }),
    /capture receipt is incomplete or mismatched/i,
  );
  beforeCaptureReport.invocation.url = expectedBeforeUrl;
  await writeFile(beforeCaptureReportPath, `${JSON.stringify(beforeCaptureReport)}\n`);
  const variantHtmlPath = join(variantRoot, 'index.html');
  const variantHtml = await readFile(variantHtmlPath);
  await writeFile(variantHtmlPath, Buffer.concat([variantHtml, Buffer.from('\nstale-artifact') ]));
  await assert.rejects(
    () => admitMuscleCompartmentPackingSensitivityVisualInspection({
      outDir,
      reportPath,
      receiptPath,
      inspection,
    }),
    /artifacts no longer match the assay report/i,
  );
  await writeFile(variantHtmlPath, variantHtml);
  const admitted = await admitMuscleCompartmentPackingSensitivityVisualInspection({
    outDir,
    reportPath,
    receiptPath,
    inspection,
  });
  assert.equal(admitted.report.visualInspection.status, 'completed-agent-inspection');
  assert.equal(admitted.report.visualInspection.disposition, 'visually-rejected');
  assert.equal(admitted.receipt.status, 'completed-agent-inspection');
  assert.equal(admitted.receipt.disposition, 'visually-rejected');
  assert.equal(admitted.receipt.variants.length, 1);
  assert.equal(admitted.receipt.variants[0].judgment.sourceFormationPlausible, false);
  assert.equal(
    admitted.report.variants[0].visualInspection.disposition,
    'visually-rejected',
  );
  assert.match(await readFile(join(outDir, 'index.html'), 'utf8'), /visually-rejected/);
  assert.equal(admitted.receipt.variants[0].images.length, 2);
  assert.notEqual(
    admitted.receipt.variants[0].images[0].sha256,
    admitted.receipt.variants[0].images[1].sha256,
  );
  assert.ok(admitted.receipt.variants[0].images.every(image =>
    image.capture.route.effective === 'independent-headless-screenshot-v0' &&
    image.capture.fallbackUsed === false,
  ));
  const firstReportBytes = await readFile(reportPath);
  const firstReceiptBytes = await readFile(receiptPath);
  await admitMuscleCompartmentPackingSensitivityVisualInspection({
    outDir,
    reportPath,
    receiptPath,
    inspection,
  });
  assert.deepEqual(await readFile(reportPath), firstReportBytes);
  assert.deepEqual(await readFile(receiptPath), firstReceiptBytes);
});
