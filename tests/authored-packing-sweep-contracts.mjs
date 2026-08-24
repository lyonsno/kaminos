import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  createAuthoredPackingAuthorityProfile,
  measureAuthoredPackingSweepContacts,
  validateAuthoredPackingSweepManifest,
} from '../authored-packing-sweep-core.mjs';
import * as authoredPacking from '../authored-packing-sweep-core.mjs';
import {
  measureMuscleCompartmentRingCageContactResidualLedger,
  measureMuscleCompartmentRingCageContactState,
} from '../muscle-compartment-ring-cage-contact-core.mjs';
import {
  renderMuscleCompartmentRingCageContactHtml,
} from '../muscle-compartment-ring-cage-contact-witness.mjs';
import {
  validateMuscleCompartmentRingCageContactVisualReceipts,
} from '../muscle-compartment-ring-cage-contact-visual-receipts.mjs';

const FIXTURE_URL = new URL(
  '../fixtures/authored-packing/packing-fixture-v001.json',
  import.meta.url,
);

async function fixture() {
  return JSON.parse(await readFile(FIXTURE_URL, 'utf8'));
}

function variant(manifest, role) {
  return Object.values(manifest.variants).find(row => row.role === role);
}

test('authored sweep manifest preserves the effective operator source and fails loud on geometry or route drift', async () => {
  const manifest = await fixture();
  assert.doesNotThrow(() => validateAuthoredPackingSweepManifest(manifest));
  assert.deepEqual(manifest.source.input.effective, manifest.source.input.requested);
  assert.equal(manifest.memberOrder.length, 6);

  const geometryForgery = structuredClone(manifest);
  geometryForgery.variants.clean.members[0].mesh.vertices[0][0] += 0.01;
  assert.throws(
    () => validateAuthoredPackingSweepManifest(geometryForgery),
    /identity does not match effective geometry/,
  );

  const routeForgery = structuredClone(manifest);
  routeForgery.source.input.effective.sha256 = '0'.repeat(64);
  assert.throws(
    () => validateAuthoredPackingSweepManifest(routeForgery),
    /requested\/effective source identities disagree/,
  );
});

test('topology-preserving sweep contact agrees with Blender mesh truth across clean, mild, and severe authored states', async () => {
  const manifest = await fixture();
  const expected = new Map([
    ['clean-reference', { pairwiseIntersectionCount:0, skeletalIntersectionCount:0 }],
    ['mild-interpenetration', { pairwiseIntersectionCount:3, skeletalIntersectionCount:5 }],
    ['severe-interpenetration', { pairwiseIntersectionCount:8, skeletalIntersectionCount:4 }],
  ]);

  for (const [role, counts] of expected) {
    const source = variant(manifest, role);
    const measurement = measureAuthoredPackingSweepContacts({
      manifest,
      variantId:source.id,
    });
    assert.equal(measurement.summary.meshTruthAgreement, true, `${role} contact identities`);
    assert.equal(measurement.summary.pairwiseIntersectionCount, counts.pairwiseIntersectionCount);
    assert.equal(measurement.summary.skeletalIntersectionCount, counts.skeletalIntersectionCount);
    assert.deepEqual(measurement.summary.predictedKeys, measurement.summary.meshTruthKeys);
  }
});

test('restoration and sculpt-continuation share the observed pathology but cannot impersonate one another\'s intent', async () => {
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const restoration = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const continuation = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:mild.id,
    policy:'sculpt-continuation',
  });

  assert.deepEqual(restoration.observedState, continuation.observedState);
  assert.deepEqual(
    restoration.members.map(row => row.observed),
    continuation.members.map(row => row.observed),
  );
  assert.equal(restoration.intentState.variantId, clean.id);
  assert.equal(continuation.intentState.variantId, mild.id);
  assert.deepEqual(
    restoration.members.map(row => row.intent.targetVolume),
    clean.members.map(row => row.meshVolume),
  );
  assert.deepEqual(
    continuation.members.map(row => row.intent.targetVolume),
    mild.members.map(row => row.meshVolume),
  );
  assert.notDeepEqual(
    restoration.members.map(row => row.intent.targetVolume),
    continuation.members.map(row => row.intent.targetVolume),
  );
  assert.notDeepEqual(
    restoration.members.map(row => row.intent.insertion),
    continuation.members.map(row => row.intent.insertion),
  );
  assert.equal(restoration.packingLaw.contact, 'topology-preserving-swept-body-exclusion');
  assert.equal(continuation.packingLaw.centerlinePreference, 'minimum-displacement-from-observed-state');

  assert.throws(
    () => createAuthoredPackingAuthorityProfile({
      manifest,
      observedVariantId:mild.id,
      intentVariantId:clean.id,
      policy:'sculpt-continuation',
    }),
    /current authored state to own both observation and intent/,
  );
});

test('authored intent projects exact observed rings into the existing positive-volume N-body carrier', async () => {
  assert.equal(
    typeof authoredPacking.createAuthoredPackingRingCageBridge,
    'function',
    'authored packing must expose a solver bridge rather than reconstructing circular proxies',
  );
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const authorityProfile = createAuthoredPackingAuthorityProfile({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const bridge = authoredPacking.createAuthoredPackingRingCageBridge({
    manifest,
    authorityProfile,
  });

  assert.equal(bridge.source.authority.kind, 'operator-authored');
  assert.equal(bridge.source.input.effective.kind, 'operator-authored-fixture');
  assert.deepEqual(bridge.observedCarrier.orderedConstructionIds, manifest.memberOrder);
  assert.deepEqual(bridge.solverCarrier.orderedConstructionIds, manifest.memberOrder);
  assert.notEqual(
    bridge.observedCarrier.identity.sha256,
    bridge.solverCarrier.identity.sha256,
    'the exact authored observation must not impersonate endpoint-normalized solver initialization',
  );
  assert.deepEqual(bridge.initialization, {
    schema:'kaminos.authored-packing-solver-initialization.v0',
    observedCarrierSha256:bridge.observedCarrier.identity.sha256,
    initializedCarrierSha256:bridge.solverCarrier.identity.sha256,
    endpointPolicy:'intent-endpoints-observed-interior',
    endpointDisplacements:bridge.initialization.endpointDisplacements,
  });
  assert.ok(bridge.initialization.endpointDisplacements.some(row => row.maximumDisplacement > 0.1));
  for (const [memberIndex, memberId] of manifest.memberOrder.entries()) {
    const observedNodes = new Map(bridge.observedCarrier.cages[memberIndex].manifest.nodes.map(
      node => [node.id, node],
    ));
    const initializedNodes = new Map(bridge.solverCarrier.cages[memberIndex].manifest.nodes.map(
      node => [node.id, node],
    ));
    const lastSection = mild.members[memberIndex].rings.length - 1;
    for (const sectionIndex of [0, lastSection]) {
      const axisId = `${memberId}:section:${String(sectionIndex).padStart(4, '0')}:axis`;
      assert.deepEqual(
        observedNodes.get(axisId).currentPosition,
        mild.members[memberIndex].centerline[sectionIndex].position,
        `${memberId} exact observed endpoint ${sectionIndex}`,
      );
      assert.deepEqual(
        initializedNodes.get(axisId).currentPosition,
        clean.members[memberIndex].centerline[sectionIndex].position,
        `${memberId} initialized endpoint ${sectionIndex}`,
      );
    }
    const interiorSection = Math.floor(lastSection / 2);
    const interiorAxisId = `${memberId}:section:${String(interiorSection).padStart(4, '0')}:axis`;
    assert.deepEqual(
      initializedNodes.get(interiorAxisId).currentPosition,
      mild.members[memberIndex].centerline[interiorSection].position,
      `${memberId} initialized interior remains authored observation`,
    );
  }
  assert.equal(bridge.solverCarrier.cages.length, manifest.memberOrder.length);
  assert.ok(bridge.solverCarrier.cages.every(cage =>
    cage.manifest.nodes.some(node => node.restPosition.some(
      (value, axis) => value !== node.currentPosition[axis],
    ))
  ));
  assert.ok(bridge.solverCarrier.cages.every(cage =>
    cage.manifest.cells.every(cell =>
      cell.restRawSignedVolume * cell.restOrientationParity > 0
    )
  ));
  assert.ok(bridge.solverCarrier.cages.every(cage => {
    const fixed = cage.manifest.constraints.boundaryMasks.filter(row => row.fixed);
    return fixed.length === 18;
  }));

  const measurement = measureMuscleCompartmentRingCageContactState(
    bridge.solverCarrier,
    bridge.source,
  );
  assert.ok(measurement.pairwise.totalPenetration > 0);
  assert.equal(measurement.skeletal.totalPenetration, 0);
  assert.equal(measurement.compartment.maximumEscape, 0);
});

test('accepted authored steps preserve parent, candidate, selected, and exact-contact custody', async () => {
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const assay = authoredPacking.runAuthoredPackingOneStepAssay({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });

  assert.equal(assay.result.iterationHistory.length, 1);
  const accepted = assay.result.iterationHistory[0].acceptedStep;
  assert.equal(accepted.parentCarrierSha256, assay.bridge.solverCarrier.identity.sha256);
  assert.equal(accepted.candidateCarrierSha256, assay.result.packedCarrier.identity.sha256);
  assert.equal(accepted.selectedCarrierSha256, assay.result.packedCarrier.identity.sha256);
  assert.equal(accepted.fixedNodeMaximumDrift, 0);
  assert.equal(accepted.nonPositiveCellCount, 0);
  assert.equal(
    accepted.maximumRelativeVolumeError,
    Math.max(...assay.result.metrics.packed.cages.map(row => row.relativeVolumeError)),
  );
  assert.equal(
    accepted.exactContact.summary.maximumPairwisePenetration,
    assay.exact.packed.summary.maximumPairwisePenetration,
  );
  assert.ok(accepted.exactContact.summary.predictedKeys.length > 0);
  assert.equal(accepted.exactContact.summary.meshTruthKeys, null);
  assert.equal(accepted.exactContact.summary.meshTruthAgreement, null);
  assert.equal(
    accepted.exactContact.source.meshTruthAuthority,
    'unavailable-for-deformed-or-hybrid-candidate',
  );
});

test('one authored N-body step reduces exact pairwise penetration without increasing exact bone or inherited maximum volume debt', async () => {
  assert.equal(
    typeof authoredPacking.runAuthoredPackingOneStepAssay,
    'function',
    'authored packing must expose the admitted one-step solve instead of relying on an ad hoc probe',
  );
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const assay = authoredPacking.runAuthoredPackingOneStepAssay({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });

  assert.equal(assay.result.iterations, 1);
  assert.equal(assay.result.fixedNodeMaximumDrift, 0);
  assert.ok(assay.result.metrics.packed.cages.every(row => row.nonPositiveCellCount === 0));
  assert.ok(
    assay.exact.packed.summary.maximumPairwisePenetration <
      assay.exact.initial.summary.maximumPairwisePenetration,
  );
  assert.ok(
    assay.exact.packed.summary.maximumSkeletalPenetration <=
      assay.exact.initial.summary.maximumSkeletalPenetration + 1e-9,
  );
  const initialMaximumDebt = Math.max(
    ...assay.result.metrics.initial.cages.map(row => row.relativeVolumeError),
  );
  const packedMaximumDebt = Math.max(
    ...assay.result.metrics.packed.cages.map(row => row.relativeVolumeError),
  );
  assert.ok(packedMaximumDebt <= initialMaximumDebt + 1e-6);
  assert.equal(assay.config.maximumRelativeVolumeError, initialMaximumDebt + 1e-6);
});

test('ring-cage witness renders six authored bodies and the exact authored bone without a synthetic capsule', async () => {
  const manifest = await fixture();
  const clean = variant(manifest, 'clean-reference');
  const mild = variant(manifest, 'mild-interpenetration');
  const assay = authoredPacking.runAuthoredPackingOneStepAssay({
    manifest,
    observedVariantId:mild.id,
    intentVariantId:clean.id,
    policy:'restoration-to-reference',
  });
  const residualLedger = measureMuscleCompartmentRingCageContactResidualLedger(
    assay.result.packedCarrier,
    assay.bridge.source,
  );
  const bundleIdentity = {
    sha256:'a'.repeat(64),
    observedCarrierSha256:assay.bridge.observedCarrier.identity.sha256,
    initializedCarrierSha256:assay.bridge.solverCarrier.identity.sha256,
    packedCarrierSha256:assay.result.packedCarrier.identity.sha256,
    residualLedgerSha256:'b'.repeat(64),
  };
  const html = renderMuscleCompartmentRingCageContactHtml({
    observedCarrier:assay.bridge.observedCarrier,
    initializedCarrier:assay.bridge.solverCarrier,
    result:assay.result,
    source:assay.bridge.source,
    route:{ requested:'authored-fixture-one-step-v0', effective:'authored-fixture-one-step-v0' },
    bundleIdentity,
    residualLedger,
    presentation: {
      authorityLabel:'Operator-authored fixture · provisional packing assay',
      authoredBone: {
        positions:mild.bone.mesh.vertices,
        faces:mild.bone.mesh.polygons,
      },
      exactContact:assay.exact,
    },
  });

  assert.match(html, /Operator-authored fixture · provisional packing assay/);
  assert.match(html, /const colors=\[[^\]]+(?:,[^\]]+){5}\]/);
  assert.match(html, /"authoredBone":\{"positions":/);
  assert.match(html, /if\(payload\.authoredBone\)/);
  assert.match(html, /exact authored bone max/);
  assert.match(
    html,
    /sourceBoundaryGhostGroup/,
    'packed view must retain the exact source boundary as a displacement reference',
  );
  assert.match(
    html,
    /displacementGroup\.add\(pressureLine/,
    'packed view must show per-ring source-to-proposal displacement segments',
  );
  assert.match(html, /source boundary \/ ring displacement/);
  assert.match(html, /data-state="observed"/);
  assert.match(html, /data-state="initialized"/);
  assert.match(html, /data-state="packed"/);
  assert.match(html, /data-diagnostic="wireframe"/);
  assert.match(html, /data-diagnostic="source-ghost"/);
  assert.match(html, /data-diagnostic="displacement"/);
  assert.match(html, /data-diagnostic="contacts"/);
  assert.doesNotMatch(
    html,
    /sourceBoundaryGhostGroup\.visible=packed; displacementGroup\.visible=packed; contactGroup\.visible=packed/,
    'changing comparison state must not silently change diagnostic overlays',
  );
  assert.match(html, /exactContactByState/);
  assert.match(html, /stateContactGroups/);
  assert.match(html, /diagnostics\.contacts&&state===currentState/);
  assert.match(html, /viewMode==='contact'/);
  assert.match(
    html,
    /Math\.max\(framingRadius\*\.82,strongestContact\.maximumPenetration\*5\)/,
    'contact focus must retain enough compartment context to keep the intersecting bodies legible',
  );
  assert.match(
    html,
    /stateContactGroups\[state\]\.add\(witnessBeam/,
    'exact contact localization must remain visible at compartment scale instead of relying on one-pixel lines',
  );
  assert.match(
    html,
    /if\(viewMode==='contact'\).*\.material\.opacity=/s,
    'contact focus must reduce surface occlusion without changing comparison geometry',
  );
  assert.match(html, /exact movable pairwise family witness/);
  assert.match(html, /exact skeletal family witness/);
  assert.match(html, /solver init/);
  assert.match(
    html,
    /diagnostic-controls[\s\S]*id="contact-families"[\s\S]*class="metrics"/,
    'contact family identity must remain visible beside the contact controls instead of below the scroll-heavy metric ledger',
  );
  assert.match(html, /strongest → /);
});

test('authored trajectory runner writes a failure report and no primary artifacts when source identity is unavailable', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-authored-packing-failure-'));
  try {
    const runner = fileURLToPath(new URL(
      '../tools/run-authored-packing-trajectory-assay.mjs',
      import.meta.url,
    ));
    const missingManifest = path.join(output, 'missing-manifest.json');
    const staleArtifacts = [
      'assay-result.json',
      'index.html',
      'capture-route-verification.json',
      'source-crowded.png',
      'source-crowded-report.json',
      'contact-relieved.png',
      'contact-relieved-report.json',
    ];
    for (const relative of staleArtifacts) {
      await writeFile(path.join(output, relative), 'stale prior generation');
    }
    await writeFile(path.join(output, 'run-report.json'), JSON.stringify({
      status:'completed',
      generation:'stale-prior-generation',
    }));
    const result = spawnSync(process.execPath, [
      runner,
      '--manifest', missingManifest,
      '--output', output,
    ], {
      cwd:fileURLToPath(new URL('..', import.meta.url)),
      encoding:'utf8',
    });
    assert.notEqual(result.status, 0);
    const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    assert.equal(report.failurePhase, 'read-manifest');
    assert.equal(report.outputs, null);
    assert.match(report.generation, /^[a-f0-9]{64}$/);
    assert.deepEqual(await readdir(output), ['run-report.json']);
  } finally {
    await rm(output, { recursive:true, force:true });
  }
});

test('authored trajectory publishes the new generation before invalidation can be interrupted', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-authored-packing-interruption-'));
  let child = null;
  try {
    const runner = fileURLToPath(new URL(
      '../tools/run-authored-packing-trajectory-assay.mjs',
      import.meta.url,
    ));
    const priorGeneration = '7'.repeat(64);
    await writeFile(path.join(output, 'assay-result.json'), 'stale primary artifact');
    await writeFile(path.join(output, 'capture-route-verification.json'), JSON.stringify({
      status:'verified',
      generation:priorGeneration,
    }));
    await writeFile(path.join(output, 'run-report.json'), JSON.stringify({
      status:'completed',
      generation:priorGeneration,
    }));
    child = spawn(process.execPath, [
      runner,
      '--manifest', path.join(output, 'missing-manifest.json'),
      '--output', output,
    ], {
      cwd:fileURLToPath(new URL('..', import.meta.url)),
      env:{
        ...process.env,
        NODE_ENV:'test',
        KAMINOS_AUTHORED_PACKING_TEST_INVALIDATION_PAUSE_MS:'20000',
      },
      stdio:'ignore',
    });
    let closed = false;
    const closePromise = new Promise(resolve => child.once('close', code => {
      closed = true;
      resolve(code);
    }));
    let currentReport = null;
    for (let attempt = 0; attempt < 150 && !closed; attempt += 1) {
      currentReport = await readFile(path.join(output, 'run-report.json'), 'utf8')
        .then(JSON.parse)
        .catch(() => null);
      const stalePrimaryWasInvalidated = !await readFile(path.join(output, 'assay-result.json'))
        .then(() => true)
        .catch(() => false);
      if (currentReport?.status === 'in-progress' && stalePrimaryWasInvalidated) break;
      await delay(10);
    }
    assert.equal(currentReport?.status, 'in-progress');
    assert.match(currentReport.generation, /^[a-f0-9]{64}$/);
    assert.notEqual(currentReport.generation, priorGeneration);
    child.kill('SIGKILL');
    await closePromise;
    child = null;

    const staleVerification = JSON.parse(await readFile(
      path.join(output, 'capture-route-verification.json'),
      'utf8',
    ));
    assert.equal(staleVerification.generation, priorGeneration);
    assert.throws(() => validateMuscleCompartmentRingCageContactVisualReceipts({
      runReport:currentReport,
      servedViewer:null,
      captureReports:[],
    }), /completed assay run/i);
  } finally {
    child?.kill('SIGKILL');
    await rm(output, { recursive:true, force:true });
  }
});

test('authored trajectory report binds the served viewer and route inside the visual receipt envelope', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'kaminos-authored-packing-visual-envelope-'));
  try {
    const runner = fileURLToPath(new URL(
      '../tools/run-authored-packing-trajectory-assay.mjs',
      import.meta.url,
    ));
    const result = spawnSync(process.execPath, [
      runner,
      '--manifest', fileURLToPath(FIXTURE_URL),
      '--output', output,
      '--observed-role', 'mild-interpenetration',
      '--intent-role', 'clean-reference',
      '--policy', 'restoration-to-reference',
      '--iterations', '1',
    ], {
      cwd:fileURLToPath(new URL('..', import.meta.url)),
      encoding:'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(path.join(output, 'run-report.json'), 'utf8'));
    assert.equal(
      report.requestedManifestPath,
      'repo://fixtures/authored-packing/packing-fixture-v001.json',
      'durable reports must not leak the generating host path for a repo-owned fixture',
    );
    assert.deepEqual(report.visual.route, report.route);
    assert.deepEqual(report.visual.viewer, report.outputs.viewer);
    assert.equal(report.visual.bundleIdentity.route, report.visual.route.effective);
    const contactViews = report.visual.captureUrls.filter(url =>
      new URL(url, 'http://fixture.invalid/').searchParams.get('view') === 'contact'
    );
    assert.deepEqual(
      contactViews.map(url => new URL(url, 'http://fixture.invalid/').searchParams.get('state')),
      ['observed', 'initialized', 'packed'],
    );
    assert.ok(contactViews.every(url =>
      new URL(url, 'http://fixture.invalid/').searchParams.get('diagnostics') === 'contacts'
    ));
  } finally {
    await rm(output, { recursive:true, force:true });
  }
});
