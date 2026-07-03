import { WEBGPU_ROUTE_RECEIPT_SCHEMA } from './route-receipt.js';
import { WEBGPU_ROUTE_EVIDENCE_CLASSIFICATION_SCHEMA } from './route-receipt-consumer.js';
import { WEBGPU_RUNTIME_PROFILE_SCHEMA } from './runtime-profile.js';
import {
  WEBGPU_ROUTE_BACKPRESSURE_SCHEMA,
  WEBGPU_ROUTE_SCHEDULER_SCHEMA,
} from './scheduler-backpressure.js';
import {
  WEBGPU_ROUTE_DEFINITION_SCHEMA,
  WEBGPU_ROUTE_REQUEST_SCHEMA,
  WEBGPU_ROUTE_RESULT_SCHEMA,
} from './route-boundary.js';
import { WEBGPU_INFERENCE_KIT_VERSION } from './kernel-profile.js';

export function createWebGpuRouteSchemaContract(input = {}) {
  return {
    schema: 'kaminos.webgpu-route-schema-contract.v0',
    kitVersion: input.kitVersion || WEBGPU_INFERENCE_KIT_VERSION,
    definitionSchema: WEBGPU_ROUTE_DEFINITION_SCHEMA,
    requestSchema: WEBGPU_ROUTE_REQUEST_SCHEMA,
    resultSchema: WEBGPU_ROUTE_RESULT_SCHEMA,
    receiptSchema: WEBGPU_ROUTE_RECEIPT_SCHEMA,
    runtimeProfileSchema: WEBGPU_RUNTIME_PROFILE_SCHEMA,
    evidenceClassificationSchema: WEBGPU_ROUTE_EVIDENCE_CLASSIFICATION_SCHEMA,
    schedulerSchema: WEBGPU_ROUTE_SCHEDULER_SCHEMA,
    backpressureSchema: WEBGPU_ROUTE_BACKPRESSURE_SCHEMA,
    authoritativeReceiptStatuses: ['real'],
    nonAuthoritativeReceiptStatuses: ['fallback', 'partial', 'cached'],
  };
}
