import { isDeepStrictEqual } from 'node:util';

import {
  HOLD_MUSCULATURE_SOURCE_EVIDENCE,
  MUSCULATURE_SOURCE_M0_SCHEMA,
} from './musculature-source-m0-core.mjs';
import {
  TRACK_M_SOURCE_SCHEMA,
  buildTrackMEvidencePlan,
} from './track-m-evidence-bundle-core.mjs';

export const TRACK_M_M0_BUNDLE_COMPATIBILITY_SCHEMA =
  'kaminos.track-m-m0-bundle-compatibility.v0';

const CONDITION_IDS = Object.freeze([
  'deep-geometry-absent',
  'deep-geometry-correctly-routed',
  'deep-geometry-matched-wrong-routing',
]);

const M0_MATCHED_BUDGET_FIELDS = Object.freeze([
  'primitiveCount',
  'curveCount',
  'controlCount',
  'crossSectionBudget',
  'routeLength',
  'occupiedVolume',
  'surfaceArea',
]);

const MISSING_M0_AUTHORITY = Object.freeze([
  'matchedControlIdentity',
  'sourceCompletenessAndKnownOmissions',
  'sourceUnits',
  'semanticNames',
  'localFrames',
  'attachmentInsertionBindings',
  'routedPathControls',
  'tendonBellyIntervals',
  'wrapGuides',
  'neutralConservativePosePair',
  'packingBehavior',
  'm0MatchedBudgetLedgerAndWitnesses',
  'neighboringSupportIndependence',
  'sourceEvidenceChecks',
]);

const DOWNSTREAM_FIELDS = Object.freeze([
  'measurementStation',
  'cells',
  'compilerCompatibility',
  'visualAdmission',
]);

function failure(code, message, details = {}) {
  return { code, message, ...details };
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ignoredDownstreamFields(plan) {
  if (!isPlainObject(plan)) return [];
  return DOWNSTREAM_FIELDS.filter(field => Object.hasOwn(plan, field));
}

function canonicalPlanWithoutDownstreamFields(plan) {
  const canonicalPlan = { ...plan };
  for (const field of DOWNSTREAM_FIELDS) delete canonicalPlan[field];
  return canonicalPlan;
}

function failedResult({ source, plan, failures }) {
  return {
    schema: TRACK_M_M0_BUNDLE_COMPATIBILITY_SCHEMA,
    disposition: 'FAIL_TRACK_M_BUNDLE_COMPATIBILITY',
    comparisonClassCompatible: false,
    losslessM0Receipt: false,
    sourceSchema: source?.schema ?? null,
    targetSchema: MUSCULATURE_SOURCE_M0_SCHEMA,
    sourceReceiptId: source?.receiptId ?? null,
    planId: plan?.id ?? null,
    mappedPredicates: null,
    matchedBudgetCoverage: null,
    missingM0Authority: [...MISSING_M0_AUTHORITY],
    ignoredDownstreamFields: ignoredDownstreamFields(plan),
    holds: [],
    failures,
  };
}

export function validateTrackMM0BundleCompatibility({ source, plan } = {}) {
  let expectedPlan;
  try {
    expectedPlan = buildTrackMEvidencePlan(source);
  } catch (error) {
    return failedResult({
      source,
      plan,
      failures: [failure(
        'track-m-source-contract-invalid',
        'The supplied Track M source does not satisfy the three-condition bundle contract.',
        { reason: error instanceof Error ? error.message : String(error) },
      )],
    });
  }

  if (!isPlainObject(plan)) {
    return failedResult({
      source,
      plan,
      failures: [failure(
        'track-m-plan-shape-invalid',
        'The supplied Track M plan must be a plain object.',
        { suppliedPlanType: Array.isArray(plan) ? 'array' : typeof plan },
      )],
    });
  }

  const planIdentityMatches = plan?.id === expectedPlan.id
    && plan?.bundleOutputIdentity === expectedPlan.bundleOutputIdentity
    && plan?.sourceReceiptId === expectedPlan.sourceReceiptId
    && Array.isArray(plan?.conditions)
    && plan.conditions.length === expectedPlan.conditions.length
    && plan.conditions.every((condition, index) => (
      condition?.id === expectedPlan.conditions[index].id
      && condition?.outputIdentity === expectedPlan.conditions[index].outputIdentity
      && condition?.conditionTransformSha256 === expectedPlan.conditions[index].conditionTransformSha256
    ));

  if (!planIdentityMatches) {
    return failedResult({
      source,
      plan,
      failures: [failure(
        'track-m-plan-identity-mismatch',
        'The supplied plan is not the deterministic plan for the supplied Track M source.',
        { expectedPlanId: expectedPlan.id, suppliedPlanId: plan?.id ?? null },
      )],
    });
  }

  const canonicalPlan = canonicalPlanWithoutDownstreamFields(plan);
  if (!isDeepStrictEqual(canonicalPlan, expectedPlan)) {
    return failedResult({
      source,
      plan,
      failures: [failure(
        'track-m-plan-content-mismatch',
        'The supplied plan content differs from the deterministic plan for the supplied Track M source.',
        {
          expectedPlanId: expectedPlan.id,
          suppliedPlanId: plan.id,
          allowedDownstreamFields: [...DOWNSTREAM_FIELDS],
        },
      )],
    });
  }

  const bundleBudgetFields = Object.keys(source.testedRelation.representationalBudget);
  const coveredBudgetFields = M0_MATCHED_BUDGET_FIELDS.filter(field => bundleBudgetFields.includes(field));
  const missingBudgetFields = M0_MATCHED_BUDGET_FIELDS.filter(field => !bundleBudgetFields.includes(field));
  const mappedPredicates = {
    sourceReceiptId: source.receiptId,
    assetId: source.asset.id,
    assetPath: source.asset.path,
    assetSha256: source.asset.sha256,
    conservativePoseId: source.pose.id,
    conservativePoseAuthorityId: source.pose.authorityId,
    conservativePoseSha256: source.pose.sha256,
    fixedCameraId: source.camera.id,
    fixedCameraSha256: source.camera.sha256,
    routingRelationId: source.testedRelation.id,
    deepGeometryIds: [...source.testedRelation.deepGeometryIds],
    attachmentEndpointMultisetSha256:
      source.testedRelation.attachmentEndpointMultisetSha256,
    expectedRoutingGraphSha256: source.testedRelation.expectedRoutingGraphSha256,
    conditionIds: [...CONDITION_IDS],
    conditionTransformIds: Object.fromEntries(CONDITION_IDS.map(id => [
      id,
      source.conditions[id].transform.id,
    ])),
  };

  return {
    schema: TRACK_M_M0_BUNDLE_COMPATIBILITY_SCHEMA,
    disposition: HOLD_MUSCULATURE_SOURCE_EVIDENCE,
    comparisonClassCompatible: true,
    losslessM0Receipt: false,
    sourceSchema: TRACK_M_SOURCE_SCHEMA,
    targetSchema: MUSCULATURE_SOURCE_M0_SCHEMA,
    sourceReceiptId: source.receiptId,
    planId: plan.id,
    mappedPredicates,
    matchedBudgetCoverage: {
      bundleFields: bundleBudgetFields,
      m0RequiredFields: [...M0_MATCHED_BUDGET_FIELDS],
      coveredFields: coveredBudgetFields,
      missingFields: missingBudgetFields,
    },
    missingM0Authority: [...MISSING_M0_AUTHORITY],
    ignoredDownstreamFields: ignoredDownstreamFields(plan),
    holds: [failure(
      'track-m-m0-source-authority-missing',
      'The three-condition bundle preserves the comparison class but cannot supply the authored anatomical source authority required by M0.',
      { fields: [...MISSING_M0_AUTHORITY] },
    )],
    failures: [],
  };
}
