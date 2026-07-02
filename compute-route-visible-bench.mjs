export const COMPUTE_ROUTE_CONTENTION_WITNESS_SCHEMA = 'kaminos.compute-route-contention-witness.v0';
export const COMPUTE_ROUTE_VISIBLE_BENCH_SCHEMA = 'kaminos.compute-route-visible-bench.v0';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(asArray(values).map(value => String(value)).filter(Boolean))];
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function cloneObject(value) {
  if (!value || typeof value !== 'object') return null;
  return JSON.parse(JSON.stringify(value));
}

function decodeBase64Url(value) {
  if (!value) return null;
  if (typeof Buffer !== 'undefined') {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function encodeBase64Url(value) {
  const json = JSON.stringify(value);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(json, 'utf8').toString('base64url');
  }
  const utf8 = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of utf8) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function routeFamilyLabel(witness = {}) {
  const routeText = [
    witness.routeIdentity?.pipelineId,
    witness.routeIdentity?.requestedRoute,
    witness.routeIdentity?.effectiveRoute,
  ].filter(Boolean).join(' ').toLowerCase();
  if (routeText.includes('sharp')) return 'SHARP';
  if (routeText.includes('moge')) return 'MoGE';
  if (routeText.includes('kimodo')) return 'Kimodo';
  if (routeText.includes('sf3d')) return 'SF3D';
  return 'The route';
}

function outputNoun(witness = {}) {
  const roles = asArray(witness.outputHandoff?.artifacts).map(artifact => (
    `${artifact.id || ''} ${artifact.role || ''}`
  ).toLowerCase());
  if (roles.some(role => role.includes('splat'))) return 'a splat';
  if (roles.some(role => role.includes('mesh'))) return 'a mesh';
  if (roles.some(role => role.includes('motion'))) return 'motion';
  return 'an output';
}

function computeVisibleBenchTrustState(witness = {}) {
  if (witness.falseClosureChecks?.schedulerUnverified
    || witness.falseClosureChecks?.visualSourceNotLive
    || witness.falseClosureChecks?.missingRouteTelemetry
    || witness.outputHandoff?.status !== 'real-output-produced') {
    return 'needs-review';
  }
  const warnings = unique([
    ...asArray(witness.sourceTruthWarnings),
    ...asArray(witness.witnessWarnings),
  ]);
  if (warnings.length > 0 || ['hot', 'deranged'].includes(witness.frameTailDamage?.bucket)) {
    return 'usable-with-warnings';
  }
  return 'usable';
}

function computeVisibleBenchPrimaryText(witness = {}) {
  const routeLabel = routeFamilyLabel(witness);
  const noun = outputNoun(witness);
  const producedOutput = witness.outputHandoff?.status === 'real-output-produced';
  const schedulerUnverified = witness.falseClosureChecks?.schedulerUnverified === true
    || witness.scheduler?.verificationState === 'scheduler-unverified';
  const visualSourceNotLive = witness.falseClosureChecks?.visualSourceNotLive === true;
  const activeLive = witness.routePhase?.active?.allowsFullBurn === true
    && witness.visualSourceTruth?.source === 'live-webgpu-volume';
  if (!producedOutput) {
    return `${routeLabel} ran, but Kaminos did not record a usable output.`;
  }
  if (schedulerUnverified) {
    return `${routeLabel} made ${noun} from this image, but Kaminos could not prove the route scheduler stayed cooperative.`;
  }
  if (visualSourceNotLive) {
    return `${routeLabel} made ${noun} from this image, but Kaminos could not prove the furnace view was live.`;
  }
  if (activeLive) {
    return `${routeLabel} made ${noun} from this image while the furnace stayed live.`;
  }
  return `${routeLabel} made ${noun} from this image and recorded the route evidence.`;
}

export function buildComputeRouteVisibleBenchModel({ witness } = {}) {
  if (!witness || witness.schema !== COMPUTE_ROUTE_CONTENTION_WITNESS_SCHEMA) {
    throw new Error(`witness with schema ${COMPUTE_ROUTE_CONTENTION_WITNESS_SCHEMA} is required`);
  }
  const routeId = witness.routeIdentity?.pipelineId
    || witness.routeIdentity?.effectiveRoute
    || witness.routeIdentity?.requestedRoute
    || 'compute-route';
  const schedulerEvidence = witness.pipelineScheduler || witness.scheduler || {};
  const warnings = unique([
    ...asArray(witness.sourceTruthWarnings),
    ...asArray(witness.witnessWarnings),
  ]);
  return {
    schema: COMPUTE_ROUTE_VISIBLE_BENCH_SCHEMA,
    witnessSchema: witness.schema,
    witnessId: witness.witnessId || null,
    routeId,
    primaryText: computeVisibleBenchPrimaryText(witness),
    trustState: computeVisibleBenchTrustState(witness),
    evidence: {
      route: {
        pipelineId: witness.routeIdentity?.pipelineId || null,
        requestedRoute: witness.routeIdentity?.requestedRoute || null,
        effectiveRoute: witness.routeIdentity?.effectiveRoute || null,
        backendClass: witness.routeIdentity?.backendClass || null,
        activePhase: witness.routePhase?.active?.routePhase || null,
        finalPhase: witness.routePhase?.final?.routePhase || null,
        statusBadge: witness.routePhase?.final?.statusBadge || witness.routePhase?.active?.statusBadge || null,
      },
      scheduler: {
        schema: schedulerEvidence.schema || witness.scheduler?.schema || null,
        verificationState: schedulerEvidence.verificationState || witness.scheduler?.verificationState || null,
        requestedMode: schedulerEvidence.requestedScheduler?.mode || witness.scheduler?.requestedScheduler?.mode || null,
        effectiveMode: schedulerEvidence.effectiveScheduler?.mode || witness.scheduler?.effectiveScheduler?.mode || null,
        nestedSchedulerSchema: schedulerEvidence.scheduler?.schema || witness.scheduler?.schema || null,
        rawAdapterSchema: schedulerEvidence.raw?.breathingRoom?.schema || witness.scheduler?.adapterEvidence?.schema || null,
      },
      backpressure: {
        schema: witness.backpressure?.schema || null,
        requestedBudget: witness.backpressure?.requestedBudget || null,
        effectiveBudget: witness.backpressure?.effectiveBudget || null,
        memoryExclusivity: witness.backpressure?.memoryExclusivity || null,
        warmCacheState: witness.backpressure?.warmCacheState || null,
        frameTail: cloneObject(witness.backpressure?.frameTail) || {},
      },
      visualSource: cloneObject(witness.visualSourceTruth) || {},
      visualBudget: {
        requested: witness.visualBudget?.requested?.budgetId || witness.visualBudget?.requested?.rayBudgetPreset || null,
        effective: witness.visualBudget?.effective?.rayBudgetPreset || witness.visualBudget?.effective?.budgetId || null,
        runtimeQualityRequested: witness.visualBudget?.effective?.runtimeQuality?.requested || null,
        runtimeQualityEffective: witness.visualBudget?.effective?.runtimeQuality?.effective || null,
      },
      output: {
        status: witness.outputHandoff?.status || null,
        realArtifactCount: witness.outputHandoff?.realArtifactCount || 0,
        artifactCount: witness.outputHandoff?.artifactCount || 0,
        artifacts: asArray(witness.outputHandoff?.artifacts).map(artifact => ({
          id: artifact.id || null,
          role: artifact.role || null,
          status: artifact.status || null,
          path: artifact.path || null,
          bytes: finiteOrNull(artifact.bytes),
        })),
      },
      frameTail: {
        bucket: witness.frameTailDamage?.bucket || null,
        reasons: asArray(witness.frameTailDamage?.reasons),
        timingEvidenceSource: witness.timing?.evidenceSource || null,
        timingDisclaimer: witness.timing?.disclaimer || null,
        frameP95Ms: finiteOrNull(witness.timing?.frameP95Ms),
        frameP99Ms: finiteOrNull(witness.timing?.frameP99Ms),
        queueDoneP95Ms: finiteOrNull(witness.timing?.queueDoneP95Ms),
        queueDoneP99Ms: finiteOrNull(witness.timing?.queueDoneP99Ms),
      },
      falseClosure: cloneObject(witness.falseClosureChecks) || {},
      warnings,
      reportRefs: cloneObject(witness.reportRefs) || {},
    },
  };
}

export function computeRouteVisibleBenchWitnessFromSearch(search = '') {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.get('kaminos_compute_route_visible_bench') !== '1') return null;
  const witness = decodeBase64Url(params.get('compute_route_contention_witness'));
  if (!witness || witness.schema !== COMPUTE_ROUTE_CONTENTION_WITNESS_SCHEMA) return null;
  return witness;
}

function normalizeComputeRouteVisibleBenchModel(model) {
  if (!model || model.schema !== COMPUTE_ROUTE_VISIBLE_BENCH_SCHEMA) return null;
  return {
    schema: COMPUTE_ROUTE_VISIBLE_BENCH_SCHEMA,
    witnessSchema: model.witnessSchema || COMPUTE_ROUTE_CONTENTION_WITNESS_SCHEMA,
    witnessId: model.witnessId || null,
    routeId: model.routeId || 'compute-route',
    primaryText: model.primaryText || 'The route recorded evidence for this image.',
    trustState: model.trustState || 'needs-review',
    evidence: cloneObject(model.evidence) || {},
  };
}

export function computeRouteVisibleBenchModelFromSearch(search = '') {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.get('kaminos_compute_route_visible_bench') !== '1') return null;
  const model = normalizeComputeRouteVisibleBenchModel(
    decodeBase64Url(params.get('compute_route_visible_bench_model')),
  );
  if (model) return model;
  const witness = computeRouteVisibleBenchWitnessFromSearch(search);
  return witness ? buildComputeRouteVisibleBenchModel({ witness }) : null;
}

export function computeRouteVisibleBenchUrl(witness, {
  baseUrl = 'http://127.0.0.1:18121/',
  volumeWitnessUrl = null,
  payload = 'model',
} = {}) {
  if (!witness || witness.schema !== COMPUTE_ROUTE_CONTENTION_WITNESS_SCHEMA) {
    throw new Error(`witness with schema ${COMPUTE_ROUTE_CONTENTION_WITNESS_SCHEMA} is required`);
  }
  const url = new URL(volumeWitnessUrl || baseUrl);
  url.searchParams.set('kaminos_volume_smoke', '1');
  url.searchParams.set('kaminos_compute_route_visible_bench', '1');
  if (payload === 'witness') {
    url.searchParams.set('compute_route_contention_witness', encodeBase64Url(witness));
    url.searchParams.delete('compute_route_visible_bench_model');
  } else {
    url.searchParams.set('compute_route_visible_bench_model', encodeBase64Url(buildComputeRouteVisibleBenchModel({ witness })));
    url.searchParams.delete('compute_route_contention_witness');
  }
  return url.toString();
}
