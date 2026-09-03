#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as volumeCore from '../volume-core.js';

const source = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.equal(
  typeof volumeCore.validateFullFieldDerivedBufferMaterialization,
  'function',
  'full-field export exposes one fail-loud derived-buffer materialization boundary',
);

const missingSidecar = volumeCore.validateFullFieldDerivedBufferMaterialization({
  boundarySidecarBuilt: false,
  boundarySplatsEncoded: false,
  boundarySplatMode: 'off',
});
assert.deepEqual(
  missingSidecar,
  {
    ok: false,
    failurePhase: 'derived-buffer-materialization',
    reason: 'full-field-sidecar-not-built',
  },
  'full-field export cannot publish stale or zero-initialized sidecar bytes',
);

const missingSplats = volumeCore.validateFullFieldDerivedBufferMaterialization({
  boundarySidecarBuilt: true,
  boundarySplatsEncoded: false,
  boundarySplatMode: 'kernel_moment_covariance',
});
assert.deepEqual(
  missingSplats,
  {
    ok: false,
    failurePhase: 'derived-buffer-materialization',
    reason: 'full-field-splats-not-encoded',
  },
  'a non-off full-field splat export cannot silently publish an empty population',
);

const emptyNonOffPopulation = volumeCore.validateFullFieldDerivedBufferMaterialization({
  boundarySidecarBuilt: true,
  boundarySplatsEncoded: true,
  boundarySplatMode: 'kernel_moment_covariance',
  boundarySplatDraw: {
    instanceCount: 0,
    candidateCount: 0,
  },
}, { requireDrawState: true });
assert.deepEqual(
  emptyNonOffPopulation,
  {
    ok: false,
    failurePhase: 'derived-buffer-materialization',
    reason: 'full-field-splat-population-empty',
  },
  'successful pass encoding does not let a non-off zero-row splat population publish as captured',
);

assert.deepEqual(
  volumeCore.validateFullFieldDerivedBufferMaterialization({
    boundarySidecarBuilt: true,
    boundarySplatsEncoded: false,
    boundarySplatMode: 'off',
    boundarySplatDraw: {
      instanceCount: 0,
      candidateCount: 0,
    },
  }, { requireDrawState: true }),
  { ok: true, failurePhase: null, reason: null },
  'raymarch-only full-field export still requires a current sidecar but legitimately carries zero splat rows',
);

assert.deepEqual(
  volumeCore.validateFullFieldDerivedBufferMaterialization({
    boundarySidecarBuilt: true,
    boundarySplatsEncoded: true,
    boundarySplatMode: 'kernel_moment_covariance',
    boundarySplatDraw: {
      instanceCount: 4,
      candidateCount: 6,
    },
  }, { requireDrawState: true }),
  { ok: true, failurePhase: null, reason: null },
  'a current sidecar and current non-off splat population admit the export',
);

assert.match(
  source,
  /materializeFullFieldDerivedBuffersForDebugExport[\s\S]*?encodeBoundarySidecar\(encoder, \{\s*explicitSidecarConsumer: FULL_FIELD_DEBUG_EXPORT_SIDECAR_CONSUMER[\s\S]*?encodeBoundarySplats\(encoder, \{\s*explicitSplatConsumer: FULL_FIELD_DEBUG_EXPORT_SPLAT_CONSUMER/,
  'full-field export names both derived consumers instead of depending on visible presentation',
);
assert.match(
  source,
  /validateFullFieldDerivedBufferMaterialization\(derivedBuffers\)[\s\S]*?failurePhase: materializationValidation\.failurePhase[\s\S]*?return \{ ok: false, \.\.\.failed \};/,
  'beginDebugFullFieldExport fails before readback when current derived materialization is absent',
);
assert.match(
  source,
  /const capturedMaterialization = \{[\s\S]*?\.\.\.derivedBuffers,[\s\S]*?boundarySplatDraw: captured\.boundarySplatDraw,[\s\S]*?validateFullFieldDerivedBufferMaterialization\([\s\S]*?capturedMaterialization,[\s\S]*?\{ requireDrawState: true \},/,
  'beginDebugFullFieldExport validates post-submit draw counts before publishing a captured population',
);
assert.match(
  source,
  /sampleBoundarySplatFootprintAudit[\s\S]*?explicitSplatConsumer: BOUNDARY_SPLAT_FOOTPRINT_AUDIT_CONSUMER/,
  'footprint audit explicitly materializes the population it reads',
);
assert.match(
  source,
  /sampleFourArmHeldStateLedger[\s\S]*?explicitSplatConsumer: FOUR_ARM_HELD_STATE_LEDGER_CONSUMER/,
  'four-arm held-state ledger identifies its splat consumer',
);
assert.match(
  source,
  /sampleBoundarySplatGpuProfile[\s\S]*?explicitSplatConsumer: BOUNDARY_SPLAT_GPU_PROFILE_CONSUMER/,
  'explicit GPU profiling remains callable without changing visible composition',
);
assert.match(
  source,
  /runNonRidgeOpticalCapturePass[\s\S]*?explicitSidecarConsumer: NONRIDGE_OPTICAL_CAPTURE_SIDECAR_CONSUMER/,
  'non-ridge optical capture identifies its sidecar dependency',
);

console.log('disabled splat diagnostic consumer contracts passed');
