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
import {
  TRACK_M_DENSE_ROUTING_FIXTURE_COMPILER_ID,
  TRACK_M_ROUTING_FIXTURE_COMPILER_ID,
  TRACK_M_ROUTING_FIXTURE_SCHEMA,
} from './track-m-routing-fixture-core.mjs';

export const TRACK_M_AUTHORED_SOURCE_M0_PREFLIGHT_SCHEMA =
  'kaminos.track-m-authored-source-m0-preflight.v0';
const VERIFIED_SELECTION_SCHEMA = 'kaminos.track-m-verified-routing-fixture-selection.v0';
const DENSE_SELECTION_ID = 'src-pelvis-cube002-m34-m13-routing-sensitivity-v0';
const DENSE_SELECTED_ROUTE_IDS = Object.freeze(['muscle-34', 'muscle-13']);
const DENSE_NULL_CONTROL_IDS = Object.freeze(['muscle-35', 'muscle-38']);
const DENSE_ADMITTED_CLAIMS = Object.freeze(['source-side-routing-sensitivity-fixture']);
const DENSE_HELD_CLAIMS = Object.freeze([
  'correct-route-superiority',
  'musculature-source-evidence',
  'selected-relation-m0',
  'station-instance',
  'source-to-cast-correspondence',
  'expected-signed-localization',
  'packing-geometry-admission',
]);

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SELECTION_FIELDS = Object.freeze([
  'schema',
  'graphSha256',
  'primaryConstructionId',
  'matchedWrongDonorConstructionId',
  'nullConstructionIds',
  'authority',
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
    schema: TRACK_M_ROUTING_FIXTURE_SCHEMA,
    requiredCallerFields: ['routingFixture', 'expectedRoutingFixtureSha256'],
    selectsForCaller: false,
    resolution: 'a caller-expected semantic fixture identity resolves one primary route, one matched donor, and two same-object null controls; all relation identities are copied from the authenticated graph',
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
  for (const muscle of graph.muscles) {
    const constructionId = muscle?.identity?.construction_id ?? null;
    if (!isPlainObject(muscle)
      || !isPlainObject(muscle.identity)
      || !Array.isArray(muscle.missingComponentRoles)
      || !isPlainObject(muscle.origin)
      || !isPlainObject(muscle.insertion)) {
      contradictory.push(field('graphConstructionShape', {
        constructionId,
        reason: 'each construction requires identity, endpoint, and missing-component records before relation evaluation',
      }));
      continue;
    }
    if (muscle.completenessAuthority !== 'declared_components_present'
      || muscle.missingComponentRoles.length !== 0) {
      continue;
    }
    if (![muscle.identity.instance_id, muscle.identity.lineage_id,
      muscle.origin.handleInstanceId, muscle.origin.sourceName,
      muscle.insertion.handleInstanceId, muscle.insertion.sourceName]
      .every(nonEmptyString)) {
      contradictory.push(field('graphCompleteConstructionIdentity', {
        constructionId,
        reason: 'a construction declared complete requires stable instance, lineage, endpoint-handle, and endpoint-source identities',
      }));
    }
    const pathGeometrySha256 = muscle.components?.path?.geometry?.contentSha256;
    const surfaceGeometrySha256 = muscle.components?.surface?.geometry?.contentSha256;
    if (!validHash(pathGeometrySha256) || !validHash(surfaceGeometrySha256)) {
      contradictory.push(field('graphCompleteConstructionGeometry', {
        constructionId,
        reason: 'a construction declared complete requires content-addressed path and surface geometry',
        pathGeometrySha256: pathGeometrySha256 ?? null,
        surfaceGeometrySha256: surfaceGeometrySha256 ?? null,
      }));
    }
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

function validateMatchedRoutePreservation(correctRoutes, matchedRoutes, contradictory) {
  if (!Array.isArray(correctRoutes) || !Array.isArray(matchedRoutes)
    || correctRoutes.length !== 2 || matchedRoutes.length !== 2) {
    contradictory.push(field('routingFixtureMatchedRoutePreservation', {
      reason: 'direct-field verification requires exactly two correct and two matched-wrong routes',
    }));
    return;
  }
  for (let index = 0; index < correctRoutes.length; index += 1) {
    const correctRoute = correctRoutes[index];
    const donorRoute = correctRoutes[1 - index];
    const matchedRoute = matchedRoutes[index];
    if (!isPlainObject(correctRoute?.origin)
      || !isPlainObject(correctRoute?.insertion)
      || !isPlainObject(donorRoute?.insertion)
      || !isPlainObject(matchedRoute?.origin)
      || !isPlainObject(matchedRoute?.insertion)
      || !nonEmptyString(correctRoute.insertion.authoredHandleInstanceId)) {
      contradictory.push(field('routingFixtureMatchedRoutePreservation', {
        reason: 'each route requires inspectable origin and insertion assignment objects',
        constructionId: correctRoute?.constructionId ?? null,
      }));
      continue;
    }
    const expectedMatchedRoute = structuredClone(correctRoute);
    expectedMatchedRoute.insertion = structuredClone(donorRoute.insertion);
    expectedMatchedRoute.insertion.authoredHandleInstanceId =
      correctRoute.insertion.authoredHandleInstanceId;
    if (!isDeepStrictEqual(matchedRoute, expectedMatchedRoute)) {
      contradictory.push(field('routingFixtureMatchedRoutePreservation', {
        reason: 'matched-wrong must preserve the complete route and origin while changing only the insertion assignment to the paired donor',
        constructionId: correctRoute.constructionId,
        donorConstructionId: donorRoute.constructionId,
        originPreserved: isDeepStrictEqual(matchedRoute.origin, correctRoute.origin),
        insertionMatchesPairedDonor: isDeepStrictEqual(
          matchedRoute.insertion,
          expectedMatchedRoute.insertion,
        ),
      }));
    }
  }
}

function sameMembers(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every(item => right.includes(item));
}

function denseRouteIdentity(muscle) {
  return {
    constructionId: muscle.identity.construction_id,
    instanceId: muscle.identity.instance_id,
    lineageId: muscle.identity.lineage_id,
    originHandleInstanceId: muscle.origin.handleInstanceId,
    insertionHandleInstanceId: muscle.insertion.handleInstanceId,
    pathGeometrySha256: muscle.components.path.geometry.contentSha256,
    surfaceGeometrySha256: muscle.components.surface.geometry.contentSha256,
  };
}

function validateRoutingFixtureProfile(routingFixture, graph, contradictory) {
  const dense = routingFixture.selection?.id === DENSE_SELECTION_ID;
  const expectedCompilerId = dense
    ? TRACK_M_DENSE_ROUTING_FIXTURE_COMPILER_ID
    : TRACK_M_ROUTING_FIXTURE_COMPILER_ID;
  if (routingFixture.compilerId !== expectedCompilerId) {
    contradictory.push(field('routingFixtureContract', {
      reason: 'routing fixture compiler identity must match its selected profile',
      selectionId: routingFixture.selection?.id ?? null,
      expectedCompilerId,
      effectiveCompilerId: routingFixture.compilerId ?? null,
    }));
  }
  if (!dense) {
    return {
      fixtureProfile: 'sparse-selected-relation',
      absentNeighborRouteCount: null,
      tolerance: routingFixture.deltaLedger?.tolerance ?? null,
    };
  }

  const selectedIds = [
    routingFixture.selection?.correctConstructionId,
    routingFixture.selection?.crossWireDonorConstructionId,
  ];
  const absent = routingFixture.conditions?.absent;
  const correct = routingFixture.conditions?.correct;
  const matchedWrong = routingFixture.conditions?.matchedWrong;
  const density = routingFixture.densityContext;
  const neighborIds = density?.neighborConstructionIds;
  const absentNeighborIds = absent?.preservedNeighborConstructionIds;
  const familyIds = density?.familyConstructionIds;
  const expectedFamilyIds = Array.isArray(neighborIds) ? [...selectedIds, ...neighborIds] : null;
  const removedIds = [...selectedIds].sort();

  if (!isDeepStrictEqual(selectedIds, DENSE_SELECTED_ROUTE_IDS)
    || !isDeepStrictEqual(routingFixture.selection?.nullConstructionIds, DENSE_NULL_CONTROL_IDS)) {
    contradictory.push(field('routingFixtureDenseSelection', {
      reason: 'dense profile must bind the exact M34 primary, M13 donor, M35 null, and M38 null roles',
      selectedRouteIds: selectedIds,
      nullConstructionIds: routingFixture.selection?.nullConstructionIds ?? null,
    }));
  }

  if (absent?.id !== 'deep-geometry-absent'
    || !Array.isArray(absent?.routes)
    || absent.routes.length !== 0
    || absent.deepGeometryPresent !== false
    || absent.testedRelationPresent !== false
    || !sameMembers(absent.removedConstructionIds, removedIds)
    || correct?.id !== 'deep-geometry-correctly-routed'
    || correct.deepGeometryPresent !== true
    || correct.testedRelationPresent !== true
    || matchedWrong?.id !== 'deep-geometry-matched-wrong-routing'
    || matchedWrong.deepGeometryPresent !== true
    || matchedWrong.testedRelationPresent !== false) {
    contradictory.push(field('routingFixtureDenseConditions', {
      reason: 'dense profile requires exact absent, correct, and matched-wrong condition identities and presence states',
    }));
  }

  if (density?.familyRouteCount !== 36
    || density?.neighborRouteCount !== 34
    || absent?.preservedNeighborRouteCount !== 34
    || !sameMembers(neighborIds, absentNeighborIds)
    || !sameMembers(familyIds, expectedFamilyIds)
    || absent?.preservedNeighborFamilyIdentitySha256 !== density?.neighborFamilyIdentitySha256
    || !validHash(density?.neighborFamilyIdentitySha256)
    || !validHash(density?.familyIdentitySha256)) {
    contradictory.push(field('routingFixtureDenseNeighborPreservation', {
      reason: 'dense profile must preserve the exact 34-route neighbor family around the selected pair',
      familyRouteCount: density?.familyRouteCount ?? null,
      densityNeighborRouteCount: density?.neighborRouteCount ?? null,
      absentNeighborRouteCount: absent?.preservedNeighborRouteCount ?? null,
    }));
  }

  const family = density?.family;
  const graphFamily = graph.muscles
    .filter(muscle => (
      muscle.completenessAuthority === 'declared_components_present'
      && muscle.missingComponentRoles.length === 0
      && muscle.origin.sourceAuthority === 'source_mesh'
      && muscle.insertion.sourceAuthority === 'source_mesh'
      && muscle.origin.sourceName === family?.originSource
      && muscle.insertion.sourceName === family?.insertionSource
    ))
    .sort((left, right) => (
      left.identity.construction_id.localeCompare(right.identity.construction_id)
    ));
  const graphFamilyIds = graphFamily.map(muscle => muscle.identity.construction_id);
  const selectedIdSet = new Set(DENSE_SELECTED_ROUTE_IDS);
  const graphNeighbors = graphFamily.filter(muscle => !selectedIdSet.has(muscle.identity.construction_id));
  const graphNeighborIds = graphNeighbors.map(muscle => muscle.identity.construction_id);
  const graphFamilyIdentitySha256 = hashJson(graphFamily.map(denseRouteIdentity));
  const graphNeighborIdentitySha256 = hashJson(graphNeighbors.map(denseRouteIdentity));
  if (!sameMembers(familyIds, graphFamilyIds)
    || !sameMembers(neighborIds, graphNeighborIds)
    || density?.familyIdentitySha256 !== graphFamilyIdentitySha256
    || density?.neighborFamilyIdentitySha256 !== graphNeighborIdentitySha256
    || absent?.preservedNeighborFamilyIdentitySha256 !== graphNeighborIdentitySha256) {
    contradictory.push(field('routingFixtureDenseGraphFamily', {
      reason: 'dense family membership and identity hashes must derive from the authenticated source graph',
      fixtureFamilyConstructionIds: familyIds ?? null,
      graphFamilyConstructionIds: graphFamilyIds,
      fixtureFamilyIdentitySha256: density?.familyIdentitySha256 ?? null,
      graphFamilyIdentitySha256,
      fixtureNeighborIdentitySha256: density?.neighborFamilyIdentitySha256 ?? null,
      graphNeighborIdentitySha256,
    }));
  }

  if (!isDeepStrictEqual(routingFixture.selection?.family, density?.family)
    || density?.targetCorridor?.freezeStatus !== 'frozen-before-condition-output'
    || density?.targetCorridor?.conditionIndependent !== true
    || density?.targetCorridor?.authority !== 'authenticated-source-route-endpoints'
    || density?.targetCorridor?.attachmentNeighborhoodRadius !== null
    || density?.targetCorridor?.castProjection !== 'unavailable-held'
    || density?.targetCorridor?.expectedSignedLocalization !== 'unassigned-held'
    || density?.targetCorridor?.neighboringRouteLeakage !== 'unmeasured-held') {
    contradictory.push(field('routingFixtureDenseCorridor', {
      reason: 'dense comparison corridor must remain source-bound, condition-independent, and explicitly held downstream',
    }));
  }

  if (routingFixture.deltaLedger?.tolerance !== null
    || routingFixture.deltaLedger?.toleranceAuthority !== 'unassigned'
    || routingFixture.deltaLedger?.budgetMatchStatus !== 'measured-awaiting-owner-tolerance') {
    contradictory.push(field('routingFixtureDenseTolerance', {
      reason: 'dense source observations must retain null tolerance and unassigned tolerance authority',
      tolerance: routingFixture.deltaLedger?.tolerance ?? null,
      toleranceAuthority: routingFixture.deltaLedger?.toleranceAuthority ?? null,
      budgetMatchStatus: routingFixture.deltaLedger?.budgetMatchStatus ?? null,
    }));
  }

  if (!sameMembers(routingFixture.authority?.admittedClaims, DENSE_ADMITTED_CLAIMS)
    || !sameMembers(routingFixture.authority?.heldClaims, DENSE_HELD_CLAIMS)) {
    contradictory.push(field('routingFixtureClaimBoundary', {
      reason: 'dense profile must admit only source-side sensitivity and retain every downstream hold',
      admittedClaims: routingFixture.authority?.admittedClaims ?? null,
      heldClaims: routingFixture.authority?.heldClaims ?? null,
    }));
  }

  return {
    fixtureProfile: 'dense-m34-m13',
    absentNeighborRouteCount: absent?.preservedNeighborRouteCount ?? null,
    tolerance: routingFixture.deltaLedger?.tolerance ?? null,
  };
}

function resolveRoutingFixture(routingFixture, expectedRoutingFixtureSha256, graph) {
  if (routingFixture === null || routingFixture === undefined) {
    return {
      selection: null,
      evidence: null,
      contradictory: [field('routingFixtureIdentity', {
        reason: 'routing fixture and caller-expected semantic identity are required',
        expectedRoutingFixtureSha256: expectedRoutingFixtureSha256 ?? null,
      })],
    };
  }
  const contradictory = [];
  if (!isPlainObject(routingFixture)) {
    return {
      selection: null,
      evidence: null,
      contradictory: [field('routingFixtureIdentity', { reason: 'routing fixture must be an object' })],
    };
  }
  const {
    fixtureSha256,
    schema: fixtureSchema,
    ...fixtureCore
  } = routingFixture;
  const effectiveFixtureSha256 = hashJson(fixtureCore);
  if (!validHash(expectedRoutingFixtureSha256)
    || !validHash(fixtureSha256)
    || fixtureSha256 !== effectiveFixtureSha256
    || fixtureSha256 !== expectedRoutingFixtureSha256) {
    contradictory.push(field('routingFixtureIdentity', {
      reason: 'routing fixture semantic identity must match both its canonical content and the caller-expected identity',
      expectedRoutingFixtureSha256: expectedRoutingFixtureSha256 ?? null,
      declaredRoutingFixtureSha256: fixtureSha256 ?? null,
      effectiveRoutingFixtureSha256: effectiveFixtureSha256,
    }));
  }
  const profileEvidence = validateRoutingFixtureProfile(routingFixture, graph, contradictory);
  if (fixtureSchema !== TRACK_M_ROUTING_FIXTURE_SCHEMA
    || routingFixture.status !== 'compiled'
    || routingFixture.trackId !== graph.trackId) {
    contradictory.push(field('routingFixtureContract', {
      reason: 'routing fixture schema, compiler, status, or track does not match the authenticated Track M contract',
    }));
  }
  if (routingFixture.source?.assetSha256 !== graph.source.sha256
    || routingFixture.source?.graphSha256 !== graph.graphSha256) {
    contradictory.push(field('routingFixtureSourceIdentity', {
      reason: 'routing fixture source or graph identity does not match the authenticated source graph',
      fixtureSourceSha256: routingFixture.source?.assetSha256 ?? null,
      fixtureGraphSha256: routingFixture.source?.graphSha256 ?? null,
      graphSourceSha256: graph.source.sha256,
      graphSha256: graph.graphSha256,
    }));
  }
  const selection = routingFixture.selection;
  const primaryConstructionId = selection?.correctConstructionId;
  const matchedWrongDonorConstructionId = selection?.crossWireDonorConstructionId;
  const nullConstructionIds = selection?.nullConstructionIds;
  if (!nonEmptyString(primaryConstructionId)
    || !nonEmptyString(matchedWrongDonorConstructionId)
    || !Array.isArray(nullConstructionIds)
    || nullConstructionIds.length !== 2
    || nullConstructionIds.some(id => !nonEmptyString(id))
    || !nonEmptyString(selection?.selectionAuthority)) {
    contradictory.push(field('routingFixtureSelection', {
      reason: 'routing fixture must identify one correct route, one matched donor, two nulls, and one selection authority',
    }));
  }
  const selectedRouteIds = [primaryConstructionId, matchedWrongDonorConstructionId];
  const correctRouteIds = routingFixture.conditions?.correct?.routes?.map(route => route.constructionId);
  const matchedRouteIds = routingFixture.conditions?.matchedWrong?.routes?.map(route => route.constructionId);
  if (!isDeepStrictEqual(correctRouteIds, selectedRouteIds)
    || !isDeepStrictEqual(matchedRouteIds, selectedRouteIds)) {
    contradictory.push(field('routingFixtureRouteIdentity', {
      reason: 'correct and matched-wrong conditions must carry the selected route pair in caller-selected order',
      selectedRouteIds,
      correctRouteIds: correctRouteIds ?? null,
      matchedRouteIds: matchedRouteIds ?? null,
    }));
  }
  validateMatchedRoutePreservation(
    routingFixture.conditions?.correct?.routes,
    routingFixture.conditions?.matchedWrong?.routes,
    contradictory,
  );
  const nullIds = routingFixture.nulls?.map(control => control.constructionId);
  if (!isDeepStrictEqual(nullIds, nullConstructionIds)
    || routingFixture.nulls?.some(control => control.sameObject !== true)) {
    contradictory.push(field('routingFixtureNullIdentity', {
      reason: 'routing fixture nulls must match the selected ids and remain same-object controls',
      selectedNullIds: nullConstructionIds ?? null,
      effectiveNullIds: nullIds ?? null,
    }));
  }
  if (!routingFixture.authority?.admittedClaims?.includes('source-side-routing-sensitivity-fixture')
    || !routingFixture.authority?.heldClaims?.includes('selected-relation-m0')
    || !routingFixture.authority?.heldClaims?.includes('packing-geometry-admission')) {
    contradictory.push(field('routingFixtureClaimBoundary', {
      reason: 'routing fixture must admit only source-side sensitivity while preserving M0 and packing holds',
    }));
  }
  return {
    selection: contradictory.length === 0 ? {
      schema: VERIFIED_SELECTION_SCHEMA,
      graphSha256: graph.graphSha256,
      primaryConstructionId,
      matchedWrongDonorConstructionId,
      nullConstructionIds: [...nullConstructionIds],
      authority: {
        id: selection.selectionAuthority,
        sha256: fixtureSha256,
      },
    } : null,
    evidence: contradictory.length === 0 ? {
      routingFixtureSha256: fixtureSha256,
      selectionAuthorityId: selection.selectionAuthority,
      selectionChronology: 'caller_asserted_not_validator_proven',
      matchedRoutePreservation: 'direct_fixture_field_assertion',
      originsPreserved: true,
      insertionAssignmentsOnlyChanged: true,
      ...profileEvidence,
    } : null,
    contradictory,
  };
}

function resolveSelection(selection, graph) {
  if (selection === null || selection === undefined) return { fixture: null, contradictory: [] };
  const contradictory = [];
  if (!exactKeys(selection, SELECTION_FIELDS)) {
    contradictory.push(field('selectedFixture', { reason: 'selection fields are missing or carry unreviewed baggage' }));
    return { fixture: null, contradictory };
  }
  if (selection.schema !== VERIFIED_SELECTION_SCHEMA
    || selection.graphSha256 !== graph.graphSha256
    || !nonEmptyString(selection.primaryConstructionId)
    || !nonEmptyString(selection.matchedWrongDonorConstructionId)
    || !Array.isArray(selection.nullConstructionIds)
    || selection.nullConstructionIds.length !== 2
    || selection.nullConstructionIds.some(id => !nonEmptyString(id))
    || !exactKeys(selection.authority, AUTHORITY_FIELDS)
    || !nonEmptyString(selection.authority.id)
    || !validHash(selection.authority.sha256)) {
    contradictory.push(field('selectedFixtureAuthority', {
      reason: 'verified routing selection must bind this graph, one primary route, one donor, two nulls, and one content-addressed authority',
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
  routingFixture = null,
  expectedRoutingFixtureSha256 = null,
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
  const resolvedRoutingFixture = resolveRoutingFixture(
    routingFixture,
    expectedRoutingFixtureSha256,
    graph,
  );
  if (resolvedRoutingFixture.contradictory.length > 0) {
    return failedResult({
      graph,
      bundleCompatibility,
      contradictory: resolvedRoutingFixture.contradictory,
    });
  }
  const resolvedSelection = resolveSelection(resolvedRoutingFixture.selection, graph);
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
      routingFixtureSha256: resolvedRoutingFixture.evidence.routingFixtureSha256,
      selectionAuthorityId: resolvedRoutingFixture.evidence.selectionAuthorityId,
      selectionChronology: resolvedRoutingFixture.evidence.selectionChronology,
      matchedRoutePreservation: resolvedRoutingFixture.evidence.matchedRoutePreservation,
      originsPreserved: resolvedRoutingFixture.evidence.originsPreserved,
      insertionAssignmentsOnlyChanged:
        resolvedRoutingFixture.evidence.insertionAssignmentsOnlyChanged,
      fixtureProfile: resolvedRoutingFixture.evidence.fixtureProfile,
      absentNeighborRouteCount: resolvedRoutingFixture.evidence.absentNeighborRouteCount,
      tolerance: resolvedRoutingFixture.evidence.tolerance,
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
