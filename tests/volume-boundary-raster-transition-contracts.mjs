import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const coreSource = readFileSync(new URL('volume-core.js', root), 'utf8');
const cockpitSource = readFileSync(new URL('volume-selective-head-live.html', root), 'utf8');
const core = await import(new URL('volume-core.js', root));

assert.equal(
  typeof core.boundarySplatCapacityLimitReceipt,
  'function',
  'boundary raster capacity admission must be a deterministic, testable contract',
);
assert.equal(
  typeof core.boundarySplatFallbackRaymarchFireSuppression,
  'function',
  'explicit splat fallback must have a deterministic fire-authority contract',
);
assert.equal(
  typeof core.boundarySplatTelemetryReceiptApplies,
  'function',
  'asynchronous boundary telemetry must be bound to the control generation that produced it',
);
assert.equal(
  typeof core.boundarySplatTelemetryControlSignature,
  'function',
  'candidate telemetry invalidation must cover same-mode admission-control changes',
);

const defaultDeviceLimit = core.boundarySplatCapacityLimitReceipt({
  capacity: 1_048_576,
  descriptorRowsRequested: true,
  limits: {
    maxBufferSize: 268_435_456,
    maxStorageBufferBindingSize: 268_435_456,
  },
});
assert.equal(defaultDeviceLimit.requiredDescriptorBytes, 419_430_400);
assert.equal(defaultDeviceLimit.supported, false);
assert.match(defaultDeviceLimit.failureReason, /required=419430400/);
assert.match(defaultDeviceLimit.failureReason, /maxBufferSize=268435456/);
assert.match(defaultDeviceLimit.failureReason, /maxStorageBufferBindingSize=268435456/);

const negotiatedDeviceLimit = core.boundarySplatCapacityLimitReceipt({
  capacity: 1_048_576,
  descriptorRowsRequested: true,
  limits: {
    maxBufferSize: 536_870_912,
    maxStorageBufferBindingSize: 536_870_912,
  },
});
assert.equal(negotiatedDeviceLimit.supported, true);
assert.equal(negotiatedDeviceLimit.failureReason, null);

const ordinarySplatLimit = core.boundarySplatCapacityLimitReceipt({
  capacity: 1_048_576,
  descriptorRowsRequested: false,
  limits: {
    maxBufferSize: 268_435_456,
    maxStorageBufferBindingSize: 268_435_456,
  },
});
assert.equal(ordinarySplatLimit.requiredDescriptorBytes, 400);
assert.equal(ordinarySplatLimit.supported, true);

assert.equal(core.boundarySplatFallbackRaymarchFireSuppression({
  requestedRaymarchFireAuthority: 0,
  splatRequested: true,
  splatAvailable: true,
}), 1);
assert.equal(core.boundarySplatFallbackRaymarchFireSuppression({
  requestedRaymarchFireAuthority: 0,
  splatRequested: true,
  splatAvailable: false,
}), 0);
assert.equal(core.boundarySplatTelemetryReceiptApplies({
  receiptGeneration: 7,
  currentGeneration: 8,
}), false);
assert.equal(core.boundarySplatTelemetryReceiptApplies({
  receiptGeneration: 8,
  currentGeneration: 8,
}), true);
const unionControlSignature = core.boundarySplatTelemetryControlSignature({
  boundarySplatMode: 'kernel_moment_full_flame_union',
  reactionBoundaryGradient: 1.05,
});
const reducedUnionControlSignature = core.boundarySplatTelemetryControlSignature({
  boundarySplatMode: 'kernel_moment_full_flame_union',
  reactionBoundaryGradient: 0,
});
assert.notEqual(
  unionControlSignature,
  reducedUnionControlSignature,
  'same-mode candidate-reducing controls must invalidate pending telemetry',
);

assert.match(
  coreSource,
  /maxRequestedFlowKernelDescriptorBytes[\s\S]*requiredLimits\.maxBufferSize[\s\S]*requiredLimits\.maxStorageBufferBindingSize/,
  'device creation must negotiate both limits needed by live kernel-descriptor growth',
);
assert.match(
  coreSource,
  /function growBoundarySplatCapacity\([\s\S]*boundarySplatCapacityLimitReceipt\([\s\S]*if \(!limitReceipt\.supported\)[\s\S]*return false[\s\S]*device\.createBuffer/,
  'capacity growth must reject unsupported allocation before creating an invalid WebGPU buffer',
);
assert.match(
  coreSource,
  /boundarySplatCapacityAdmissionFailureReason/,
  'a rejected capacity transition must remain visible until a later control transition clears it',
);
assert.match(
  coreSource,
  /function effectiveSelectiveHeadRaymarchFireSuppression\(\)[\s\S]*volumePresentationModeEffective === 'intrinsic'[\s\S]*appearanceDecompositionActive\(\)[\s\S]*boundarySplatFallbackRaymarchFireSuppression/,
  'raymarch-only presentation and optical assays must recover flame authority while splats are suppressed',
);
assert.match(
  coreSource,
  /uniforms\[316\]\s*=\s*effectiveSelectiveHeadRaymarchFireSuppression\(\)/,
  'the shader suppression uniform must use effective presentation authority rather than the remembered hybrid request',
);
assert.match(
  coreSource,
  /function syncFlowKernelDescriptorCaptureBuffer\(\)[\s\S]*if \(!rowsRequested\)[\s\S]*flowKernelDescriptorBufferCapacity !== 1[\s\S]*rebuildBoundarySplatBindGroups\(\)[\s\S]*previousDescriptorBuffer\?\.destroy\(\)[\s\S]*boundarySplatCapacityAdmissionFailureReason = null/,
  'descriptor opt-out must release the full descriptor buffer and clear its capacity-only fallback',
);
assert.match(
  coreSource,
  /previousBoundarySplatTelemetryControlSignature !== nextBoundarySplatTelemetryControlSignature[\s\S]*boundarySplatControlGeneration \+= 1[\s\S]*capacity: boundarySplatCapacity/,
  'all admission-affecting control changes must invalidate old telemetry and re-admit the current allocation before observing new growth',
);
assert.match(
  coreSource,
  /const telemetryGeneration = boundarySplatTelemetryCopyGeneration[\s\S]*boundarySplatTelemetryReceiptApplies\([\s\S]*receiptGeneration: telemetryGeneration[\s\S]*currentGeneration: boundarySplatControlGeneration[\s\S]*return/,
  'old-mode asynchronous telemetry must not mutate the current mode or trigger capacity growth',
);
assert.match(
  cockpitSource,
  /function setPresentation\(presentation\)[\s\S]*presentation === 'intrinsic'[\s\S]*setAppearanceAssay\('off'\)/,
  'Intrinsic must explicitly turn off an incompatible optical assay instead of presenting black pixels',
);
assert.match(
  cockpitSource,
  /function setAppearanceAssay\(mode\)[\s\S]*mode !== 'off'[\s\S]*requestedPresentation !== 'beauty'[\s\S]*setPresentation\('beauty'\)/,
  'an optical assay must explicitly select its Beauty raymarch presentation substrate',
);
assert.match(
  cockpitSource,
  /#status\.bad\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere[^}]*user-select:\s*text[^}]*\}/,
  'the cockpit status must expose the complete selectable failure receipt instead of ellipsizing it',
);
assert.match(
  cockpitSource,
  /#status\.bad\s*\{[^}]*text-overflow:\s*clip[^}]*overflow:\s*visible[^}]*\}/,
  'failure status must override compact receipt clipping rather than hiding the decisive error',
);

console.log('volume boundary raster transition contracts passed');
