import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  applyRingCageSectionVolumeRestoration,
  measureMuscleCompartmentRingCageContactState,
} from '../muscle-compartment-ring-cage-contact-core.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TOOL = path.join(
  REPO_ROOT,
  'tools/run-current-k4-m12-volume-restoration-solve-assay.mjs',
);
const CONFIG = path.join(
  REPO_ROOT,
  'fixtures/current-k4-packing/current-k4-m12-volume-restoration-solve-v0.json',
);
const FRONTIER = path.join(
  REPO_ROOT,
  'artifacts/current-k4-ring-cage-contact-normal-ramp-frontier-v0/frontier-result.json',
);
const SOURCE = path.join(
  REPO_ROOT,
  'artifacts/current-k4-fixed-contact-assay-v0/contact-admitted-source.json',
);
const CARRIER = path.join(
  REPO_ROOT,
  'artifacts/current-k4-curvature-contact-volume-bound-assay-v0/packed-carrier.json',
);

async function loadJson(target) {
  return JSON.parse(await readFile(target, 'utf8'));
}

function m12SectionIds(carrier) {
  const cage = carrier.cages.find(row => row.constructionId === 'muscle-12');
  const ids = new Set();
  for (const node of cage.manifest.nodes) {
    const match = /^(muscle-12:section:\d+)/.exec(node.id);
    if (match) ids.add(match[1]);
  }
  return [...ids].sort();
}

test('volume restoration moves muscle-12 toward its rest volume without touching custody', async () => {
  const carrier = await loadJson(CARRIER);
  const source = await loadJson(SOURCE);
  const before = measureMuscleCompartmentRingCageContactState(carrier, source);
  const m12Before = before.cages.find(cage => cage.constructionId === 'muscle-12');
  assert.ok(m12Before.relativeVolumeError > 0.0149, 'fixture lost its ceiling premise');

  const restoration = applyRingCageSectionVolumeRestoration(carrier, {
    constructionId: 'muscle-12',
    compressionSectionIds: m12SectionIds(carrier)
      .filter(id => !restorationFixed(carrier, id)),
    targetRelativeVolumeError: 0.005,
    maximumSectionAreaScaleReduction: 0.85,
    volumeRelativeTolerance: 1e-10,
  });
  assert.equal(restoration.status, 'completed');
  assert.equal(restoration.fixedNodeMaximumDrift, 0);
  assert.equal(restoration.centerlineMaximumDrift, 0);
  assert.equal(restoration.nonPositiveCellCount, 0);
  assert.ok(restoration.effectiveSectionAreaScale < 1);
  assert.ok(restoration.effectiveSectionAreaScale >= 0.85);
  assert.equal(restoration.sourceCarrierSha256, carrier.identity.sha256);
  assert.equal(
    restoration.outputCarrierSha256,
    restoration.outputCarrier.identity.sha256,
  );

  const after = measureMuscleCompartmentRingCageContactState(
    restoration.outputCarrier,
    source,
  );
  const m12After = after.cages.find(cage => cage.constructionId === 'muscle-12');
  assert.ok(Math.abs(m12After.relativeVolumeError - 0.005) < 1e-6,
    `restored error ${m12After.relativeVolumeError} misses target`);
  // Other cages are untouched.
  for (const cage of after.cages) {
    if (cage.constructionId === 'muscle-12') continue;
    const reference = before.cages.find(row => row.cageId === cage.cageId);
    assert.equal(cage.relativeVolumeError, reference.relativeVolumeError);
  }
});

function restorationFixed(carrier, sectionId) {
  const cage = carrier.cages.find(row => row.constructionId === 'muscle-12');
  const fixed = new Set((cage.manifest.constraints?.boundaryMasks || [])
    .filter(mask => mask.fixed === true)
    .map(mask => mask.nodeId));
  return cage.manifest.nodes.some(node =>
    node.id.startsWith(`${sectionId}:`) && fixed.has(node.id));
}

test('volume restoration refuses an unreachable target instead of silently clamping', async () => {
  const carrier = await loadJson(CARRIER);
  assert.throws(() => applyRingCageSectionVolumeRestoration(carrier, {
    constructionId: 'muscle-12',
    compressionSectionIds: m12SectionIds(carrier)
      .filter(id => !restorationFixed(carrier, id)).slice(0, 1),
    targetRelativeVolumeError: 0.0001,
    maximumSectionAreaScaleReduction: 0.995,
    volumeRelativeTolerance: 1e-10,
  }), /insufficient-compression-authority/);
});

test('volume restoration refuses a carrier already within target', async () => {
  const carrier = await loadJson(CARRIER);
  assert.throws(() => applyRingCageSectionVolumeRestoration(carrier, {
    constructionId: 'muscle-12',
    compressionSectionIds: m12SectionIds(carrier)
      .filter(id => !restorationFixed(carrier, id)),
    targetRelativeVolumeError: 0.5,
    maximumSectionAreaScaleReduction: 0.85,
    volumeRelativeTolerance: 1e-10,
  }), /already-within-target/);
});

test('the restoration solve assay runs every requested seed-target row uncapped', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-m12restore-'));
  const config = await loadJson(CONFIG);
  config.solver.maxIterations = 2;
  const configPath = path.join(root, 'input', 'short-config.json');
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config));
  const output = path.join(root, 'out');
  const result = spawnSync(process.execPath, [
    TOOL,
    '--frontier', FRONTIER,
    '--source', SOURCE,
    '--config', configPath,
    '--output', output,
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = await loadJson(path.join(output, 'run-report.json'));
  const assay = await loadJson(path.join(output, 'assay-result.json'));
  const expectedCount =
    (config.seedCandidateIds.length + (config.includeReferenceControl ? 1 : 0)) *
    config.restoration.targetRelativeVolumeErrors.length;
  assert.equal(report.status, 'completed');
  assert.equal(report.requestedCandidateCount, expectedCount);
  assert.equal(report.effectiveCandidateCount, expectedCount);
  assert.equal(report.candidateCapApplied, false);
  assert.equal(assay.candidates.length, expectedCount);
  for (const row of assay.candidates) {
    if (row.status === 'application-refused') {
      assert.ok(row.error);
      continue;
    }
    const receipt = await loadJson(path.join(output, row.solveApplication.path));
    // Chain: seed -> restoration -> solve.
    assert.equal(receipt.restoration.sourceCarrierSha256, row.metrics.seedCarrierSha256);
    assert.equal(receipt.solve.sourceCarrierSha256,
      receipt.restoration.outputCarrierSha256);
    assert.ok(Number.isInteger(row.metrics.iterationsAccepted));
    assert.equal(row.metrics.fixedNodeMaximumDrift, 0);
  }
  const admissible = assay.candidates.filter(row => row.status === 'admissible');
  const admissibleIds = new Set(admissible.map(row => row.id));
  assert.ok(assay.nondominatedCandidateIds.every(id => admissibleIds.has(id)));
});

test('an assay parse failure clears only owned stale evidence and remains durable', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'kaminos-k4-m12restore-fail-'));
  await writeFile(
    path.join(output, '.kaminos-current-k4-m12-volume-restoration-solve-output'),
    'kaminos.current-k4-m12-volume-restoration-solve-output-custody.v0\n',
  );
  await writeFile(path.join(output, 'assay-result.json'), '{"status":"stale"}\n');
  const result = spawnSync(process.execPath, [
    TOOL,
    '--output', output,
    '--unsupported', 'value',
  ], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const report = await loadJson(path.join(output, 'run-report.json'));
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'parse-arguments');
  assert.equal(report.outputCustodyVerified, true);
  await assert.rejects(readFile(path.join(output, 'assay-result.json')), /ENOENT/);
});
