import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as witness from '../nbody-packing-active-row-trajectory-witness.mjs';
import { captureNBodyPackingLocalizedState } from '../nbody-packing-localized-capture.mjs';
import { admitNBodyPackingLocalizedVisualInspection } from
  '../nbody-packing-localized-witness.mjs';

test('elastic all-row comparison exposes a same-camera volumetric witness writer', () => {
  assert.equal(
    typeof witness.writeNBodyPackingElasticAllRowComparatorWitness,
    'function',
    'the architecture comparison requires an operator-legible source/control/comparator viewer',
  );
});

test('localized capture accepts every elastic all-row comparison state', async t => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elastic-viewer-capture-state-'));
  t.after(() => fs.rmSync(outDir, { recursive:true, force:true }));
  for (const state of [
    'step-16-source', 'active-row-control', 'elastic-all-row-comparator',
  ]) {
    const reportPath = path.join(outDir, `${state}.json`);
    await assert.rejects(
      captureNBodyPackingLocalizedState({
        baseUrl:'http://127.0.0.1:1/index.html',
        state,
        mode:'volume',
        outputPath:path.join(outDir, `${state}.png`),
        reportPath,
      }),
      /fetch failed/,
    );
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.failurePhase, 'fetch-source-document');
    assert.equal(report.lastTrustworthyEvidence.state, state);
  }
});

test('elastic all-row visual admission rejects trajectory predicates and requires comparator truth', async t => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elastic-viewer-verdict-'));
  t.after(() => fs.rmSync(outDir, { recursive:true, force:true }));
  await witness.writeNBodyPackingElasticAllRowComparatorWitness({ outDir });
  const inspection = verdict => ({
    observedAt:'2026-08-13T17:20:00Z',
    summary:'Source, strict control, and elastic comparator inspected in volume and slice modes.',
    verdict,
  });
  await assert.rejects(
    admitNBodyPackingLocalizedVisualInspection({
      outDir,
      inspection:inspection({
        nonblank:true,
        orbitable:true,
        sameCameraComparison:true,
        authenticatedAdaptiveBaselineLegible:true,
        activeTrajectoryMotionLegible:true,
        largeRadiusStepsLegible:true,
        endpointAndVolumePreservationLegible:true,
        residualDebtLegible:true,
        manufacturedWitnessAuthorityCeilingLegible:true,
        packingSemanticsNotInverted:true,
      }),
    }),
    /requires exact all-positive agent verdict/,
  );
  await assert.rejects(
    admitNBodyPackingLocalizedVisualInspection({
      outDir,
      inspection:inspection({
        nonblank:true,
        orbitable:true,
        sameCameraComparison:true,
        sharedSourceLegible:true,
        strictControlStasisLegible:true,
        elasticComparatorMotionLegible:true,
        truePositionAndAmplificationDistinct:true,
        endpointAndVolumePreservationLegible:true,
        residualDebtLegible:true,
        equalBudgetAuthorityLegible:true,
        syntheticAuthorityCeilingLegible:true,
        packingSemanticsNotInverted:true,
      }),
    }),
    /ENOENT.*step-16-source-volume\.png/,
  );
});
