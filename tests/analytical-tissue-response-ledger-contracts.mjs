import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  adjudicateTissueResponseLedger,
  analyticalTissueDescriptorHash,
  validateAnalyticalTissueDescriptor,
} from '../analytical-tissue-assay-core.mjs';

const baselineComparison = Object.freeze({
  muscleBulge: Object.freeze({ source: 0, envelope: 0 }),
  fatSpan: Object.freeze({ source: 0, envelope: 0 }),
  tetherAnchor: Object.freeze({ source: 0, envelope: 0 }),
  skinSlack: Object.freeze({ source: 0, envelope: 0 }),
});

const descriptorFixture = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/synthetic-hindquarter-neutral.v0.json', import.meta.url),
  'utf8',
));
const rowPlanFixture = JSON.parse(await readFile(
  new URL('../fixtures/analytical-tissue/factored-row-plan.v0.json', import.meta.url),
  'utf8',
));

const perturbedComparison = Object.freeze({
  muscleBulge: Object.freeze({ source: 1, envelope: 1 }),
  fatSpan: Object.freeze({ source: 0.45, envelope: 0.45 }),
  tetherAnchor: Object.freeze({ source: -0.2, envelope: -0.2 }),
  skinSlack: Object.freeze({ source: 0.3, envelope: 0.3 }),
});

function descriptor() {
  return structuredClone(descriptorFixture);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function rowPlanHash(rowPlan) {
  return createHash('sha256').update(canonicalJson(rowPlan)).digest('hex');
}

function faithfulEvidence() {
  const neutralDescriptor = descriptor();
  return {
    descriptor: neutralDescriptor,
    descriptorHash: analyticalTissueDescriptorHash(neutralDescriptor),
    freeze: {
      requestedRouteId: 'synthetic-truth-v0',
      effectiveRouteId: 'synthetic-truth-v0',
      baselineObservationId: 'synthetic-hindquarter:baseline:v0',
      perturbedObservationId: 'synthetic-hindquarter:muscle-tension:+0.1:v0',
      cameraHash: 'a'.repeat(64),
      sourceHash: 'b'.repeat(64),
    },
    representation: {
      requestedInteriorCarrierId: 'labeled-anisotropic-components-v0',
      effectiveInteriorCarrierId: 'labeled-anisotropic-components-v0',
      requestedSurfaceFormationId: 'fitted-response-shell-v0',
      effectiveSurfaceFormationId: 'fitted-response-shell-v0',
    },
    assay: {
      rowPlan: structuredClone(rowPlanFixture),
      rowPlanHash: rowPlanHash(rowPlanFixture),
      rowId: 'factored-hybrid-leading-hypothesis',
    },
    trial: { controlId: 'muscle-tension', delta: 0.1 },
    surface: {
      outputSurfaceId: 'synthetic-hindquarter-surface:muscle-tension:+0.1:v0',
      identityMode: 'mixture-weights',
      contributors: [
        { componentId: 'pelvis', tissueClass: 'rigid', weight: 0.1 },
        { componentId: 'gluteal-carrier', tissueClass: 'muscle', weight: 0.45 },
        { componentId: 'haunch-bulk', tissueClass: 'fat', weight: 0.2 },
        { componentId: 'ischial-tether', tissueClass: 'tether', weight: 0.1 },
        { componentId: 'hindquarter-skin', tissueClass: 'skin', weight: 0.15 },
      ],
    },
  };
}

function adjudicate(evidence) {
  return adjudicateTissueResponseLedger({
    baselineComparison,
    perturbedComparison,
    perturbedRelation: 'muscleBulge',
    expectedDirection: 1,
    evidence,
  });
}

test('neutral descriptor keeps each causal class independently addressable', () => {
  const validation = validateAnalyticalTissueDescriptor(descriptor());
  assert.equal(validation.ok, true, JSON.stringify(validation.failures));
  assert.match(validation.descriptorHash, /^[0-9a-f]{64}$/);
});

test('factored row plan compares carrier and surface formation without promotion', () => {
  assert.equal(rowPlanFixture.rows.length, 4);
  assert.equal(rowPlanFixture.promotion, 'none');
  assert.deepEqual(
    new Set(rowPlanFixture.rows.map((row) => row.interiorCarrierId)),
    new Set([
      'undifferentiated-metaball-sdf-v0',
      'labeled-anisotropic-components-v0',
      'no-identity-bearing-interior-v0',
    ]),
  );
  assert.deepEqual(
    new Set(rowPlanFixture.rows.map((row) => row.surfaceFormationId)),
    new Set([
      'direct-zero-isosurface-v0',
      'identity-weighted-isosurface-v0',
      'fitted-skin-shell-v0',
      'fitted-response-shell-v0',
    ]),
  );
});

test('faithful factored evidence passes with source-warranted coupling intact', () => {
  const verdict = adjudicate(faithfulEvidence());
  assert.equal(verdict.passed, true, JSON.stringify(verdict.failures));
  assert.equal(verdict.numeric.couplingHeld, true);
});

test('negative-control response remains observable but cannot become positive admission', () => {
  for (const rowId of ['scalar-union-negative-control', 'explicit-shell-causal-null']) {
    const evidence = faithfulEvidence();
    const row = evidence.assay.rowPlan.rows.find((candidate) => candidate.id === rowId);
    evidence.assay.rowId = row.id;
    evidence.representation = {
      requestedInteriorCarrierId: row.interiorCarrierId,
      effectiveInteriorCarrierId: row.interiorCarrierId,
      requestedSurfaceFormationId: row.surfaceFormationId,
      effectiveSurfaceFormationId: row.surfaceFormationId,
    };

    const verdict = adjudicate(evidence);
    assert.equal(verdict.numeric.passed, true, `${rowId} numeric observation should be retained`);
    assert.equal(verdict.passed, false, `${rowId} must not become positive representation admission`);
    assert.ok(
      verdict.failures.some((failure) => failure.code === 'assay-row-control-only'),
      JSON.stringify(verdict.failures),
    );
  }
});

test('declared assay row cannot carry a different representation pair', () => {
  const evidence = faithfulEvidence();
  evidence.representation.requestedInteriorCarrierId = 'undifferentiated-metaball-sdf-v0';
  evidence.representation.effectiveInteriorCarrierId = 'undifferentiated-metaball-sdf-v0';
  evidence.representation.requestedSurfaceFormationId = 'direct-zero-isosurface-v0';
  evidence.representation.effectiveSurfaceFormationId = 'direct-zero-isosurface-v0';

  const verdict = adjudicate(evidence);
  assert.equal(verdict.passed, false);
  assert.ok(
    verdict.failures.some((failure) => failure.code === 'assay-row-representation-mismatch'),
    JSON.stringify(verdict.failures),
  );
});

test('row-plan tampering cannot inherit a stale evidence hash', () => {
  const evidence = faithfulEvidence();
  evidence.assay.rowPlan.rows.find(
    (row) => row.id === evidence.assay.rowId,
  ).evidenceDisposition = 'control-observation';

  const verdict = adjudicate(evidence);
  assert.equal(verdict.passed, false);
  assert.ok(
    verdict.failures.some((failure) => failure.code === 'assay-row-plan-hash-mismatch'),
    JSON.stringify(verdict.failures),
  );
});

test('unknown perturbed relation returns a structured evidence verdict', () => {
  const verdict = adjudicateTissueResponseLedger({
    baselineComparison,
    perturbedComparison,
    perturbedRelation: 'tailSweep',
    expectedDirection: 1,
    evidence: faithfulEvidence(),
  });
  assert.equal(verdict.passed, false);
  assert.equal(verdict.numeric, null);
  assert.ok(
    verdict.failures.some((failure) => failure.code === 'perturbed-relation-invalid'),
    JSON.stringify(verdict.failures),
  );
});

test('exact-component evidence does not require synthetic mixture weights', () => {
  const evidence = faithfulEvidence();
  evidence.descriptor.surfaceContract.identityMode = 'exact-component';
  evidence.descriptorHash = analyticalTissueDescriptorHash(evidence.descriptor);
  evidence.surface.identityMode = 'exact-component';
  evidence.surface.contributors = evidence.surface.contributors.map(({ componentId, tissueClass }) => ({
    componentId,
    tissueClass,
  }));

  const verdict = adjudicate(evidence);
  assert.equal(verdict.passed, true, JSON.stringify(verdict.failures));
});

test('identity swap cannot pass behind a numerically faithful response vector', () => {
  const evidence = faithfulEvidence();
  const muscle = evidence.surface.contributors.find((entry) => entry.componentId === 'gluteal-carrier');
  const fat = evidence.surface.contributors.find((entry) => entry.componentId === 'haunch-bulk');
  muscle.tissueClass = 'fat';
  fat.tissueClass = 'muscle';

  const verdict = adjudicate(evidence);
  assert.equal(
    verdict.passed,
    false,
    'swapped muscle/fat identities must fail even when every numeric response matches',
  );
  assert.ok(
    verdict.failures.some((failure) => failure.code === 'surface-contributor-identity-mismatch'),
  );
});

test('smooth undifferentiated blob cannot pass on gross response alone', () => {
  const evidence = faithfulEvidence();
  evidence.surface = {
    identityMode: 'none',
    contributors: [{ componentId: 'smooth-blob', tissueClass: 'undifferentiated', weight: 1 }],
  };

  const verdict = adjudicate(evidence);
  assert.equal(
    verdict.passed,
    false,
    'an undifferentiated blob must not impersonate an identity-bearing surface',
  );
  assert.ok(
    verdict.failures.some((failure) => failure.code === 'surface-identity-mode-invalid'),
  );
});

test('dropping a tissue class cannot pass by redistributing its response', () => {
  const evidence = faithfulEvidence();
  evidence.surface.contributors = evidence.surface.contributors.filter(
    (entry) => entry.tissueClass !== 'tether',
  );

  const verdict = adjudicate(evidence);
  assert.equal(
    verdict.passed,
    false,
    'every descriptor tissue class must remain attributable at the consumed surface',
  );
  assert.ok(
    verdict.failures.some((failure) => failure.code === 'surface-required-component-dropped'),
  );
});

test('stale or fallback route identity cannot masquerade as the requested assay', () => {
  const evidence = faithfulEvidence();
  evidence.freeze.effectiveRouteId = 'cached-default-v0';

  const verdict = adjudicate(evidence);
  assert.equal(
    verdict.passed,
    false,
    'requested and effective route identity must agree for a frozen response ledger',
  );
  assert.ok(verdict.failures.some((failure) => failure.code === 'effective-route-mismatch'));
});

test('invented motion remains a failure after contributor identity is added', () => {
  const invented = structuredClone(perturbedComparison);
  invented.skinSlack.source = 0;
  invented.skinSlack.envelope = 0.3;
  const verdict = adjudicateTissueResponseLedger({
    baselineComparison,
    perturbedComparison: invented,
    perturbedRelation: 'muscleBulge',
    expectedDirection: 1,
    evidence: faithfulEvidence(),
  });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.failures.some((failure) => failure.code === 'numeric-response-mismatch'));
});

test('flattened source coupling remains a failure after contributor identity is added', () => {
  const flattened = structuredClone(perturbedComparison);
  flattened.fatSpan.envelope = 0;
  const verdict = adjudicateTissueResponseLedger({
    baselineComparison,
    perturbedComparison: flattened,
    perturbedRelation: 'muscleBulge',
    expectedDirection: 1,
    evidence: faithfulEvidence(),
  });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.failures.some((failure) => failure.code === 'numeric-response-mismatch'));
});

test('missing descriptor observable fails as a structured verdict', () => {
  const missing = structuredClone(perturbedComparison);
  delete missing.skinSlack;
  const verdict = adjudicateTissueResponseLedger({
    baselineComparison,
    perturbedComparison: missing,
    perturbedRelation: 'muscleBulge',
    expectedDirection: 1,
    evidence: faithfulEvidence(),
  });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.failures.some((failure) => failure.code === 'response-observable-mismatch'));
});

test('unknown observable cannot silently expand the frozen comparison class', () => {
  const baseline = structuredClone(baselineComparison);
  const perturbed = structuredClone(perturbedComparison);
  baseline.tailSweep = { source: 0, envelope: 0 };
  perturbed.tailSweep = { source: 0.2, envelope: 0.2 };
  const verdict = adjudicateTissueResponseLedger({
    baselineComparison: baseline,
    perturbedComparison: perturbed,
    perturbedRelation: 'muscleBulge',
    expectedDirection: 1,
    evidence: faithfulEvidence(),
  });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.failures.some((failure) => failure.code === 'response-observable-mismatch'));
});
