import assert from 'node:assert/strict';

import {
  WEBGPU_ROUTE_DEFINITION_SCHEMA,
  WEBGPU_ROUTE_RECEIPT_SCHEMA,
  WEBGPU_ROUTE_REQUEST_SCHEMA,
  WEBGPU_ROUTE_RESULT_SCHEMA,
  createWebGpuRouteSchemaContract,
} from '../src/index.js';

const contract = createWebGpuRouteSchemaContract();

assert.equal(WEBGPU_ROUTE_DEFINITION_SCHEMA, 'kaminos.webgpu-route-definition.v0');
assert.equal(WEBGPU_ROUTE_REQUEST_SCHEMA, 'kaminos.webgpu-route-request.v0');
assert.equal(WEBGPU_ROUTE_RESULT_SCHEMA, 'kaminos.webgpu-route-result.v0');
assert.equal(WEBGPU_ROUTE_RECEIPT_SCHEMA, 'kaminos.webgpu-route-receipt.v0');

assert.equal(contract.schema, 'kaminos.webgpu-route-schema-contract.v0');
assert.equal(contract.definitionSchema, WEBGPU_ROUTE_DEFINITION_SCHEMA);
assert.equal(contract.requestSchema, WEBGPU_ROUTE_REQUEST_SCHEMA);
assert.equal(contract.resultSchema, WEBGPU_ROUTE_RESULT_SCHEMA);
assert.equal(contract.receiptSchema, WEBGPU_ROUTE_RECEIPT_SCHEMA);
assert.deepEqual(contract.authoritativeReceiptStatuses, ['real']);
assert.deepEqual(contract.nonAuthoritativeReceiptStatuses, ['fallback', 'partial', 'cached']);

console.log('route schema contracts passed');
