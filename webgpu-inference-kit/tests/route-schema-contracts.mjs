import assert from 'node:assert/strict';

import {
  WEBGPU_INFERENCE_KIT_VERSION,
  WEBGPU_ROUTE_DEFINITION_SCHEMA,
  WEBGPU_ROUTE_EVIDENCE_CLASSIFICATION_SCHEMA,
  WEBGPU_ROUTE_BACKPRESSURE_SCHEMA,
  WEBGPU_ROUTE_RECEIPT_SCHEMA,
  WEBGPU_ROUTE_REQUEST_SCHEMA,
  WEBGPU_ROUTE_RESULT_SCHEMA,
  WEBGPU_ROUTE_SCHEDULER_SCHEMA,
  WEBGPU_RUNTIME_PROFILE_SCHEMA,
  createWebGpuRouteSchemaContract,
} from '../src/index.js';

const contract = createWebGpuRouteSchemaContract();

assert.equal(WEBGPU_INFERENCE_KIT_VERSION, '0.1.24');
assert.equal(WEBGPU_ROUTE_DEFINITION_SCHEMA, 'kaminos.webgpu-route-definition.v0');
assert.equal(WEBGPU_ROUTE_REQUEST_SCHEMA, 'kaminos.webgpu-route-request.v0');
assert.equal(WEBGPU_ROUTE_RESULT_SCHEMA, 'kaminos.webgpu-route-result.v0');
assert.equal(WEBGPU_ROUTE_RECEIPT_SCHEMA, 'kaminos.webgpu-route-receipt.v0');
assert.equal(WEBGPU_RUNTIME_PROFILE_SCHEMA, 'kaminos.webgpu-runtime-profile.v0');
assert.equal(WEBGPU_ROUTE_EVIDENCE_CLASSIFICATION_SCHEMA, 'kaminos.webgpu-route-evidence-classification.v0');
assert.equal(WEBGPU_ROUTE_SCHEDULER_SCHEMA, 'kaminos.webgpu-route-scheduler.v0');
assert.equal(WEBGPU_ROUTE_BACKPRESSURE_SCHEMA, 'kaminos.webgpu-route-backpressure.v0');

assert.equal(contract.schema, 'kaminos.webgpu-route-schema-contract.v0');
assert.equal(contract.kitVersion, WEBGPU_INFERENCE_KIT_VERSION);
assert.equal(contract.definitionSchema, WEBGPU_ROUTE_DEFINITION_SCHEMA);
assert.equal(contract.requestSchema, WEBGPU_ROUTE_REQUEST_SCHEMA);
assert.equal(contract.resultSchema, WEBGPU_ROUTE_RESULT_SCHEMA);
assert.equal(contract.receiptSchema, WEBGPU_ROUTE_RECEIPT_SCHEMA);
assert.equal(contract.runtimeProfileSchema, WEBGPU_RUNTIME_PROFILE_SCHEMA);
assert.equal(contract.evidenceClassificationSchema, WEBGPU_ROUTE_EVIDENCE_CLASSIFICATION_SCHEMA);
assert.equal(contract.schedulerSchema, WEBGPU_ROUTE_SCHEDULER_SCHEMA);
assert.equal(contract.backpressureSchema, WEBGPU_ROUTE_BACKPRESSURE_SCHEMA);
assert.deepEqual(contract.authoritativeReceiptStatuses, ['real']);
assert.deepEqual(contract.nonAuthoritativeReceiptStatuses, ['fallback', 'partial', 'cached']);
assert.equal(createWebGpuRouteSchemaContract({ kitVersion: 'consumer-override' }).kitVersion, 'consumer-override');

console.log('route schema contracts passed');
