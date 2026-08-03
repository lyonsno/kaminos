import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  FAIL_MUSCULATURE_SOURCE,
  HOLD_MUSCULATURE_SOURCE_EVIDENCE,
} from './musculature-source-m0-core.mjs';
import {
  TRACK_M_M0_BUNDLE_COMPATIBILITY_SCHEMA,
  validateTrackMM0BundleCompatibility,
} from './track-m-m0-bundle-compatibility.mjs';
import {
  TRACK_M_AUTHORED_SOURCE_GRAPH_SCHEMA,
  TRACK_M_SOURCE_PROJECTION_COMPILER_ID,
} from './track-m-source-projection-core.mjs';

export const TRACK_M_AUTHORED_SOURCE_M0_PREFLIGHT_SCHEMA =
  'kaminos.track-m-authored-source-m0-preflight.v0';
export const TRACK_M_RELATION_FIXTURE_SELECTION_SCHEMA =
  'kaminos.track-m-authored-relation-fixture-selection.v0';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SELECTION_FIELDS = Object.freeze([
  'schema',
  'graphSha256',
  'primaryConstructionId',
  'matchedWrongDonorConstructionId',
  'nullConstructionIds',
  'authority',
  'selectedBeforeOutputInspection',
]);
const AUTHORITY_FIELDS = Object.freeze(['id', 'sha256']);
const SOURCE_GRAPH_MISSING_M0_FIELDS = Object.freeze([
  'matchedControlIdentity',
  'semanticNames',
  'localFrames',
  'attachmentInsertionBindings',
  'routedPathControls',
  'tendonBellyIntervals',
  'wrapGuides',
  'neutralConservativePosePair',
  'fixedCamera',
  'packingBehavior',
  'm0MatchedBudgetLedgerAndWitnesses',
  'neighboringSupportIndependence',
  'sourceEvidenceChecks',
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function validHash(value) {
  return HASH_PATTERN.test(value ?? '');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  return isPlainObject(value)
    && Object.keys(value).length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
}

function field(fieldId, evidence = {}) {
  return { field: fieldId, ...evidence };
}

function relationSummary(muscle) {
  return {
    constructionId: muscle.identity.construction_id,
    lineageId: muscle.identity.lineage_id,
    instanceId: muscle.identity.instance_id,
    name: muscle.name,
    origin: {
      sourceName: muscle.origin.sourceName,
      sourceAuthority: muscle.origin.sourceAuthority,
      handleObject: muscle.origin.handleObject,
      handleInstanceId: muscle.origin.handleInstanceId,
    },
    insertion: {
      sourceName: muscle.insertion.sourceName,
      sourceAuthority: muscle.insertion.sourceAuthority,
      handleObject: muscle.insertion.handleObject,
      handleInstanceId: muscle.insertion.handleInstanceId,
    },
    path: {
      objectName: muscle.components.path?.name ?? null,
      instanceId: muscle.components.path?.identity?.instance_id ?? null,
      geometrySha256: muscle.components.path?.geometry?.contentSha256 ?? null,
      pointCount: muscle.components.path?.geometry?.pointCount ?? null,
      splineCount: muscle.components.path?.geometry?.splineCount ?? null,
    },
    surface: {
      objectName: muscle.components.surface?.name ?? null,
      instanceId: muscle.components.surface?.identity?.instance_id ?? null,
      geometrySha256: muscle.components.surface?.geometry?.contentSha256 ?? null,
    },
    tendonFractions: {
      origin: muscle.settings?.origin_tendon_fraction ?? null,
      insertion: muscle.settings?.insertion_tendon_fraction ?? null,
    },
    constructionBudget: constructionBudget(muscle),
  };
}

function constructionBudget(muscle) {
  return {
    longitudinalSections: muscle.settings?.longitudinal_sections ?? null,
    profileSides: muscle.settings?.profile_sides ?? null,
    originTendonFraction: muscle.settings?.origin_tendon_fraction ?? null,
    insertionTendonFraction: muscle.settings?.insertion_tendon_fraction ?? null,
    pathPointCount: muscle.components.path?.geometry?.pointCount ?? null,
    pathSplineCount: muscle.components.path?.geometry?.splineCount ?? null,
    surfaceVertexCount: muscle.components.surface?.geometry?.vertexCount ?? null,
    surfaceEdgeCount: muscle.components.surface?.geometry?.edgeCount ?? null,
    surfacePolygonCount: muscle.components.surface?.geometry?.polygonCount ?? null,
  };
}

function failedResult({ graph, bundleCompatibility, contradictory }) {
  return {
    schema: TRACK_M_AUTHORED_SOURCE_M0_PREFLIGHT_SCHEMA,
    disposition: FAIL_MUSCULATURE_SOURCE,
    ok: false,
    graphSha256: graph?.graphSha256 ?? null,
    sourceSha256: graph?.source?.sha256 ?? null,
    graphIdentityVerified: false,
    bundlePredecessorCompatible: bundleCompatibility?.comparisonClassCompatible === true,
    selectedFixture: null,
    candidates: null,
    sourceOmissions: [],
    satisfied: [],
    missing: [],
    contradictory,
    selectionAdapter: selectionAdapterContract(),
    bundleCompatibility: bundleCompatibility ?? null,
  };
}

function selectionAdapterContract() {
  return {
    schema: TRACK_M_RELATION_FIXTURE_SELECTION_SCHEMA,
    requiredCallerFields: [...SELECTION_FIELDS],
    selectsForCaller: false,
    resolution: 'caller ids resolve one primary route, one matched donor, and two same-object null controls; all identities are copied from the authenticated graph',
    admittedEndpointAuthorityWithoutOverride: 'source_mesh',
    outputAuthority: 'selected sensitivity-fixture identity only; no cross-wire transform, tolerance, superiority, M0, station, pose, or routing admission',
  };
}

function validateGraph(graph, expectedGraphSha256, expectedSourceSha256) {
  const contradictory = [];
  if (!isPlainObject(graph)) {
    contradictory.push(field('graphShape', { reason: 'graph must be one plain object' }));
    return contradictory;
  }
  if (graph.schema !== TRACK_M_AUTHORED_SOURCE_GRAPH_SCHEMA
    || graph.compilerId !== TRACK_M_SOURCE_PROJECTION_COMPILER_ID
    || graph.status !== 'compiled'
    || graph.trackId !== 'shape-bearing-musculature') {
    contradictory.push(field('graphContract', {
      reason: 'schema, compiler, status, or track scope does not match the reviewed authored-source projection',
    }));
  }
  if (!validHash(expectedGraphSha256) || graph.graphSha256 !== expectedGraphSha256) {
    contradictory.push(field('graphIdentity', {
      expectedGraphSha256: expectedGraphSha256 ?? null,
      effectiveGraphSha256: graph.graphSha256 ?? null,
    }));
  }
  if (validHash(graph.graphSha256)) {
    const graphCore = structuredClone(graph);
    delete graphCore.graphSha256;
    const computedGraphSha256 = hashJson(graphCore);
    if (computedGraphSha256 !== graph.graphSha256) {
      contradictory.push(field('graphSelfHash', {
        declaredGraphSha256: graph.graphSha256,
        computedGraphSha256,
      }));
    }
  } else {
    contradictory.push(field('graphSelfHash', { reason: 'graphSha256 is missing or malformed' }));
  }
  if (!validHash(expectedSourceSha256) || graph.source?.sha256 !== expectedSourceSha256) {
    contradictory.push(field('sourceIdentity', {
      expectedSourceSha256: expectedSourceSha256 ?? null,
      effectiveSourceSha256: graph.source?.sha256 ?? null,
    }));
  }
  if (!nonEmptyString(graph.source?.effectivePath)
    || !Number.isInteger(graph.source?.byteLength)
    || graph.source.byteLength <= 0) {
    contradictory.push(field('sourceReceipt', { reason: 'effective path and positive byte length are required' }));
  }
  if (graph.scene?.unitSettings?.system !== 'METRIC'
    || !nonEmptyString(graph.scene?.unitSettings?.lengthUnit)
    || !(graph.scene?.unitSettings?.scaleLength > 0)) {
    contradictory.push(field('sourceUnits', { reason: 'metric source units are missing or invalid' }));
  }
  if (!Array.isArray(graph.sourceMeshes) || graph.sourceMeshes.length === 0
    || !Array.isArray(graph.muscles) || graph.muscles.length === 0) {
    contradictory.push(field('sourceInventory', { reason: 'source meshes and muscle constructions are required' }));
    return contradictory;
  }
  const constructionIds = graph.muscles.map(muscle => muscle?.identity?.construction_id);
  if (constructionIds.some(id => !nonEmptyString(id)) || new Set(constructionIds).size !== constructionIds.length) {
    contradictory.push(field('constructionIdentity', { reason: 'construction ids must be nonempty and unique' }));
  }
  const endpointAuthorityCounts = {
    source_mesh: 0,
    provisional_muscle_surface: 0,
    self_reference: 0,
    unclassified_object: 0,
  };
  for (const muscle of graph.muscles) {
    for (const endpoint of [muscle?.origin, muscle?.insertion]) {
      if (Object.hasOwn(endpointAuthorityCounts, endpoint?.sourceAuthority)) {
        endpointAuthorityCounts[endpoint.sourceAuthority] += 1;
      } else {
        contradictory.push(field('endpointAuthority', {
          constructionId: muscle?.identity?.construction_id ?? null,
          authority: endpoint?.sourceAuthority ?? null,
        }));
      }
    }
  }
  if (!isDeepStrictEqual(endpointAuthorityCounts, graph.endpointAuthorityCounts)) {
    contradictory.push(field('endpointAuthorityCounts', {
      declared: graph.endpointAuthorityCounts ?? null,
      computed: endpointAuthorityCounts,
    }));
  }
  return contradictory;
}

function validateFixtureMember(muscle, role, contradictory) {
  if (muscle.missingComponentRoles.length > 0 || muscle.completenessAuthority !== 'declared_components_present') {
    contradictory.push(field('selectedFixtureCompleteness', {
      role,
      constructionId: muscle.identity.construction_id,
      missingComponentRoles: [...muscle.missingComponentRoles],
    }));
  }
  const inadmissibleEndpoints = ['origin', 'insertion'].filter(endpoint => (
    muscle[endpoint].sourceAuthority !== 'source_mesh'
  ));
  if (inadmissibleEndpoints.length > 0) {
    contradictory.push(field('selectedFixtureEndpointAdmission', {
      role,
      constructionId: muscle.identity.construction_id,
      endpoints: inadmissibleEndpoints.map(endpoint => ({
        endpoint,
        sourceAuthority: muscle[endpoint].sourceAuthority,
        sourceName: muscle[endpoint].sourceName,
      })),
    }));
  }
}

function resolveSelection(selection, graph) {
  if (selection === null || selection === undefined) return { fixture: null, contradictory: [] };
  const contradictory = [];
  if (!exactKeys(selection, SELECTION_FIELDS)) {
    contradictory.push(field('selectedFixture', { reason: 'selection fields are missing or carry unreviewed baggage' }));
    return { fixture: null, contradictory };
  }
  if (selection.schema !== TRACK_M_RELATION_FIXTURE_SELECTION_SCHEMA
    || selection.graphSha256 !== graph.graphSha256
    || !nonEmptyString(selection.primaryConstructionId)
    || !nonEmptyString(selection.matchedWrongDonorConstructionId)
    || !Array.isArray(selection.nullConstructionIds)
    || selection.nullConstructionIds.length !== 2
    || selection.nullConstructionIds.some(id => !nonEmptyString(id))
    || !exactKeys(selection.authority, AUTHORITY_FIELDS)
    || !nonEmptyString(selection.authority.id)
    || !validHash(selection.authority.sha256)
    || selection.selectedBeforeOutputInspection !== true) {
    contradictory.push(field('selectedFixtureAuthority', {
      reason: 'selection must bind this graph, one primary route, one donor, two nulls, one content-addressed authority, and preregistration',
    }));
    return { fixture: null, contradictory };
  }
  const roleIds = {
    primaryRoute: selection.primaryConstructionId,
    matchedWrongDonor: selection.matchedWrongDonorConstructionId,
    nullControl0: selection.nullConstructionIds[0],
    nullControl1: selection.nullConstructionIds[1],
  };
  if (new Set(Object.values(roleIds)).size !== Object.values(roleIds).length) {
    contradictory.push(field('selectedFixtureIdentity', {
      reason: 'fixture roles must resolve four distinct constructions',
      roleIds,
    }));
    return { fixture: null, contradictory };
  }
  const byId = new Map(graph.muscles.map(muscle => [muscle.identity.construction_id, muscle]));
  const members = Object.fromEntries(Object.entries(roleIds).map(([role, id]) => [role, byId.get(id)]));
  const absentRoles = Object.entries(members).filter(([, muscle]) => !muscle).map(([role]) => role);
  if (absentRoles.length > 0) {
    contradictory.push(field('selectedFixtureIdentity', {
      reason: 'one or more construction ids do not exist in the authenticated graph',
      absentRoles,
      roleIds,
    }));
    return { fixture: null, contradictory };
  }
  for (const [role, muscle] of Object.entries(members)) {
    validateFixtureMember(muscle, role, contradictory);
  }
  const primaryFamily = {
    originSourceName: members.primaryRoute.origin.sourceName,
    insertionSourceName: members.primaryRoute.insertion.sourceName,
  };
  const donorFamily = {
    originSourceName: members.matchedWrongDonor.origin.sourceName,
    insertionSourceName: members.matchedWrongDonor.insertion.sourceName,
  };
  if (!isDeepStrictEqual(primaryFamily, donorFamily)) {
    contradictory.push(field('selectedFixtureRouteFamily', {
      reason: 'primary route and matched donor must share the same ordered source-object family',
      primaryFamily,
      donorFamily,
    }));
  }
  const primaryBudget = constructionBudget(members.primaryRoute);
  for (const [role, muscle] of Object.entries(members)) {
    const budget = constructionBudget(muscle);
    if (!isDeepStrictEqual(primaryBudget, budget)) {
      contradictory.push(field('selectedFixtureConstructionBudget', {
        role,
        constructionId: muscle.identity.construction_id,
        primaryBudget,
        effectiveBudget: budget,
      }));
    }
  }
  for (const role of ['nullControl0', 'nullControl1']) {
    const muscle = members[role];
    if (muscle.origin.sourceName !== muscle.insertion.sourceName) {
      contradictory.push(field('selectedFixtureNullControl', {
        role,
        constructionId: muscle.identity.construction_id,
        reason: 'null control must connect one source object to itself',
        originSourceName: muscle.origin.sourceName,
        insertionSourceName: muscle.insertion.sourceName,
      }));
    }
  }
  return {
    fixture: contradictory.length === 0 ? {
      primaryRoute: relationSummary(members.primaryRoute),
      matchedWrongDonor: relationSummary(members.matchedWrongDonor),
      nullControls: selection.nullConstructionIds.map(id => relationSummary(byId.get(id))),
      sourceObjectFamily: primaryFamily,
      claimCeiling: 'routing-sensitivity-only',
      transformAuthority: 'external-molten-source-side-fixture-receipt',
      toleranceAuthority: 'not-authorized-by-selection',
    } : null,
    contradictory,
  };
}

export function validateTrackMAuthoredSourceM0Preflight({
  graph,
  expectedGraphSha256,
  expectedSourceSha256,
  bundleSource,
  bundlePlan,
  selection = null,
} = {}) {
  const bundleCompatibility = validateTrackMM0BundleCompatibility({
    source: bundleSource,
    plan: bundlePlan,
  });
  const contradictory = validateGraph(graph, expectedGraphSha256, expectedSourceSha256);
  if (bundleCompatibility.schema !== TRACK_M_M0_BUNDLE_COMPATIBILITY_SCHEMA
    || bundleCompatibility.comparisonClassCompatible !== true
    || bundleCompatibility.disposition !== HOLD_MUSCULATURE_SOURCE_EVIDENCE) {
    contradictory.push(field('bundlePredecessor', {
      reason: 'unchanged Track M predecessor did not reproduce its exact compatible-hold result',
      compatibilityDisposition: bundleCompatibility.disposition,
      failures: bundleCompatibility.failures,
    }));
  }
  if (contradictory.length > 0) {
    return failedResult({ graph, bundleCompatibility, contradictory });
  }

  const incompleteConstructions = graph.muscles
    .filter(muscle => muscle.missingComponentRoles.length > 0)
    .map(muscle => ({
      constructionId: muscle.identity.construction_id,
      missingComponentRoles: [...muscle.missingComponentRoles],
    }));
  const completeSourceRelations = graph.muscles.filter(muscle => (
    muscle.missingComponentRoles.length === 0
    && muscle.completenessAuthority === 'declared_components_present'
    && muscle.origin.sourceAuthority === 'source_mesh'
    && muscle.insertion.sourceAuthority === 'source_mesh'
  ));
  const provisionalRelations = graph.muscles.filter(muscle => (
    muscle.origin.sourceAuthority === 'provisional_muscle_surface'
    || muscle.insertion.sourceAuthority === 'provisional_muscle_surface'
  ));
  const resolvedSelection = resolveSelection(selection, graph);
  if (resolvedSelection.contradictory.length > 0) {
    return failedResult({
      graph,
      bundleCompatibility,
      contradictory: resolvedSelection.contradictory,
    });
  }

  const satisfied = [
    field('trackScope', { value: graph.trackId }),
    field('sourceIdentity', {
      sourceSha256: graph.source.sha256,
      byteLength: graph.source.byteLength,
    }),
    field('sourcePath', {
      requestedPath: graph.source.requestedPath,
      effectivePath: graph.source.effectivePath,
    }),
    field('sourceCompletenessAndKnownOmissions', {
      completeness: incompleteConstructions.length === 0 ? 'complete' : 'incomplete',
      omissionCount: incompleteConstructions.length,
    }),
    field('sourceUnits', {
      system: graph.scene.unitSettings.system,
      lengthUnit: graph.scene.unitSettings.lengthUnit,
      scaleLength: graph.scene.unitSettings.scaleLength,
    }),
    field('authoredConstructionInventory', {
      sourceMeshCount: graph.sourceMeshes.length,
      muscleCount: graph.muscles.length,
    }),
    field('componentLineage', { graphSha256: graph.graphSha256 }),
    field('rawGeometryAndTransforms', { graphSha256: graph.graphSha256 }),
    field('bundleComparisonClass', {
      sourceReceiptId: bundleCompatibility.sourceReceiptId,
      planId: bundleCompatibility.planId,
      conditionIds: bundleCompatibility.mappedPredicates.conditionIds,
    }),
  ];
  if (resolvedSelection.fixture) {
    satisfied.push(field('selectedFixture', {
      primaryConstructionId: resolvedSelection.fixture.primaryRoute.constructionId,
      matchedWrongDonorConstructionId: resolvedSelection.fixture.matchedWrongDonor.constructionId,
      nullConstructionIds: resolvedSelection.fixture.nullControls.map(relation => relation.constructionId),
      selectionAuthorityId: selection.authority.id,
      claimCeiling: resolvedSelection.fixture.claimCeiling,
    }));
  }
  const missing = SOURCE_GRAPH_MISSING_M0_FIELDS
    .filter(fieldId => !(resolvedSelection.fixture && fieldId === 'matchedControlIdentity'))
    .map(fieldId => field(fieldId));
  if (!resolvedSelection.fixture) {
    missing.unshift(
      field('selectedFixture', {
        candidateCount: completeSourceRelations.length,
        owner: 'external-relation-selection-authority',
      }),
      field('selectedFixtureAuthority'),
    );
  }

  return {
    schema: TRACK_M_AUTHORED_SOURCE_M0_PREFLIGHT_SCHEMA,
    disposition: HOLD_MUSCULATURE_SOURCE_EVIDENCE,
    ok: false,
    graphSha256: graph.graphSha256,
    sourceSha256: graph.source.sha256,
    graphIdentityVerified: true,
    bundlePredecessorCompatible: true,
    selectedFixture: resolvedSelection.fixture,
    candidates: {
      totalConstructions: graph.muscles.length,
      completeSourceMeshRelations: completeSourceRelations.length,
      provisionalEndpointRelations: provisionalRelations.length,
      incompleteConstructions: incompleteConstructions.length,
      completeSourceMeshConstructionIds: completeSourceRelations.map(muscle => muscle.identity.construction_id),
    },
    sourceOmissions: incompleteConstructions,
    satisfied,
    missing,
    contradictory: [],
    selectionAdapter: selectionAdapterContract(),
    bundleCompatibility,
  };
}
