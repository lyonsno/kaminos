import { createHash } from 'node:crypto';

import { adjudicatePerturbation } from './envelope-relation-measure-core.mjs';

export const ANALYTICAL_TISSUE_DESCRIPTOR_SCHEMA = 'kaminos.analytical-tissue-descriptor.v0';
export const ANALYTICAL_TISSUE_DESCRIPTOR_VALIDATION_SCHEMA =
  'kaminos.analytical-tissue-descriptor-validation.v0';
export const ANALYTICAL_TISSUE_RESPONSE_VERDICT_SCHEMA =
  'kaminos.analytical-tissue-response-verdict.v0';
export const ANALYTICAL_TISSUE_ROW_PLAN_SCHEMA =
  'kaminos.analytical-tissue-factored-row-plan.v0';
export const ANALYTICAL_TISSUE_PRECURSOR_ROW_PLAN_SCHEMA =
  'kaminos.analytical-tissue-analytic-profile-row-plan.v0';

export const TISSUE_CLASSES = Object.freeze(['rigid', 'muscle', 'fat', 'tether', 'skin']);
export const CONTROLLABLE_TISSUE_CLASSES = Object.freeze(['muscle', 'fat', 'tether', 'skin']);

const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const SURFACE_IDENTITY_MODES = new Set(['exact-component', 'mixture-weights']);
const ROW_PLAN_SCHEMAS = new Set([
  ANALYTICAL_TISSUE_ROW_PLAN_SCHEMA,
  ANALYTICAL_TISSUE_PRECURSOR_ROW_PLAN_SCHEMA,
]);
const ROW_EVIDENCE_DISPOSITIONS = new Set([
  'control-observation',
  'candidate-evidence',
  'variant-evidence',
]);

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

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function uniqueNonEmptyStrings(values) {
  return Array.isArray(values)
    && values.length > 0
    && values.every(nonEmptyString)
    && new Set(values).size === values.length;
}

function addFailure(failures, code, message, details = {}) {
  failures.push({ code, message, ...details });
}

export function analyticalTissueDescriptorHash(descriptor) {
  return createHash('sha256').update(canonicalJson(descriptor)).digest('hex');
}

export function analyticalTissueRowPlanHash(rowPlan) {
  return createHash('sha256').update(canonicalJson(rowPlan)).digest('hex');
}

export function validateAnalyticalTissueDescriptor(descriptor) {
  const failures = [];
  if (!descriptor || typeof descriptor !== 'object') {
    addFailure(failures, 'descriptor-missing', 'A neutral tissue descriptor is required.');
    return {
      schema: ANALYTICAL_TISSUE_DESCRIPTOR_VALIDATION_SCHEMA,
      ok: false,
      descriptorId: null,
      descriptorHash: null,
      failures,
    };
  }

  if (descriptor.schema !== ANALYTICAL_TISSUE_DESCRIPTOR_SCHEMA || !nonEmptyString(descriptor.id)) {
    addFailure(
      failures,
      'descriptor-identity-invalid',
      'The descriptor requires its canonical schema and a stable id.',
    );
  }

  if (!['synthetic-truth', 'legacy-source-candidate'].includes(descriptor.authority?.sourceKind)
    || !nonEmptyString(descriptor.authority?.claimCeiling)) {
    addFailure(
      failures,
      'descriptor-authority-invalid',
      'Fixture source kind and bounded claim ceiling must be explicit.',
    );
  }

  if (!nonEmptyString(descriptor.frame?.id)
    || !nonEmptyString(descriptor.frame?.units)
    || !uniqueNonEmptyStrings(descriptor.frame?.axes)) {
    addFailure(
      failures,
      'descriptor-frame-invalid',
      'The descriptor requires a named frame, units, and three unique axes.',
    );
  } else if (descriptor.frame.axes.length !== 3) {
    addFailure(failures, 'descriptor-frame-invalid', 'The descriptor frame must name exactly three axes.');
  }

  const components = Array.isArray(descriptor.components) ? descriptor.components : [];
  const componentIds = components.map((component) => component?.id);
  if (components.length === 0
    || componentIds.some((id) => !nonEmptyString(id))
    || new Set(componentIds).size !== componentIds.length) {
    addFailure(
      failures,
      'descriptor-components-invalid',
      'Components require unique stable identities.',
    );
  }

  const componentById = new Map();
  for (const component of components) {
    if (nonEmptyString(component?.id)) componentById.set(component.id, component);
    if (!TISSUE_CLASSES.includes(component?.tissueClass)
      || !nonEmptyString(component?.supportRegionId)) {
      addFailure(
        failures,
        'descriptor-component-invalid',
        'Every component requires a known tissue class and support region.',
        { componentId: component?.id ?? null },
      );
    }
  }
  const missingClasses = TISSUE_CLASSES.filter(
    (tissueClass) => !components.some((component) => component?.tissueClass === tissueClass),
  );
  if (missingClasses.length > 0) {
    addFailure(
      failures,
      'descriptor-tissue-class-coverage',
      'The bounded fixture must keep rigid, muscle, fat, tether, and skin identities addressable.',
      { missingClasses },
    );
  }

  const controls = Array.isArray(descriptor.controls) ? descriptor.controls : [];
  const controlIds = controls.map((control) => control?.id);
  if (controlIds.some((id) => !nonEmptyString(id)) || new Set(controlIds).size !== controlIds.length) {
    addFailure(failures, 'descriptor-controls-invalid', 'Controls require unique stable identities.');
  }
  for (const control of controls) {
    if (!CONTROLLABLE_TISSUE_CLASSES.includes(control?.tissueClass)
      || !uniqueNonEmptyStrings(control?.targetComponentIds)) {
      addFailure(
        failures,
        'descriptor-control-invalid',
        'Every control requires one controllable tissue class and explicit targets.',
        { controlId: control?.id ?? null },
      );
      continue;
    }
    const mismatchedTargets = control.targetComponentIds.filter(
      (componentId) => componentById.get(componentId)?.tissueClass !== control.tissueClass,
    );
    if (mismatchedTargets.length > 0) {
      addFailure(
        failures,
        'descriptor-control-target-mismatch',
        'A control may target only components of its declared tissue class.',
        { controlId: control.id, componentIds: mismatchedTargets },
      );
    }
  }
  const missingControlClasses = CONTROLLABLE_TISSUE_CLASSES.filter(
    (tissueClass) => !controls.some((control) => control?.tissueClass === tissueClass),
  );
  if (missingControlClasses.length > 0) {
    addFailure(
      failures,
      'descriptor-control-coverage',
      'Muscle, fat, tether, and skin each require an independent named control.',
      { missingClasses: missingControlClasses },
    );
  }

  const observables = Array.isArray(descriptor.observables) ? descriptor.observables : [];
  const observableIds = observables.map((observable) => observable?.id);
  if (!uniqueNonEmptyStrings(observableIds)) {
    addFailure(
      failures,
      'descriptor-observables-invalid',
      'The response ledger requires unique named observables.',
    );
  }

  const surfaceContract = descriptor.surfaceContract;
  const requiredComponentIds = surfaceContract?.requiredComponentIds;
  if (!SURFACE_IDENTITY_MODES.has(surfaceContract?.identityMode)
    || !uniqueNonEmptyStrings(requiredComponentIds)
    || requiredComponentIds.some((componentId) => !componentById.has(componentId))) {
    addFailure(
      failures,
      'descriptor-surface-contract-invalid',
      'The final surface must declare an identity mode and valid required contributor identities.',
    );
  }

  return {
    schema: ANALYTICAL_TISSUE_DESCRIPTOR_VALIDATION_SCHEMA,
    ok: failures.length === 0,
    descriptorId: descriptor.id ?? null,
    descriptorHash: analyticalTissueDescriptorHash(descriptor),
    failures,
  };
}

function validateEvidence(evidence, descriptor, descriptorValidation) {
  const failures = [];
  if (!evidence || typeof evidence !== 'object') {
    addFailure(failures, 'response-evidence-missing', 'Frozen response evidence is required.');
    return failures;
  }

  if (!HASH_PATTERN.test(evidence.descriptorHash ?? '')
    || evidence.descriptorHash !== descriptorValidation.descriptorHash) {
    addFailure(
      failures,
      'descriptor-hash-mismatch',
      'Response evidence does not bind the exact neutral descriptor.',
    );
  }

  const freeze = evidence.freeze;
  if (!nonEmptyString(freeze?.requestedRouteId)
    || !nonEmptyString(freeze?.effectiveRouteId)
    || !HASH_PATTERN.test(freeze?.cameraHash ?? '')
    || !HASH_PATTERN.test(freeze?.sourceHash ?? '')) {
    addFailure(
      failures,
      'freeze-identity-invalid',
      'Requested/effective route, camera hash, and source hash must be recorded.',
    );
  } else if (freeze.requestedRouteId !== freeze.effectiveRouteId) {
    addFailure(
      failures,
      'effective-route-mismatch',
      'The effective route differs from the requested frozen route.',
      { requested: freeze.requestedRouteId, effective: freeze.effectiveRouteId },
    );
  }
  if (!nonEmptyString(freeze?.baselineObservationId)
    || !nonEmptyString(freeze?.perturbedObservationId)
    || freeze?.baselineObservationId === freeze?.perturbedObservationId) {
    addFailure(
      failures,
      'observation-identity-invalid',
      'Baseline and perturbed observations require distinct stable identities.',
    );
  }

  const representation = evidence.representation;
  for (const [field, code, label] of [
    ['InteriorCarrierId', 'effective-interior-carrier-mismatch', 'interior carrier'],
    ['SurfaceFormationId', 'effective-surface-formation-mismatch', 'surface formation'],
  ]) {
    const requested = representation?.[`requested${field}`];
    const effective = representation?.[`effective${field}`];
    if (!nonEmptyString(requested) || !nonEmptyString(effective) || requested !== effective) {
      addFailure(
        failures,
        code,
        `The effective ${label} differs from the requested factored assay row.`,
        { requested: requested ?? null, effective: effective ?? null },
      );
    }
  }

  const assay = evidence.assay;
  const rowPlan = assay?.rowPlan;
  const rows = Array.isArray(rowPlan?.rows) ? rowPlan.rows : [];
  const rowIds = rows.map((row) => row?.id);
  const precursorPlan = rowPlan?.schema === ANALYTICAL_TISSUE_PRECURSOR_ROW_PLAN_SCHEMA;
  if (!ROW_PLAN_SCHEMAS.has(rowPlan?.schema)
    || !nonEmptyString(rowPlan?.id)
    || rowPlan?.descriptorId !== descriptor.id
    || rowPlan?.promotion !== 'none'
    || (precursorPlan && !nonEmptyString(rowPlan?.sourceResponseRef))
    || !uniqueNonEmptyStrings(rowIds)
    || rows.some((row) => (
      !nonEmptyString(row?.interiorCarrierId)
      || !nonEmptyString(row?.surfaceFormationId)
      || (precursorPlan && !nonEmptyString(row?.implementationMode))
      || !ROW_EVIDENCE_DISPOSITIONS.has(row?.evidenceDisposition)
    ))) {
    addFailure(
      failures,
      'assay-row-plan-invalid',
      'Response evidence requires a recognized bounded row plan for this descriptor.',
    );
  } else if (!HASH_PATTERN.test(assay?.rowPlanHash ?? '')
    || assay.rowPlanHash !== analyticalTissueRowPlanHash(rowPlan)) {
    addFailure(
      failures,
      'assay-row-plan-hash-mismatch',
      'Response evidence does not bind the exact bounded row plan.',
    );
  } else {
    const row = rows.find((candidate) => candidate.id === assay?.rowId);
    if (!row) {
      addFailure(
        failures,
        'assay-row-identity-invalid',
        'Response evidence must name one row from the frozen bounded plan.',
      );
    } else {
      const representationMatchesRow = (
        representation?.requestedInteriorCarrierId === row.interiorCarrierId
        && representation?.effectiveInteriorCarrierId === row.interiorCarrierId
        && representation?.requestedSurfaceFormationId === row.surfaceFormationId
        && representation?.effectiveSurfaceFormationId === row.surfaceFormationId
      );
      if (!representationMatchesRow) {
        addFailure(
          failures,
          'assay-row-representation-mismatch',
          'Requested and effective representation identities must match the declared assay row.',
          {
            rowId: row.id,
            expectedInteriorCarrierId: row.interiorCarrierId,
            expectedSurfaceFormationId: row.surfaceFormationId,
          },
        );
      }
      if (row.evidenceDisposition === 'control-observation') {
        addFailure(
          failures,
          'assay-row-control-only',
          'A control-row response remains observable but cannot become positive representation admission.',
          { rowId: row.id },
        );
      }
    }
  }

  const control = descriptor.controls?.find((candidate) => candidate.id === evidence.trial?.controlId);
  if (!control || !finite(evidence.trial?.delta) || evidence.trial.delta === 0) {
    addFailure(
      failures,
      'control-identity-invalid',
      'The response trial must name one descriptor control and a non-zero perturbation.',
    );
  }

  const surface = evidence.surface;
  if (!nonEmptyString(surface?.outputSurfaceId)
    || surface?.identityMode !== descriptor.surfaceContract?.identityMode
    || !SURFACE_IDENTITY_MODES.has(surface?.identityMode)) {
    addFailure(
      failures,
      'surface-identity-mode-invalid',
      'The consumed surface does not expose the descriptor-required contributor identity mode.',
    );
  }

  const contributors = Array.isArray(surface?.contributors) ? surface.contributors : [];
  const componentById = new Map(descriptor.components.map((component) => [component.id, component]));
  const contributorIds = contributors.map((contributor) => contributor?.componentId);
  if (contributors.length === 0
    || contributorIds.some((componentId) => !nonEmptyString(componentId))
    || new Set(contributorIds).size !== contributorIds.length) {
    addFailure(
      failures,
      'surface-contributors-invalid',
      'The consumed surface requires unique contributor identities.',
    );
  }
  const identityMismatches = contributors
    .filter((contributor) => (
      componentById.get(contributor?.componentId)?.tissueClass !== contributor?.tissueClass
    ))
    .map((contributor) => contributor?.componentId ?? null);
  if (identityMismatches.length > 0) {
    addFailure(
      failures,
      'surface-contributor-identity-mismatch',
      'Surface contributor tissue classes do not match the neutral descriptor.',
      { componentIds: identityMismatches },
    );
  }

  const dropped = (descriptor.surfaceContract?.requiredComponentIds ?? []).filter(
    (componentId) => !contributors.some((contributor) => contributor?.componentId === componentId),
  );
  if (dropped.length > 0) {
    addFailure(
      failures,
      'surface-required-component-dropped',
      'A descriptor-required contributor disappeared before the consumed surface.',
      { componentIds: dropped },
    );
  }

  if (surface?.identityMode === 'mixture-weights') {
    const weightSum = contributors.reduce(
      (sum, contributor) => sum + (finite(contributor?.weight) ? contributor.weight : Number.NaN),
      0,
    );
    if (contributors.some((contributor) => !(finite(contributor?.weight) && contributor.weight > 0))
      || !finite(weightSum)
      || Math.abs(weightSum - 1) > 1e-9) {
      addFailure(
        failures,
        'surface-mixture-weight-invalid',
        'Mixture-weight contributors must have positive finite weights summing to one.',
        { weightSum },
      );
    }
  } else if (surface?.identityMode === 'exact-component') {
    const expectedIds = [...(descriptor.surfaceContract?.requiredComponentIds ?? [])].sort();
    const observedIds = [...contributorIds].sort();
    const exactSet = expectedIds.length === observedIds.length
      && expectedIds.every((componentId, index) => componentId === observedIds[index]);
    if (!exactSet) {
      addFailure(
        failures,
        'surface-exact-component-set-mismatch',
        'Exact-component evidence must expose exactly the descriptor-required component identities.',
        { expected: expectedIds, observed: observedIds },
      );
    }
  }

  return failures;
}

export function adjudicateTissueResponseLedger({ evidence, ...perturbation }) {
  const descriptor = evidence?.descriptor;
  const descriptorValidation = validateAnalyticalTissueDescriptor(descriptor);
  const failures = [...descriptorValidation.failures];
  let numeric = null;
  if (descriptorValidation.ok) {
    failures.push(...validateEvidence(evidence, descriptor, descriptorValidation));
    const expected = descriptor.observables.map((observable) => observable.id).sort();
    const baseline = Object.keys(perturbation.baselineComparison ?? {}).sort();
    const perturbed = Object.keys(perturbation.perturbedComparison ?? {}).sort();
    const sameKeys = (left, right) => (
      left.length === right.length && left.every((key, index) => key === right[index])
    );
    const relationIsDeclared = expected.includes(perturbation.perturbedRelation);
    if (!relationIsDeclared) {
      addFailure(
        failures,
        'perturbed-relation-invalid',
        'The perturbed relation must be one of the frozen descriptor observables.',
        { expected, observed: perturbation.perturbedRelation ?? null },
      );
    }
    if (!sameKeys(expected, baseline) || !sameKeys(expected, perturbed)) {
      addFailure(
        failures,
        'response-observable-mismatch',
        'Baseline and perturbed response keys must exactly match the frozen descriptor observables.',
        { expected, baseline, perturbed },
      );
    } else if (relationIsDeclared) {
      numeric = adjudicatePerturbation(perturbation);
    }
  }
  if (numeric && !numeric.passed) {
    addFailure(
      failures,
      'numeric-response-mismatch',
      'Candidate response does not preserve the source-warranted coupled response.',
      {
        directionHeld: numeric.directionHeld,
        couplingHeld: numeric.couplingHeld,
        couplingViolations: numeric.couplingViolations,
      },
    );
  }

  return {
    schema: ANALYTICAL_TISSUE_RESPONSE_VERDICT_SCHEMA,
    passed: failures.length === 0,
    descriptor: descriptorValidation,
    numeric,
    failures,
  };
}
