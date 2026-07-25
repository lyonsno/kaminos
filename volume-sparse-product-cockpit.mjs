export const SPARSE_PRODUCT_ROUTE_IDENTITY = 'kaminos.volume.sparse-live-cockpit.v0';
export const SPARSE_PRODUCT_SOURCE_AUTHORITY = 'live-baked-sidecar-plus-fluid-material-v0';
export const SPARSE_PRODUCT_POPULATION_AUTHORITY = 'ordinary-live-sparse-compaction-v0';
export const SPARSE_PRODUCT_RENDERER_IDENTITY = 'live-boundary-sidecar-learned-attribute-splats-v0';
export const SPARSE_PRODUCT_FLOW_TANGENT_RENDERER_IDENTITY =
  'live-boundary-sidecar-flow-kernel-moment-covariance-splats-v0';
export const SPARSE_PRODUCT_LEARNED_TANGENT_RENDERER_IDENTITY =
  'live-boundary-sidecar-world-tangent-covariance-splats-v0';
export const SPARSE_PRODUCT_ATTRIBUTE_MODEL_IDENTITY =
  'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472';

export const SPARSE_PRODUCT_GEOMETRY_MODES = Object.freeze({
  'historical-round': Object.freeze({
    label: 'Historical round',
    boundarySplatMode: 'learned',
    footprintAuthority: 'learned-camera-facing-billboard-v0',
    defaultRadius: 0.98,
    defaultSharpness: 12,
    rendererIdentity: SPARSE_PRODUCT_RENDERER_IDENTITY,
    attributeModelIdentity: SPARSE_PRODUCT_ATTRIBUTE_MODEL_IDENTITY,
  }),
  'flow-tangent': Object.freeze({
    label: 'Flow tangent',
    boundarySplatMode: 'kernel_moment_covariance',
    footprintAuthority: 'base-footprint-plus-flow-kernel-second-moment-tangent-covariance-v0',
    defaultRadius: 1,
    defaultSharpness: 3.4,
    rendererIdentity: SPARSE_PRODUCT_FLOW_TANGENT_RENDERER_IDENTITY,
    attributeModelIdentity: SPARSE_PRODUCT_ATTRIBUTE_MODEL_IDENTITY,
  }),
  'learned-tangent': Object.freeze({
    label: 'Learned tangent',
    boundarySplatMode: 'world_covariance',
    footprintAuthority: 'world-gradient-tangent-covariance-v0',
    defaultRadius: 1,
    defaultSharpness: 3.4,
    rendererIdentity: SPARSE_PRODUCT_LEARNED_TANGENT_RENDERER_IDENTITY,
    attributeModelIdentity: SPARSE_PRODUCT_ATTRIBUTE_MODEL_IDENTITY,
  }),
});

export const SPARSE_PRODUCT_OPTICAL_UNIT_MODES = Object.freeze([
  'legacy-global-path-scale-diagnostic-v0',
  'projected-native-cell-area-integral-normalized-v0',
]);

export const SPARSE_PRODUCT_RESOLUTIONS = Object.freeze([32, 48, 64, 96, 128, 140, 160]);
const DIAGNOSTIC_ROUTE_PARAMETERS = Object.freeze([
  'full_support_live_step',
  'full_support_source_field_manifest',
  'full_support_source_fluid',
  'full_support_source_front',
  'full_support_stage_b_manifest',
  'full_support_stage_b_manifest_sha256',
  'full_support_persistent_cohort_manifest',
]);

export function parseSparseProductRoute(params) {
  const route = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const requested = ['1', 'true', 'on'].includes(String(route.get('volume_product_cockpit') || '').toLowerCase());
  if (!requested) return null;
  const conflicts = DIAGNOSTIC_ROUTE_PARAMETERS.filter(parameter => route.has(parameter));
  if (route.has('warmup_steps') && Number(route.get('warmup_steps')) !== 0) {
    conflicts.push('warmup_steps');
  }
  if (conflicts.length > 0) {
    throw new Error(`sparse-product-route-conflicts-with-diagnostic-bootstrap:${conflicts.join(',')}`);
  }
  const resolutionRaw = route.get('volume_resolution') ?? '96';
  const resolution = Number(resolutionRaw);
  if (!Number.isInteger(resolution) || !SPARSE_PRODUCT_RESOLUTIONS.includes(resolution)) {
    throw new Error(`sparse-product-resolution-unsupported:${resolutionRaw}`);
  }
  const geometry = route.get('volume_splat_geometry') || 'historical-round';
  const geometryDefinition = SPARSE_PRODUCT_GEOMETRY_MODES[geometry];
  if (!geometryDefinition) throw new Error(`sparse-product-geometry-unsupported:${geometry}`);
  const opticalUnitMode = route.get('volume_optical_unit_mode')
    || 'projected-native-cell-area-integral-normalized-v0';
  if (!SPARSE_PRODUCT_OPTICAL_UNIT_MODES.includes(opticalUnitMode)) {
    throw new Error(`sparse-product-optical-units-unsupported:${opticalUnitMode}`);
  }
  const boundarySplatRadius = parseBoundedNumber(
    route.get('volume_boundary_splat_radius'),
    geometryDefinition.defaultRadius,
    0.35,
    1.5,
    'sparse-product-radius',
  );
  const boundarySplatSharpness = parseBoundedNumber(
    route.get('volume_boundary_splat_sharpness'),
    geometryDefinition.defaultSharpness,
    1,
    12,
    'sparse-product-sharpness',
  );
  return {
    schema: 'kaminos.volume.sparse-live-cockpit-request.v0',
    routeIdentity: SPARSE_PRODUCT_ROUTE_IDENTITY,
    requested: true,
    resolution,
    geometry,
    boundarySplatMode: geometryDefinition.boundarySplatMode,
    footprintAuthority: geometryDefinition.footprintAuthority,
    boundarySplatRadius,
    boundarySplatSharpness,
    rendererIdentity: geometryDefinition.rendererIdentity,
    attributeModelIdentity: geometryDefinition.attributeModelIdentity,
    opticalUnitMode,
    sourceAuthority: SPARSE_PRODUCT_SOURCE_AUTHORITY,
    populationAuthority: SPARSE_PRODUCT_POPULATION_AUTHORITY,
  };
}

export function makeSparseProductRuntimeReceipt(request, state = {}) {
  if (!request?.requested || request.routeIdentity !== SPARSE_PRODUCT_ROUTE_IDENTITY) {
    throw new Error('sparse-product-request-missing');
  }
  for (const field of [
    'simGrid',
    'boundarySplatSourceAuthority',
    'boundarySplatMode',
    'boundarySplatFootprintAuthority',
    'boundarySplatRadius',
    'boundarySplatSharpness',
    'boundarySplatRendererIdentity',
    'boundarySplatAttributeModelIdentity',
    'boundarySplatCandidateCount',
    'boundarySplatOverflowCount',
    'boundarySplatFallbackReason',
    'boundarySplatControlGeneration',
    'effectiveBoundarySplatOpticalUnitMode',
    'boundarySplatOpticalUnitModeFallbackReason',
    'selectiveHeadLiveEffectiveRole',
    'selectiveHeadLiveCompositionEffective',
    'selectiveHeadLivePassReceipt',
    'liveCompleteFlameOpticalCoefficientsEnabled',
    'persistentSparseCohortGpuReceipt',
  ]) {
    if (!Object.hasOwn(state, field)) {
      throw new Error(`sparse-product-effective-field-missing:${field}`);
    }
  }
  const runtimeStarting = state.active !== true
    || Number(state.frameCount) < 1
    || Number(state.simStepCount) < 1;
  let identitySettlingReason = null;
  const requireEffectiveIdentity = ({
    effective,
    requested: requestedIdentity,
    substitution,
    settling,
  }) => {
    if (effective === requestedIdentity) return;
    if (runtimeStarting && (effective == null || Boolean(settling))) {
      identitySettlingReason ||= settling || `sparse-product-${substitution}-settling`;
      return;
    }
    throw new Error(`sparse-product-${substitution}:${requestedIdentity}:${effective}`);
  };
  if (state.liveCompleteFlameOpticalCoefficientsEnabled) {
    throw new Error('sparse-product-diagnostic-coefficients-active');
  }
  if (state.persistentSparseCohortGpuReceipt) {
    throw new Error('sparse-product-frozen-cohort-active');
  }
  if (state.boundarySplatFallbackReason) {
    throw new Error(`sparse-product-renderer-fallback:${state.boundarySplatFallbackReason}`);
  }
  requireEffectiveIdentity({
    effective: state.boundarySplatSourceAuthority,
    requested: request.sourceAuthority,
    substitution: 'source-substitution',
  });
  requireEffectiveIdentity({
    effective: state.simGrid,
    requested: request.resolution,
    substitution: 'resolution-substitution',
  });
  requireEffectiveIdentity({
    effective: state.boundarySplatMode,
    requested: request.boundarySplatMode,
    substitution: 'geometry-substitution',
  });
  requireEffectiveIdentity({
    effective: state.boundarySplatFootprintAuthority,
    requested: request.footprintAuthority,
    substitution: 'footprint-substitution',
  });
  requireEffectiveIdentity({
    effective: state.boundarySplatRendererIdentity,
    requested: request.rendererIdentity,
    substitution: 'renderer-substitution',
  });
  requireEffectiveIdentity({
    effective: state.boundarySplatAttributeModelIdentity,
    requested: request.attributeModelIdentity,
    substitution: 'attribute-model-substitution',
  });
  requireEffectiveIdentity({
    effective: state.effectiveBoundarySplatOpticalUnitMode,
    requested: request.opticalUnitMode,
    substitution: 'optical-unit-substitution',
  });
  if (state.boundarySplatOpticalUnitModeFallbackReason) {
    throw new Error(`sparse-product-optical-unit-fallback:${state.boundarySplatOpticalUnitModeFallbackReason}`);
  }
  const candidateCount = Number(state.boundarySplatCandidateCount);
  if (Number.isFinite(candidateCount) && candidateCount >= request.resolution ** 3) {
    throw new Error(`sparse-product-population-not-sparse:${candidateCount}:${request.resolution ** 3}`);
  }
  if (Number(state.boundarySplatOverflowCount) > 0) {
    throw new Error(`sparse-product-population-overflow:${state.boundarySplatOverflowCount}`);
  }
  requireEffectiveIdentity({
    effective: state.selectiveHeadLiveEffectiveRole,
    requested: 'off',
    substitution: 'role-substitution',
  });
  requireEffectiveIdentity({
    effective: state.selectiveHeadLiveCompositionEffective,
    requested: 'splat-only-v0',
    substitution: 'composition-substitution',
    settling: state.selectiveHeadLiveCompositionEffective === 'off'
      ? 'sparse-product-composition-awaiting-first-frame'
      : false,
  });
  const renderPass = state.selectiveHeadLivePassReceipt;
  if (!renderPass || !Object.hasOwn(renderPass, 'controlGeneration')) {
    throw new Error('sparse-product-effective-field-missing:selectiveHeadLivePassReceipt.controlGeneration');
  }
  if (renderPass.composition !== 'splat-only-v0' && !runtimeStarting) {
    throw new Error(`sparse-product-render-pass-substitution:splat-only-v0:${renderPass.composition}`);
  }
  const currentControlGeneration = Number(state.boundarySplatControlGeneration);
  const appliedPassControlGeneration = Number(renderPass.controlGeneration);
  const renderPassGenerationMatched = Number.isInteger(currentControlGeneration)
    && currentControlGeneration >= 0
    && appliedPassControlGeneration === currentControlGeneration;
  const runtimeProgressComplete = Number(state.simStepCount) > 0
    && Number(state.frameCount) > 0;
  const renderPassApplied = renderPass.splatEncoded === true
    && renderPass.splatApplied === true
    && renderPass.raymarchApplied !== true
    && !renderPass.fallbackReason;
  const effectiveGeometry = Object.entries(SPARSE_PRODUCT_GEOMETRY_MODES)
    .find(([, definition]) => (
      definition.boundarySplatMode === state.boundarySplatMode
      && definition.footprintAuthority === state.boundarySplatFootprintAuthority
    ))?.[0] || null;
  const materialRequested = {
    boundarySplatRadius: request.boundarySplatRadius,
    boundarySplatSharpness: request.boundarySplatSharpness,
    rendererIdentity: request.rendererIdentity,
    attributeModelIdentity: request.attributeModelIdentity,
  };
  const materialEffective = {
    boundarySplatRadius: Number(state.boundarySplatRadius),
    boundarySplatSharpness: Number(state.boundarySplatSharpness),
    rendererIdentity: state.boundarySplatRendererIdentity,
    attributeModelIdentity: state.boundarySplatAttributeModelIdentity,
  };
  const authoredOverrideApplied = (
    materialEffective.boundarySplatRadius !== materialRequested.boundarySplatRadius
    || materialEffective.boundarySplatSharpness !== materialRequested.boundarySplatSharpness
  );
  const effective = state.active === true
    && Number.isFinite(candidateCount)
    && candidateCount > 0
    && Number(state.boundarySplatOverflowCount) === 0
    && state.simGrid === request.resolution
    && effectiveGeometry !== null
    && state.boundarySplatMode === request.boundarySplatMode
    && state.boundarySplatFootprintAuthority === request.footprintAuthority
    && state.boundarySplatSourceAuthority === request.sourceAuthority
    && state.effectiveBoundarySplatOpticalUnitMode === request.opticalUnitMode
    && renderPassApplied
    && renderPassGenerationMatched
    && runtimeProgressComplete
    && !runtimeStarting
    && state.liveCompleteFlameOpticalCoefficientsEnabled === false
    && state.persistentSparseCohortGpuReceipt === null
    && identitySettlingReason === null;
  return {
    schema: 'kaminos.volume.sparse-live-cockpit-receipt.v0',
    routeIdentity: SPARSE_PRODUCT_ROUTE_IDENTITY,
    status: effective ? 'effective' : 'settling',
    requested: { ...request },
    effective: {
      active: state.active === true,
      resolution: state.simGrid ?? null,
      geometry: effectiveGeometry,
      boundarySplatMode: state.boundarySplatMode ?? null,
      footprintAuthority: state.boundarySplatFootprintAuthority ?? null,
      opticalUnitMode: state.effectiveBoundarySplatOpticalUnitMode ?? null,
      sourceAuthority: state.boundarySplatSourceAuthority ?? null,
      simStepCount: state.simStepCount ?? 0,
      frameCount: state.frameCount ?? 0,
      boundarySplatControlGeneration: Number.isInteger(currentControlGeneration)
        ? currentControlGeneration
        : null,
      appliedPassControlGeneration: Number.isInteger(appliedPassControlGeneration)
        ? appliedPassControlGeneration
        : null,
      fluidStateResetCount: state.fluidStateResetCount ?? 0,
    },
    material: {
      requested: materialRequested,
      effective: materialEffective,
      authoredOverrideApplied,
    },
    population: {
      authority: SPARSE_PRODUCT_POPULATION_AUTHORITY,
      candidates: Number.isFinite(candidateCount) ? candidateCount : null,
      fullGridCells: request.resolution ** 3,
      overflow: state.boundarySplatOverflowCount ?? null,
    },
    diagnosticBootstrapApplied: state.liveCompleteFlameOpticalCoefficientsEnabled === true,
    persistentCohortApplied: state.persistentSparseCohortGpuReceipt !== null,
    renderPass: { ...renderPass },
    fallbackReason: identitySettlingReason
      || (!renderPassApplied
        ? 'sparse-product-render-pass-not-applied'
        : !renderPassGenerationMatched
          ? `sparse-product-render-pass-generation-stale:${renderPass.controlGeneration}:${state.boundarySplatControlGeneration}`
          : !runtimeProgressComplete || runtimeStarting
            ? 'sparse-product-runtime-progress-incomplete'
            : null),
  };
}

function parseBoundedNumber(raw, fallback, minimum, maximum, label) {
  const value = raw == null ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label}-unsupported:${raw}`);
  }
  return value;
}

export async function runSparseProductResolutionTransition({
  currentResolution,
  requestedResolution,
  currentRuntime,
  stage,
  commit,
  rollback,
  dispose,
}) {
  if (!SPARSE_PRODUCT_RESOLUTIONS.includes(Number(currentResolution))) {
    throw new Error(`sparse-product-current-resolution-unsupported:${currentResolution}`);
  }
  if (!SPARSE_PRODUCT_RESOLUTIONS.includes(Number(requestedResolution))) {
    throw new Error(`sparse-product-resolution-unsupported:${requestedResolution}`);
  }
  if (
    typeof stage !== 'function'
    || typeof commit !== 'function'
    || typeof rollback !== 'function'
    || typeof dispose !== 'function'
  ) {
    throw new Error('sparse-product-resolution-transaction-hooks-missing');
  }
  let staged = null;
  let nextRuntime = null;
  let phase = 'staging';
  try {
    staged = await stage({
      currentResolution: Number(currentResolution),
      requestedResolution: Number(requestedResolution),
      currentRuntime,
    });
    if (!staged || staged.status !== 'effective') {
      throw new Error(`staged-runtime-not-effective:${staged?.status || 'missing'}`);
    }
    if (Number(staged.effectiveResolution) !== Number(requestedResolution)) {
      throw new Error(
        `staged-resolution-substitution:${requestedResolution}:${staged.effectiveResolution ?? 'missing'}`,
      );
    }
    nextRuntime = staged.runtime || staged;
    phase = 'committing';
    await commit(nextRuntime, staged);
    phase = 'committed';
    let previousRuntimeCleanup = { status: 'complete', error: null };
    try {
      await dispose(currentRuntime);
    } catch (cleanupError) {
      previousRuntimeCleanup = {
        status: 'failed',
        error: cleanupError?.message || String(cleanupError),
      };
    }
    return {
      schema: 'kaminos.volume.sparse-product-resolution-transition.v0',
      status: 'effective',
      requestedResolution: Number(requestedResolution),
      effectiveResolution: Number(staged.effectiveResolution),
      previousResolution: Number(currentResolution),
      retainedRuntime: false,
      stageIdentity: staged.stageIdentity || null,
      sourceAuthority: staged.sourceAuthority || null,
      resetCountAfter: staged.resetCountAfter ?? null,
      diagnosticCoefficientsActiveAfter: staged.diagnosticCoefficientsActiveAfter === true,
      previousRuntimeCleanup,
      fallbackReason: null,
    };
  } catch (cause) {
    let rollbackReceipt = { status: 'not-required', error: null };
    if (phase === 'committing' && nextRuntime) {
      try {
        await rollback({
          currentRuntime,
          nextRuntime,
          staged,
          cause,
        });
        rollbackReceipt = { status: 'effective', error: null };
      } catch (rollbackError) {
        rollbackReceipt = {
          status: 'failed',
          error: rollbackError?.message || String(rollbackError),
        };
      }
    }
    const retainedRuntime = phase !== 'committing' || rollbackReceipt.status === 'effective';
    if (nextRuntime && nextRuntime !== currentRuntime && retainedRuntime) {
      try {
        await dispose(nextRuntime);
      } catch {}
    }
    const failureReason = cause?.message || String(cause);
    const error = new Error(`sparse-product-resolution-transition-failed:${failureReason}`, { cause });
    error.receipt = {
      schema: 'kaminos.volume.sparse-product-resolution-transition.v0',
      status: 'failed',
      requestedResolution: Number(requestedResolution),
      effectiveResolution: retainedRuntime ? Number(currentResolution) : null,
      previousResolution: Number(currentResolution),
      retainedRuntime,
      stageIdentity: staged?.stageIdentity || null,
      sourceAuthority: null,
      rollback: rollbackReceipt,
      fallbackReason: failureReason,
      failureReason,
    };
    throw error;
  }
}
