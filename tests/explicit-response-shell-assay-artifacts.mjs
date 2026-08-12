import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import * as shellArtifacts from '../explicit-response-shell-assay-artifacts.mjs';

const execFileAsync = promisify(execFile);
const runnerPath = new URL(
  '../scripts/run-explicit-response-shell-assay.mjs',
  import.meta.url,
).pathname;

const assayCard = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/explicit-response-shell-assay.v0.json', import.meta.url),
  'utf8',
));
const target = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/overlapping-hindquarter-tissue-target.v0.json', import.meta.url),
  'utf8',
));

async function withTemporaryDirectory(callback) {
  const outDir = await mkdtemp(join(tmpdir(), 'explicit-response-shell-assay-'));
  try {
    return await callback(outDir);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

function writerArguments(outDir, overrides = {}) {
  return {
    outDir,
    assayCard: structuredClone(assayCard),
    target: structuredClone(target),
    requestedAssayCardPath: 'fixtures/analytical-tissue/explicit-response-shell-assay.v0.json',
    requestedTargetPath: 'fixtures/analytical-tissue/overlapping-hindquarter-tissue-target.v0.json',
    ...overrides,
  };
}

test('explicit shell writer publishes candidate-complete hashed 3D and 2D evidence', async () => {
  assert.equal(
    typeof shellArtifacts.writeExplicitResponseShellArtifacts,
    'function',
    'the explicit response-shell artifact writer is required',
  );
  await withTemporaryDirectory(async (outDir) => {
    const result = await shellArtifacts.writeExplicitResponseShellArtifacts(
      writerArguments(outDir),
    );
    assert.equal(result.report.status, 'completed');
    assert.match(result.report.generationId, /^[0-9a-f-]{36}$/);
    assert.equal(result.report.effectiveRouteId, 'bounded-hindquarter-explicit-response-shell-v0');
    assert.equal(
      result.report.effectiveCompilerId,
      'fixed-topology-elliptical-station-response-shell-v0',
    );
    assert.equal(result.report.evidencePassed, true);
    assert.equal(result.report.hypothesisPassed, true);
    assert.equal(
      result.report.effectiveObservation.cameraId,
      'right-sagittal-boundary-observation-v0:global-sweep-v0',
    );
    assert.equal(result.report.outputs.length, 23);
    assert.equal(
      result.report.outputs.filter((entry) => entry.relativePath.endsWith('.obj')).length,
      21,
    );
    assert.ok(result.report.outputs.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)));

    const serialized = JSON.parse(await readFile(join(outDir, 'assay.json'), 'utf8'));
    assert.equal(serialized.generationId, result.report.generationId);
    assert.equal(serialized.construction.combinedTargetReadCount, 0);
    assert.equal(serialized.evaluation.heldOutFields[0], 'combined');
    assert.deepEqual(serialized.presentation, result.report.effectiveObservation);
    assert.deepEqual(Object.keys(serialized.presentation.projectedBounds), [
      'horizontal',
      'vertical',
    ]);
    assert.deepEqual(Object.keys(serialized.presentation.sectionBounds), [
      'right',
      'dorsal',
    ]);
    assert.ok(Object.values(serialized.candidate.compiledStates).every(
      (state) => state.mesh.vertices === undefined && state.mesh.outputRef,
    ));
    assert.ok(Object.values(serialized.evaluation.referenceStates).every(
      (state) => state.mesh.vertices === undefined && state.mesh.outputRef,
    ));

    const svg = await readFile(join(outDir, 'contact-sheet.svg'), 'utf8');
    assert.match(svg, /Fixed-topology explicit response shell/);
    assert.match(svg, /combined held out from construction/);
    assert.match(svg, /source-row response null: independent response missing/);
    assert.match(svg, /carrier coupling not exercised/);
    assert.match(svg, /full-surface 3D primary plus mesh-derived sections/);
    const cameraOccurrences = svg.match(new RegExp(
      `data-camera-id="${result.report.effectiveObservation.cameraId}"`,
      'g',
    )) ?? [];
    assert.equal(cameraOccurrences.length, 9);
    const projectedBounds = svg.match(/data-projected-bounds="[^"]+"/g) ?? [];
    assert.equal(projectedBounds.length, 9);
    assert.equal(new Set(projectedBounds).size, 1);
    const sectionBounds = svg.match(/data-section-bounds="[^"]+"/g) ?? [];
    assert.equal(sectionBounds.length, 9);
    assert.equal(new Set(sectionBounds).size, 1);
    assert.match(svg, new RegExp(result.report.generationId));
    assert.match(svg, new RegExp(result.assay.assayHash));
  });
});

test('failed explicit shell reruns replace prior success presentation with current tombstones', async () => {
  await withTemporaryDirectory(async (outDir) => {
    const success = await shellArtifacts.writeExplicitResponseShellArtifacts(
      writerArguments(outDir),
    );
    const counterfeit = structuredClone(assayCard);
    counterfeit.construction.radialSegments = 32;
    await assert.rejects(
      shellArtifacts.writeExplicitResponseShellArtifacts(writerArguments(outDir, {
        assayCard: counterfeit,
      })),
      /assay card identity|radialSegments|authoritative/,
    );
    const failedReport = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
    const failedAssay = JSON.parse(await readFile(join(outDir, 'assay.json'), 'utf8'));
    const failedSvg = await readFile(join(outDir, 'contact-sheet.svg'), 'utf8');
    assert.equal(failedReport.status, 'failed');
    assert.equal(failedReport.failurePhase, 'input-validation');
    assert.deepEqual(failedReport.outputs, []);
    assert.notEqual(failedReport.generationId, success.report.generationId);
    assert.equal(failedAssay.generationId, failedReport.generationId);
    assert.match(failedSvg, /EXPLICIT SHELL ASSAY FAILED/);
    assert.match(failedSvg, new RegExp(failedReport.generationId));
    assert.doesNotMatch(failedSvg, /Fixed-topology explicit response shell/);
  });
});

test('explicit shell CLI preserves an input-read failure after a prior success', async () => {
  await withTemporaryDirectory(async (outDir) => {
    const success = await shellArtifacts.writeExplicitResponseShellArtifacts(
      writerArguments(outDir),
    );
    await assert.rejects(
      execFileAsync(process.execPath, [
        runnerPath,
        '--out', outDir,
        '--assay-card', join(outDir, 'missing-assay-card.json'),
      ]),
      /ENOENT/,
    );
    const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
    const assay = JSON.parse(await readFile(join(outDir, 'assay.json'), 'utf8'));
    const svg = await readFile(join(outDir, 'contact-sheet.svg'), 'utf8');
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'input-read');
    assert.deepEqual(report.outputs, []);
    assert.notEqual(report.generationId, success.report.generationId);
    assert.equal(assay.generationId, report.generationId);
    assert.match(svg, /EXPLICIT SHELL ASSAY FAILED/);
    assert.match(svg, /ENOENT/);
    assert.match(svg, new RegExp(report.generationId));
    assert.doesNotMatch(svg, /Fixed-topology explicit response shell/);
  });
});
