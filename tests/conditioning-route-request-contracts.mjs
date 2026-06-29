import assert from 'node:assert/strict';

import {
  CONDITIONING_ROUTE_REQUEST_SCHEMA,
  buildConditioningRouteRequest,
  conditioningRouteRequestWitness,
} from '../conditioning-route-request.mjs';
import {
  createFixturePrimitiveSpecimenCheckpoint,
  exportSpecimenCheckpointViews,
} from '../specimen-checkpoint.mjs';

const checkpoint = createFixturePrimitiveSpecimenCheckpoint();
const viewArtifacts = exportSpecimenCheckpointViews(checkpoint);
const request = buildConditioningRouteRequest({
  requestId: 'fixture-red-lerm-conditioning-request-001',
  checkpoint,
  viewArtifacts,
  requestedRoute: 'image_conditioned_generation',
  intendedEffectiveRoute: 'request_only',
  prompt: 'matte red eyeless lerm, soft sensing nub, squat carrier body',
  seed: 270627,
  routeConfig: {
    scheduler: 'fixture-request',
    strength: 0.62,
  },
  runtimeIdentity: {
    runtime: 'node-contract-test',
    routeAdapter: 'none-request-only',
  },
});

assert.equal(CONDITIONING_ROUTE_REQUEST_SCHEMA, 'kaminos.conditioning-route-request.v0');
assert.equal(request.schema, CONDITIONING_ROUTE_REQUEST_SCHEMA);
assert.equal(request.requestId, 'fixture-red-lerm-conditioning-request-001');
assert.equal(request.specimenCheckpointId, checkpoint.specimenId);
assert.equal(request.specimenKind, 'red_lerm');
assert.equal(request.firstVerticalRole, 'carrier_actor');
assert.equal(request.requestedRoute, 'image_conditioned_generation');
assert.equal(request.intendedEffectiveRoute, 'request_only');
assert.deepEqual(request.inputArtifactIds, ['fixture-red-lerm-primitive-001-beauty']);
assert.equal(request.conditioningArtifactIds.depth, 'fixture-red-lerm-primitive-001-depth');
assert.equal(request.conditioningArtifactIds.normal, 'fixture-red-lerm-primitive-001-normal');
assert.equal(request.conditioningArtifactIds.silhouette, 'fixture-red-lerm-primitive-001-silhouette');
assert.equal(request.conditioningArtifactIds.mask, 'fixture-red-lerm-primitive-001-mask');
assert.ok(request.conditioningRoles.includes('depth_source'));
assert.ok(request.conditioningRoles.includes('normal_source'));
assert.ok(request.conditioningRoles.includes('mask_source'));
assert.ok(request.negativeLaw.includes('no_visible_eyes'));
assert.deepEqual(request.outputArtifactIds, []);
assert.equal(request.routeReceipt.requestedRoute, 'image_conditioned_generation');
assert.equal(request.routeReceipt.effectiveRoute, 'request_only');
assert.ok(request.sourceTruthWarnings.includes('route_request_not_generator_execution_truth'));
assert.ok(request.sourceTruthWarnings.includes('route_receipt_requested_effective_mismatch'));
assert.ok(request.routeReceipt.sourceTruthWarnings.includes('route_request_not_generator_execution_truth'));

const witness = conditioningRouteRequestWitness({ request });
assert.equal(witness.schema, 'kaminos.conditioning-route-request-witness.v0');
assert.equal(witness.ok, true);
assert.equal(witness.requestSchema, CONDITIONING_ROUTE_REQUEST_SCHEMA);
assert.deepEqual(witness.conditioningViewKinds, ['beauty', 'depth', 'mask', 'normal', 'silhouette']);
assert.ok(witness.sourceTruthWarnings.includes('route_request_not_generator_execution_truth'));
