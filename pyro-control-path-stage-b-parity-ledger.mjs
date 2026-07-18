#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PYRO_STAGE_B_CONTROL_PARITY_LEDGER_SCHEMA = 'kaminos.pyro-control-path.stage-b-parity-ledger.v0';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONTROL_KEYS = Object.freeze([
  'volume_reaction_boundary_support_front',
  'volume_reaction_boundary_topology',
  'volume_reaction_boundary_fire_ridge',
  'volume_reaction_boundary_fire_tip',
  'volume_boundary_splat_radius',
  'volume_boundary_splat_sharpness',
]);
const SOURCE_FILES = Object.freeze({
  indexHtml: 'index.html',
  volumeCore: 'volume-core.js',
  stageBConsumer: 'volume-stage-b-cockpit-consumer.mjs',
  stageBManifestProducer: 'volume-stage-b-provisional-manifest.mjs',
  liveUnionOverlay: 'volume-layer-coefficient-live-union-overlay.mjs',
});
const REQUIRED_LOCKED_AXES = Object.freeze([
  'support', 'candidate-membership', 'candidate-count', 'positions', 'covariance', 'radius',
  'sharpness', 'coefficients', 'learned-attributes', 'authored-layers', 'simulator-state',
  'raymarch-target', 'camera-orbit',
]);
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireContract(condition, message) {
  if (!condition) throw new Error(`Stage B control parity ${message}`);
}

function lineForOffset(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function readGitBlob(repoRoot, revision, path) {
  return execFileSync('git', ['show', `${revision}:${path}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function resolveRevision(repoRoot, revision) {
  return execFileSync('git', ['rev-parse', `${revision}^{commit}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

function sourceRecord(path, text) {
  return {
    path,
    sha256: sha256(text),
    byteLength: Buffer.byteLength(text),
    text,
  };
}

function withoutText(record) {
  const { text, ...rest } = record;
  return rest;
}

function scopeEvidence({
  source,
  control,
  stage,
  start,
  end = null,
  required = [],
  excluded = [],
  positive = false,
}) {
  const startOffset = source.text.indexOf(start);
  requireContract(startOffset >= 0, `scope start missing:${control}:${stage}:${start}`);
  const endOffset = end == null ? startOffset + start.length : source.text.indexOf(end, startOffset + start.length);
  requireContract(endOffset >= 0, `scope end missing:${control}:${stage}:${end}`);
  const scopeEnd = end == null ? endOffset : endOffset + end.length;
  const scope = source.text.slice(startOffset, scopeEnd);
  for (const marker of required) {
    if (!scope.includes(marker)) {
      const prefix = positive ? 'positive coupling marker missing' : 'required marker missing';
      throw new Error(`${prefix}:${control}:${stage}:${marker}`);
    }
  }
  for (const marker of excluded) {
    requireContract(!scope.includes(marker), `excluded marker reached stage:${control}:${stage}:${marker}`);
  }
  return {
    identity: 'revision-bound-source-scope-evidence-v0',
    control,
    stage,
    path: source.path,
    line: lineForOffset(source.text, startOffset),
    startMarkerSha256: sha256(start),
    endMarkerSha256: end == null ? null : sha256(end),
    scopeSha256: sha256(scope),
    requiredMarkerSha256: required.map(marker => sha256(marker)),
    excludedMarkerSha256: excluded.map(marker => sha256(marker)),
  };
}

function validateInputs({ sourceRevision, manifest, witness, priorMatrix }) {
  requireContract(GIT_COMMIT.test(sourceRevision), `source revision invalid:${sourceRevision}`);
  requireContract(manifest?.schema === 'kaminos.pyro-cockpit-manifest.v0', 'manifest schema mismatch');
  requireContract(manifest.status === 'complete' && manifest.evidenceState === 'produced', 'manifest incomplete');
  requireContract(manifest.source?.commit === sourceRevision, 'manifest source revision substitution');
  requireContract(manifest.producer?.implementationCommit === sourceRevision, 'producer revision substitution');
  for (const key of [
    'controlsSha256', 'candidatePayloadSha256', 'supportSha256', 'coefficientSha256',
    'covarianceSha256', 'fluidSha256', 'frontSha256',
  ]) requireContract(SHA256.test(manifest.source?.[key] || ''), `manifest source hash invalid:${key}`);
  requireContract(manifest.capacity?.candidateCount === manifest.source?.candidateCount, 'candidate count substitution');
  requireContract(manifest.capacity?.capacity >= manifest.capacity?.candidateCount, 'candidate capacity insufficient');
  requireContract(manifest.capacity?.overflowCount === 0, 'candidate overflow');
  requireContract(manifest.renderer?.depthBins?.requested === 16, 'requested optical layer count substitution');
  requireContract(manifest.renderer?.depthBins?.effective === 16, 'effective optical layer count substitution');
  requireContract(manifest.renderer?.fallbackReason === null, 'manifest renderer fallback');
  requireContract(manifest.controls?.requestedSha256 === manifest.controls?.effectiveSha256, 'manifest controls substitution');
  for (const axis of REQUIRED_LOCKED_AXES) {
    requireContract(manifest.controls?.locked?.includes(axis), `locked axis missing:${axis}`);
  }
  requireContract(witness?.schema === 'kaminos.pyro.full-support-cockpit-witness.v0', 'witness schema mismatch');
  requireContract(witness.status === 'passed', 'witness failed');
  requireContract(witness.stageBReceipt?.status === 'effective', 'Stage B receipt ineffective');
  requireContract(witness.stageBReceipt?.requestedTreatment === witness.stageBReceipt?.effectiveTreatment, 'treatment substitution');
  requireContract(witness.stageBReceipt?.requestedManifestSha256 === witness.stageBReceipt?.effectiveManifestSha256, 'manifest load substitution');
  requireContract(witness.stageBReceipt?.fallbackUsed === false, 'Stage B fallback used');
  requireContract(
    witness.stageBReceipt?.resourceState === 'complete',
    `Stage B resource state incomplete:${witness.stageBReceipt?.resourceState ?? 'missing'}`,
  );
  const requestedPasses = witness.stageBReceipt?.passes?.requested;
  const appliedPasses = witness.stageBReceipt?.passes?.applied;
  requireContract(Array.isArray(requestedPasses), 'Stage B requested passes missing');
  requireContract(Array.isArray(appliedPasses), 'Stage B applied passes missing');
  for (const pass of ['manifest-validation', 'resource-binding', 'resource-load-verification']) {
    requireContract(requestedPasses.includes(pass), `Stage B required pass not requested:${pass}`);
    requireContract(appliedPasses.includes(pass), `Stage B requested pass not applied:${pass}`);
  }
  for (const pass of requestedPasses) {
    requireContract(appliedPasses.includes(pass), `Stage B requested pass not applied:${pass}`);
  }
  requireContract(witness.stageBReceipt?.rendererReceipt?.fallbackReason === null, 'Stage B renderer fallback');
  requireContract(witness.stageBReceipt?.passes?.rendererRequested === true, 'Stage B renderer not requested');
  requireContract(witness.stageBReceipt?.passes?.rendererEncoded === true, 'Stage B renderer not encoded');
  requireContract(witness.stageBReceipt?.passes?.rendererApplied === true, 'Stage B renderer not applied');
  requireContract(priorMatrix?.schema === 'kaminos.pyro-control-path.browser-gpu-frozen-capture-matrix.v0', 'prior matrix schema mismatch');
  requireContract(priorMatrix.enumerationCount >= CONTROL_KEYS.length, 'prior matrix enumeration incomplete');
  requireContract(Array.isArray(priorMatrix.rows), 'prior matrix rows missing');
}

function requestedEffectiveControl(witness, control) {
  const requested = new URL(witness.requestedRoute).searchParams.get(control);
  const effective = new URL(witness.effectiveRoute).searchParams.get(control);
  requireContract(requested !== null, `requested control missing:${control}`);
  requireContract(effective !== null, `effective control missing:${control}`);
  return {
    requested,
    effective,
    requestedNumber: Number(requested),
    effectiveNumber: Number(effective),
    effectiveEqualsRequested: effective === requested,
  };
}

function priorFrozenCapture(priorMatrix, control) {
  const row = priorMatrix.rows.find(candidate => candidate.control === control);
  requireContract(row, `prior frozen capture row missing:${control}`);
  return {
    routeIdentity: row.identity?.effectiveRoute ?? null,
    sourceStateIdentity: row.identity?.sourceStateIdentity ?? null,
    requested: row.requested,
    appliedPasses: row.appliedPasses,
    candidateCountDelta: row.deltas?.boundarySplatGpuProfile?.candidateCopyBytesMeanAbs ?? null,
    pixelDelta: row.deltas?.pixel ?? null,
    changedCompositions: row.changedCompositions ?? [],
    comparisonArtifact: row.comparisonArtifact,
    sourceFieldHashes: row.sourceFieldHashes,
    stageBPixelDelta: null,
    stageBPixelDeltaReason: 'Stage B source cohort is immutable and no post-load control perturbation was permitted',
  };
}

function ingressEvidence(sources, control) {
  const definitions = {
    volume_reaction_boundary_support_front: {
      route: "{ key: 'reactionBoundarySupportFront', id: 'volume-reaction-boundary-support-front', param: 'volume_reaction_boundary_support_front'",
    },
    volume_reaction_boundary_topology: {
      route: "{ key: 'reactionBoundaryTopology', id: 'volume-reaction-boundary-topology', param: 'volume_reaction_boundary_topology'",
    },
    volume_reaction_boundary_fire_ridge: {
      route: "{ key: 'reactionBoundaryFireRidge', id: 'volume-reaction-boundary-fire-ridge', param: 'volume_reaction_boundary_fire_ridge'",
    },
    volume_reaction_boundary_fire_tip: {
      route: "{ key: 'reactionBoundaryFireTip', id: 'volume-reaction-boundary-fire-tip', param: 'volume_reaction_boundary_fire_tip'",
    },
    volume_boundary_splat_radius: {
      route: "{ key: 'boundarySplatRadius', id: 'volume-boundary-splat-radius', param: 'volume_boundary_splat_radius'",
      normalize: 'normalizeBoundarySplatRadius(controlsSnapshot.boundarySplatRadius)',
    },
    volume_boundary_splat_sharpness: {
      route: "{ key: 'boundarySplatSharpness', id: 'volume-boundary-splat-sharpness', param: 'volume_boundary_splat_sharpness'",
      normalize: 'normalizeBoundarySplatSharpness(controlsSnapshot.boundarySplatSharpness)',
    },
  };
  const definition = definitions[control];
  const evidence = [scopeEvidence({
    source: sources.indexHtml,
    control,
    stage: 'route-ingress',
    start: definition.route,
    required: [definition.route],
    positive: true,
  })];
  if (definition.normalize) {
    evidence.push(scopeEvidence({
      source: sources.volumeCore,
      control,
      stage: 'gpu-upload',
      start: 'if (boundarySplatCameraBuffer) {',
      end: 'device.queue.writeBuffer(boundarySplatCameraBuffer, 0, splatCamera);',
      required: [definition.normalize, 'device.queue.writeBuffer(boundarySplatCameraBuffer, 0, splatCamera);'],
      positive: true,
    }));
  }
  return evidence;
}

function raymarchEvidence(sources, control) {
  const definitions = {
    volume_reaction_boundary_support_front: {
      upload: 'uniforms[282] = boundaryControlUniformsActive ? boundaryUniforms.supportFront',
      consumer: 'shellFrontGain * frontSupport',
    },
    volume_reaction_boundary_topology: {
      upload: 'uniforms[285] = boundaryControlUniformsActive ? boundaryUniforms.topologyGain',
      consumer: 'shellBiteGain * (edgeSupport * 0.50 + frontSupport * 0.24)',
    },
    volume_reaction_boundary_fire_ridge: {
      upload: 'uniforms[296] = boundaryFireUniforms.ridgeGain;',
      consumer: 'boundaryLaplacian * boundaryFireRidgeGain',
    },
    volume_reaction_boundary_fire_tip: {
      upload: 'uniforms[298] = boundaryFireUniforms.tipBreakup;',
      consumer: 'boundaryFireTipGate * boundaryFireTipBreakup',
    },
  };
  const definition = definitions[control];
  if (!definition) {
    return [scopeEvidence({
      source: sources.volumeCore,
      control,
      stage: 'raymarch',
      start: 'const WGSL = /* wgsl */`',
      end: 'const BOUNDARY_SPLAT_WGSL = `',
      excluded: [control === 'volume_boundary_splat_radius'
        ? 'boundarySplatCamera.controls.x'
        : 'boundarySplatCamera.controls.w'],
    })];
  }
  return [
    scopeEvidence({
      source: sources.volumeCore,
      control,
      stage: 'raymarch-upload',
      start: definition.upload,
      required: [definition.upload],
      positive: true,
    }),
    scopeEvidence({
      source: sources.volumeCore,
      control,
      stage: 'raymarch-consumer',
      start: 'const WGSL = /* wgsl */`',
      end: 'const BOUNDARY_SPLAT_WGSL = `',
      required: [definition.consumer],
      positive: true,
    }),
  ];
}

function candidateEvidence(sources, control) {
  const candidateScope = {
    source: sources.volumeCore,
    control,
    stage: 'candidate',
    start: 'fn compactBoundarySplats(@builtin(global_invocation_id) gid: vec3<u32>)',
    end: 'let candidateIndex = atomicAdd(&boundarySplatDraw.candidateCount, 1u);',
  };
  if (control === 'volume_reaction_boundary_support_front') {
    return [
      scopeEvidence({
        source: sources.volumeCore,
        control,
        stage: 'candidate',
        start: 'fn csBoundarySidecar(@builtin(global_invocation_id) gid: vec3<u32>)',
        end: 'fn csMajorant(@builtin(global_invocation_id) gid: vec3<u32>)',
        required: [
          'clamp(u.topology_shell_carriers.z, 0.0, 2.0)',
          'let center = boundarySupportAtCell(c, supportWeights);',
          'boundarySidecarDst[index3(gid)] = vec4<f32>(',
        ],
        positive: true,
      }),
      scopeEvidence({ ...candidateScope, required: ['let admissionSidecar = boundarySidecar[cellIndex];', 'let structuralSignal ='], positive: true }),
    ];
  }
  if (control === 'volume_reaction_boundary_fire_ridge') {
    return [
      scopeEvidence({
        source: sources.volumeCore,
        control,
        stage: 'candidate',
        start: 'fn csBoundarySidecar(@builtin(global_invocation_id) gid: vec3<u32>)',
        end: 'fn csMajorant(@builtin(global_invocation_id) gid: vec3<u32>)',
        required: [
          'let ridgeGain = clamp(u.boundary_fire_structure.x, 0.0, 2.0)',
          'let boundarySidecarRidge = smoothstep',
          'boundarySidecarDst[index3(gid)] = vec4<f32>(',
        ],
        positive: true,
      }),
      scopeEvidence({ ...candidateScope, required: ['let admissionSidecar = boundarySidecar[cellIndex];', 'let ridgeAdmitted = structuralSignal >= 0.11;'], positive: true }),
    ];
  }
  const excluded = {
    volume_reaction_boundary_topology: ['u.topology_shell_shape', 'topologyGain'],
    volume_reaction_boundary_fire_tip: ['boundaryFireTipBreakup', 'boundary_fire_structure.z'],
    volume_boundary_splat_radius: ['boundarySplatCamera.controls.x'],
    volume_boundary_splat_sharpness: ['boundarySplatCamera.controls.w'],
  }[control];
  return [scopeEvidence({ ...candidateScope, excluded })];
}

function targetStageEvidence(sources, control) {
  const controlMarker = control === 'volume_boundary_splat_radius'
    ? 'boundarySplatCamera.controls.x'
    : (control === 'volume_boundary_splat_sharpness' ? 'boundarySplatCamera.controls.w' : null);
  const exclusions = controlMarker ? [controlMarker] : [];
  return {
    coefficients: scopeEvidence({
      source: sources.volumeCore,
      control,
      stage: 'coefficients',
      start: 'fn boundarySplatBilinearVs(',
      end: 'var out: BoundarySplatVertexOut;',
      required: ['boundarySplatLiveUnionCoefficients[coefficientOffset]', 'boundarySplatLiveUnionCoefficients[coefficientOffset + 1u]'],
      excluded: exclusions,
    }),
    covariance: scopeEvidence({
      source: sources.volumeCore,
      control,
      stage: 'covariance',
      start: 'fn writeFlowKernelDescriptor(',
      end: 'fn boundarySplatAttributeFeatures(',
      required: ['covarianceA = variance', 'covarianceB = vec4<f32>'],
      excluded: exclusions,
    }),
    deposition: scopeEvidence({
      source: sources.volumeCore,
      control,
      stage: 'deposition',
      start: 'fn boundarySplatBilinearVs(',
      end: 'fn boundarySplatFs(',
      required: [
        'let candidateIndex = depositionInstanceIndex / 20u;',
        'descriptor.tangentCoherence.xyz',
        'descriptor.sidecar.w',
        'boundarySplatBilinearTapWeight(tapIndex) * bilinearWeight',
      ],
      excluded: [...exclusions, 'descriptor.covarianceA', 'descriptor.covarianceB'],
    }),
    presentation: scopeEvidence({
      source: sources.volumeCore,
      control,
      stage: 'presentation',
      start: 'fn boundarySplatBilinearOpticalFs(',
      end: 'export function createKaminosVolumePrototype',
      required: [
        'sharedEmissionCoefficient * depositionWeight',
        'sharedTotalExtinctionCoefficient * depositionWeight',
        'let binAlpha = 1.0 - exp(-opticalDepth);',
        'color = binColor * binAlpha + color * (1.0 - binAlpha);',
      ],
      excluded: exclusions,
    }),
  };
}

function stagesFor(control, manifest) {
  const supportOrRidge = control === 'volume_reaction_boundary_support_front'
    || control === 'volume_reaction_boundary_fire_ridge';
  const raymarchOnly = control === 'volume_reaction_boundary_topology'
    || control === 'volume_reaction_boundary_fire_tip';
  const bypassedSplatControl = control === 'volume_boundary_splat_radius'
    || control === 'volume_boundary_splat_sharpness';
  const resource = {
    candidate: `sha256:${manifest.source.candidatePayloadSha256}`,
    support: `sha256:${manifest.source.supportSha256}`,
    coefficients: `sha256:${manifest.source.coefficientSha256}`,
    covariance: `sha256:${manifest.source.covarianceSha256}`,
  };
  return {
    raymarch: {
      coupling: bypassedSplatControl ? 'none' : 'direct-live',
      classification: bypassedSplatControl ? 'intentional-splat-only' : 'proved-raymarch-coupling',
      ordinaryRouteReadsControl: !bypassedSplatControl,
      livePostLoad: false,
    },
    candidate: {
      coupling: supportOrRidge ? 'producer-time-frozen' : 'none',
      classification: supportOrRidge
        ? 'source-sidecar-to-admission-coupling'
        : (raymarchOnly ? 'intentional-raymarch-only-current-route' : 'post-admission-splat-control'),
      livePostLoad: false,
      resourceIdentity: supportOrRidge ? resource.support : resource.candidate,
    },
    coefficients: {
      coupling: supportOrRidge
        ? 'cohort-only-frozen'
        : (bypassedSplatControl ? 'declared-locked-but-bypassed' : 'none'),
      classification: supportOrRidge
        ? 'admission-row-cohort-selects-external-coefficients'
        : (bypassedSplatControl ? 'external-coefficient-route-bypasses-control' : 'raymarch-only-no-coefficient-route'),
      livePostLoad: false,
      resourceIdentity: resource.coefficients,
    },
    covariance: {
      coupling: bypassedSplatControl ? 'declared-locked-but-bypassed' : (supportOrRidge ? 'cohort-only-frozen' : 'none'),
      classification: supportOrRidge
        ? 'admission-row-cohort-only-no-direct-covariance-term'
        : (bypassedSplatControl ? 'descriptor-covariance-does-not-read-control' : 'no-direct-covariance-term'),
      livePostLoad: false,
      resourceIdentity: resource.covariance,
    },
    deposition: {
      coupling: supportOrRidge ? 'cohort-only-frozen' : (bypassedSplatControl ? 'declared-locked-but-bypassed' : 'none'),
      classification: supportOrRidge
        ? 'candidate-cohort-controls-deposit-population'
        : (bypassedSplatControl ? 'five-tap-bilinear-route-bypasses-control' : 'raymarch-only-no-deposition-route'),
      livePostLoad: false,
      depositionIdentity: 'flow-tangent-five-tap-bilinear-v0',
    },
    presentation: {
      coupling: supportOrRidge ? 'cohort-only-frozen' : (bypassedSplatControl ? 'declared-locked-but-bypassed' : 'none'),
      classification: supportOrRidge
        ? 'candidate-and-coefficient-cohort-reaches-optical-presentation'
        : (bypassedSplatControl ? 'Stage-B-optical-presentation-bypasses-control' : 'intentional-raymarch-only-current-route'),
      livePostLoad: false,
      presentationIdentity: manifest.identities.presentation,
    },
  };
}

function buildFalsifier(control, stages) {
  if (!['volume_boundary_splat_radius', 'volume_boundary_splat_sharpness'].includes(control)) return null;
  return {
    identity: 'Stage-B-requested-effective-downstream-bypass-falsifier-v0',
    tripped: Object.values(stages).slice(2).every(stage => stage.livePostLoad === false)
      && stages.deposition.coupling === 'declared-locked-but-bypassed',
    catches: 'requested-effective-and-gpu-upload-survive-while-stage-b-consumer-bypasses-control',
    receiptSurvives: true,
    normalizationSurvives: true,
    gpuUniformUploadSurvives: true,
    downstreamStageBUse: false,
  };
}

export async function buildStageBControlParityLedger({
  repoRoot = ROOT,
  sourceRevision,
  manifest,
  witness,
  priorMatrix,
  sourceOverrides = {},
  manifestBytes = null,
  witnessBytes = null,
} = {}) {
  const resolvedRepoRoot = resolve(repoRoot);
  const revision = resolveRevision(resolvedRepoRoot, sourceRevision);
  requireContract(revision === sourceRevision, `source revision is not exact:${sourceRevision}:${revision}`);
  validateInputs({ sourceRevision: revision, manifest, witness, priorMatrix });
  const sources = Object.fromEntries(Object.entries(SOURCE_FILES).map(([key, path]) => {
    const text = Object.hasOwn(sourceOverrides, path)
      ? sourceOverrides[path]
      : readGitBlob(resolvedRepoRoot, revision, path);
    return [key, sourceRecord(path, text)];
  }));

  const rows = CONTROL_KEYS.map(control => {
    const requested = requestedEffectiveControl(witness, control);
    requireContract(requested.effectiveEqualsRequested, `requested/effective control substitution:${control}`);
    const stages = stagesFor(control, manifest);
    const targetEvidence = targetStageEvidence(sources, control);
    const evidence = [
      ...ingressEvidence(sources, control),
      ...raymarchEvidence(sources, control),
      ...candidateEvidence(sources, control),
      ...Object.values(targetEvidence),
    ];
    return {
      control,
      requested,
      sourceFieldHash: sha256(evidence.map(item => item.scopeSha256).join(':')),
      stages,
      evidence,
      priorFrozenCapture: priorFrozenCapture(priorMatrix, control),
      fallback: null,
      postLoadMutation: null,
      falsifier: buildFalsifier(control, stages),
    };
  });

  const appliedPasses = witness.stageBReceipt.passes.applied;
  const contractEvidence = [
    scopeEvidence({
      source: sources.stageBConsumer,
      control: 'stage-b-contract',
      stage: 'locked-axes',
      start: 'const REQUIRED_LOCKED_AXES = Object.freeze([',
      end: 'const REQUIRED_VIEW_SOCKETS = Object.freeze([',
      required: REQUIRED_LOCKED_AXES.map(axis => `'${axis}'`),
      positive: true,
    }),
    scopeEvidence({
      source: sources.stageBManifestProducer,
      control: 'stage-b-contract',
      stage: 'resource-identities',
      start: 'const controlsSha256 = sha(Buffer.from(routeReceipt.requestedRoute));',
      end: 'const commit = execFileSync',
      required: [
        'const supportSha256 = sourceManifest.boundarySidecar.sidecars.boundary.sha256;',
        'const coefficientSha256 = exactOverlay.artifacts.coefficients.sha256;',
        "'coefficient-state-120-kernel-descriptors.f32'",
        'const candidatePayloadSha256 = exactOverlay.artifacts.nativeCellIndices.sha256;',
      ],
      positive: true,
    }),
  ];
  return {
    schema: PYRO_STAGE_B_CONTROL_PARITY_LEDGER_SCHEMA,
    scope: 'stage-b-six-control-executable-slice',
    generatedAt: new Date().toISOString(),
    source: {
      revision,
      files: Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, withoutText(value)])),
      manifestSha256: manifestBytes ? sha256(manifestBytes) : witness.stageBReceipt.effectiveManifestSha256,
      witnessSha256: witnessBytes ? sha256(witnessBytes) : sha256(JSON.stringify(witness)),
    },
    runtime: {
      sameStateCaptureId: manifest.source.sameStateCaptureId,
      simStepCount: witness.bootstrap?.presentedState?.simStepCount ?? null,
      lookFreeze: witness.bootstrap?.presentedState?.lookFreeze ?? null,
      backend: manifest.renderer.backend,
      requestedRoute: manifest.routes.requested,
      effectiveWrapperRoute: manifest.routes.effectiveWrapper,
      effectiveRendererRoute: manifest.routes.effectiveRenderer,
      requestedTreatment: witness.stageBReceipt.requestedTreatment,
      effectiveTreatment: witness.stageBReceipt.effectiveTreatment,
      requestedEffectiveIdentity: witness.stageBReceipt.requestedTreatment === witness.stageBReceipt.effectiveTreatment
        && witness.stageBReceipt.requestedManifestSha256 === witness.stageBReceipt.effectiveManifestSha256,
      controlsRequestedSha256: manifest.controls.requestedSha256,
      controlsEffectiveSha256: manifest.controls.effectiveSha256,
      candidatePayloadSha256: manifest.source.candidatePayloadSha256,
      supportSha256: manifest.source.supportSha256,
      coefficientSha256: manifest.source.coefficientSha256,
      covarianceSha256: manifest.source.covarianceSha256,
      candidateCount: manifest.capacity.candidateCount,
      capacity: manifest.capacity.capacity,
      overflowCount: manifest.capacity.overflowCount,
      layerCount: manifest.renderer.depthBins.effective,
      depositCount: manifest.capacity.candidateCount * 20,
      appliedPasses,
      rendererRequested: witness.stageBReceipt.passes.rendererRequested,
      rendererEncoded: witness.stageBReceipt.passes.rendererEncoded,
      rendererApplied: witness.stageBReceipt.passes.rendererApplied,
      fallback: manifest.renderer.fallbackReason ?? witness.stageBReceipt.rendererReceipt?.fallbackReason ?? null,
      postLoadMutation: 'locked-control-cohort-no-post-load-mutation-v0',
      lockedAxes: [...manifest.controls.locked],
      mutableAxes: [...manifest.controls.mutable],
    },
    enumeration: {
      totalControlCount: priorMatrix.enumerationCount,
      auditedControlCount: rows.length,
      nextUncappedEnumerationCount: priorMatrix.enumerationCount - rows.length,
      uncapped: true,
    },
    contractEvidence,
    rows,
    materialFindings: [
      {
        id: 'stage-b-radius-sharpness-bypass',
        severity: 'material-hidden-coupling-loss',
        claim: 'radius and sharpness survive request/effective receipts and GPU upload but are not consumed by the five-tap bilinear Stage B coefficient, deposition, optical, or presentation path',
        consequence: 'ordinary splat pixel deltas do not establish radius/sharpness control over the provisional Stage B treatment',
      },
      {
        id: 'stage-b-covariance-lock-does-not-prove-covariance-consumption',
        severity: 'material-evidence-scope-warning',
        claim: 'the manifest locks covariance, but five-tap deposition reads tangentCoherence and sidecar fields rather than covarianceA or covarianceB',
        consequence: 'covariance identity is cohort provenance, not proof that Stage B deposition consumes covariance terms',
      },
    ],
    provisionalDiagnosticGate: {
      exhaustiveParityRequired: false,
      currentDiagnosticMayProceed: true,
      authority: 'producer-evidence-unverified/operator-exploration-only',
      integrationConstraint: 'do not interpret ordinary splat radius/sharpness witnesses as Stage B treatment coupling',
    },
  };
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key.startsWith('--') && value && !value.startsWith('--')) {
      args.set(key, value);
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const repoRoot = resolve(args.get('--repo-root') || ROOT);
  const sourceRevision = args.get('--source-revision');
  const manifestPath = resolve(args.get('--stage-b-manifest') || '');
  const witnessPath = resolve(args.get('--stage-b-witness') || '');
  const priorMatrixPath = resolve(args.get('--prior-matrix')
    || 'artifacts/pyro-control-path-parity-audit/browser-gpu-frozen-capture-matrix/matrix.json');
  const outPath = resolve(args.get('--out')
    || 'artifacts/pyro-control-path-parity-audit/stage-b-control-parity-ledger.json');
  requireContract(sourceRevision, 'missing --source-revision');
  requireContract(args.get('--stage-b-manifest'), 'missing --stage-b-manifest');
  requireContract(args.get('--stage-b-witness'), 'missing --stage-b-witness');
  const [manifestBytes, witnessBytes, priorMatrixBytes] = await Promise.all([
    readFile(manifestPath),
    readFile(witnessPath),
    readFile(priorMatrixPath),
  ]);
  const ledger = await buildStageBControlParityLedger({
    repoRoot,
    sourceRevision,
    manifest: JSON.parse(manifestBytes),
    witness: JSON.parse(witnessBytes),
    priorMatrix: JSON.parse(priorMatrixBytes),
    manifestBytes,
    witnessBytes,
  });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    schema: ledger.schema,
    outPath,
    sourceRevision: ledger.source.revision,
    controlCount: ledger.rows.length,
    totalControlCount: ledger.enumeration.totalControlCount,
    nextUncappedEnumerationCount: ledger.enumeration.nextUncappedEnumerationCount,
    materialFindingCount: ledger.materialFindings.length,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
