const POPULATION_ROW_COUNT = 1_899_742;
const DEPOSITION_IDENTITY = 'flow-tangent-five-tap-bilinear-v0';
const TRANSPORT_IDENTITY = 'per-splat-self-extinction-additive-rgb-v0';
const ROUTE_IDENTITY = 'native-3d-compute-fluid-raymarch-v0';

export const FULL_SUPPORT_STAGE_A = Object.freeze({
  schema: 'kaminos.pyro.full-support-stage-a.v0',
  state: Object.freeze({
    identity: 'coefficient-state-120-f120-s120',
    grid: 160,
    simStepCount: 120,
    nativeCellIndexSha256: '995f195f0079108fd9de2b51c3e011fb758af4c0e3a594c2d24b9dcc5306e9f9',
  }),
  population: Object.freeze({
    identity: 'full-flame-ridge-nonridge-live-union-v0',
    rowCount: POPULATION_ROW_COUNT,
    sampleCap: null,
    droppedRowCount: 0,
  }),
  deposition: Object.freeze({
    identity: DEPOSITION_IDENTITY,
    tapOffsets: Object.freeze([-1, -0.5, 0, 0.5, 1]),
    tapWeights: Object.freeze([0.075, 0.225, 0.4, 0.225, 0.075]),
    neighborsPerTap: 4,
  }),
  transport: Object.freeze({
    identity: TRANSPORT_IDENTITY,
    blend: 'src-alpha-dst-one-add-v0',
    attenuatesBehindColor: false,
    judgmentBoundary: 'diagnostic-authoring-not-final-extinction-sensitive-basin-authority',
  }),
  sources: Object.freeze({
    'analytical-exact': Object.freeze({
      identity: 'exact-local-layer-emission-extinction-v0',
      overlayIdentity: 'sha256:b257375e4f4b95fde9fec29684c7f2aef3ff8d3ac7124c8fb7dea3e721042687',
      sourceOverlayIdentity: 'exact-local-layer-emission-extinction:coefficient-state-120',
    }),
    'learned-baseline': Object.freeze({
      identity: 'tiger-learned-baseline-full-support-v0',
      overlayIdentity: 'sha256:873aab6a7eefef3316a3ec021e2d4a853f0ce60223c83bd725f38571f9c10edf',
      sourceOverlayIdentity: 'sha256:61f81fb4a2f5b88e5d8d0815d34e6a7d895721735189c9649594a0bec1eac929',
    }),
    'learned-flow': Object.freeze({
      identity: 'tiger-learned-flow-full-support-v0',
      overlayIdentity: 'sha256:d53d37df495513a5483aa5b729c7b359360236e72a12368e0b84529c11e8d578',
      sourceOverlayIdentity: 'sha256:79510edc19bad339ff25accb602b5d039f76966e5accc0c58fb6cd7bd250a682',
    }),
  }),
  stageB: Object.freeze({
    identity: 'matched-optical-recurrence-v0',
    status: 'producer-evidence-unverified',
    producerContractCommit: '2a229b80',
  }),
});

function addFailure(failures, condition, identity) {
  if (condition) failures.push(identity);
}

export function admitFullSupportStageA(input = {}) {
  const failures = [];
  const source = FULL_SUPPORT_STAGE_A.sources[input.requestedSource];
  addFailure(failures, !source, 'unknown-source');
  addFailure(failures, input.effectiveSource !== input.requestedSource, 'source-substitution');
  addFailure(failures, input.requestedDeposition !== DEPOSITION_IDENTITY, 'unsupported-deposition-request');
  addFailure(failures, input.effectiveDeposition !== input.requestedDeposition, 'deposition-substitution');
  addFailure(failures, input.requestedTransport !== TRANSPORT_IDENTITY, 'unsupported-transport-request');
  addFailure(failures, input.effectiveTransport !== input.requestedTransport, 'transport-substitution');
  const sourceAudit = input.sourceAudit || {};
  addFailure(failures, sourceAudit.status !== 'matched', 'source-state-unverified');
  addFailure(
    failures,
    sourceAudit.routeIdentity !== ROUTE_IDENTITY || sourceAudit.effectiveRoute !== ROUTE_IDENTITY,
    'source-route-substitution',
  );
  addFailure(failures, sourceAudit.grid !== FULL_SUPPORT_STAGE_A.state.grid, 'source-grid-substitution');
  addFailure(failures, sourceAudit.simStepCount !== 120, 'source-sim-step-substitution');

  const population = input.population || {};
  addFailure(
    failures,
    population.candidateCount !== POPULATION_ROW_COUNT || population.instanceCount !== POPULATION_ROW_COUNT,
    'partial-population',
  );
  addFailure(failures, population.overflowCount !== 0, 'population-overflow');

  if (source?.overlayIdentity) {
    const overlay = input.overlay || {};
    addFailure(failures, overlay.status !== 'effective', 'overlay-not-effective');
    addFailure(failures, overlay.requestedOverlayIdentity !== source.overlayIdentity, 'overlay-request-substitution');
    addFailure(failures, overlay.effectiveOverlayIdentity !== source.overlayIdentity, 'overlay-effective-substitution');
    addFailure(failures, overlay.sourceOverlayIdentity !== source.sourceOverlayIdentity, 'overlay-source-substitution');
    addFailure(failures, overlay.admittedRowCount !== POPULATION_ROW_COUNT, 'overlay-partial-population');
    addFailure(failures, overlay.lookupMissCount !== 0, 'overlay-lookup-miss');
    addFailure(failures, overlay.lookupExtraCount !== 0, 'overlay-lookup-extra');
    addFailure(failures, overlay.droppedRowCount !== 0, 'overlay-dropped-row');
    addFailure(failures, overlay.sampleCap !== null, 'overlay-sample-cap');
    addFailure(failures, Boolean(overlay.fallbackReason), 'overlay-fallback');
  }

  return {
    schema: 'kaminos.pyro.full-support-stage-a-receipt.v0',
    status: failures.length === 0 ? 'effective' : 'failed',
    requestedSource: input.requestedSource ?? null,
    effectiveSource: failures.includes('source-substitution') ? null : input.effectiveSource ?? null,
    requestedDeposition: input.requestedDeposition ?? null,
    effectiveDeposition: failures.includes('deposition-substitution') ? null : input.effectiveDeposition ?? null,
    requestedTransport: input.requestedTransport ?? null,
    effectiveTransport: failures.includes('transport-substitution') ? null : input.effectiveTransport ?? null,
    rowCount: population.instanceCount ?? null,
    overflowCount: population.overflowCount ?? null,
    fallbackUsed: failures.some(failure => failure.includes('fallback')),
    sourceAudit: sourceAudit.status === 'matched' ? structuredClone(sourceAudit) : null,
    failures,
  };
}

export function buildFullSupportAuthoredFork({ name, outputPath, sourceReceipt, controls } = {}) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('authored fork name is required');
  if (typeof outputPath !== 'string' || !outputPath.trim()) throw new Error('caller-provided output path is required');
  if (sourceReceipt?.status !== 'effective') throw new Error('effective Stage A source receipt is required');
  if (!controls || typeof controls !== 'object' || Array.isArray(controls)) throw new Error('authored controls are required');
  return {
    schema: 'kaminos.pyro.full-support-authored-fork.v0',
    name: name.trim(),
    outputPath,
    originalEvidenceImmutable: true,
    sourceReceipt: structuredClone(sourceReceipt),
    controls: structuredClone(controls),
  };
}
