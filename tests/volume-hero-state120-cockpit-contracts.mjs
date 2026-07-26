import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as cockpit from '../volume-sparse-product-cockpit.mjs';

const root = new URL('..', import.meta.url).pathname;
const outerViewer = readFileSync(join(root, 'volume-selective-head-live.html'), 'utf8');
const witness = readFileSync(join(root, 'volume-hero-state120-cockpit-witness.mjs'), 'utf8');
const session = readFileSync(join(root, 'volume-hero-state120-cockpit-session.mjs'), 'utf8');

assert.equal(
  typeof cockpit.parseHeroState120Route,
  'function',
  'the cockpit must expose an explicit authenticated state-120 Hero route',
);
assert.equal(
  typeof cockpit.makeHeroState120RuntimeReceipt,
  'function',
  'the cockpit must expose a fail-loud authenticated Hero runtime receipt',
);
assert.equal(
  typeof cockpit.verifyHeroState120TargetSource,
  'function',
  'the cockpit must verify the bytes actually served to the Hero target presentation',
);

const exactParams = new URLSearchParams({
  volume_hero_pair: 'state120',
  volume_resolution: '160',
  volume_boundary_splat_mode: 'learned',
  volume_boundary_splat_radius: '0.98',
  volume_boundary_splat_sharpness: '12',
  volume_optical_unit_mode: 'projected-native-cell-area-integral-normalized-v0',
  volume_boundary_splat_presentation_mode: 'matched-optical-recurrence-v0',
  composition: 'splat-only-v0',
  volume_raymarch_smoke: 'off',
  warmup_steps: '0',
  full_support_persistent_cohort_manifest: '/scratch/hero/cohort-manifest.json',
  full_support_persistent_cohort_manifest_sha256:
    '4a93aeefe7eebec06f039dd35bd2947e4e76f292eadd7b7719e02235d062ac20',
  full_support_persistent_cohort_state: 'coefficient-state-120',
  full_support_hero_target: '/scratch/hero/coefficient-state-120-target.png',
  full_support_hero_target_sha256:
    'c8dc4dc0ab4b324a872989adf112cb5a87cf9e3083115fa5489615b2397e2dc7',
});

const request = cockpit.parseHeroState120Route(exactParams);
assert.equal(request.stateId, 'coefficient-state-120');
assert.equal(request.fixedState, true);
assert.equal(request.candidateCount, 481447);
assert.equal(request.depositionIdentity, 'flow-kernel-moment-gaussian-raster-v0');
assert.equal(request.depositsPerCandidate, 1);
assert.equal(request.attributeModelIdentity, 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472');

const expectedTargetHashBytes = Uint8Array.from(
  request.raymarchTargetSha256.match(/../g).map(byte => Number.parseInt(byte, 16)),
);
const targetFetchCalls = [];
const verifiedTarget = await cockpit.verifyHeroState120TargetSource(request, {
  fetchImpl: async (url, options) => {
    targetFetchCalls.push({ url, options });
    return {
      ok: true,
      status: 200,
      url: 'http://127.0.0.1:18831/scratch/hero/coefficient-state-120-target.png',
      arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
    };
  },
  digestImpl: async () => expectedTargetHashBytes,
});
assert.equal(targetFetchCalls.length, 1);
assert.equal(targetFetchCalls[0].options.cache, 'no-store');
assert.equal(verifiedTarget.receipt.requestedTargetSha256, request.raymarchTargetSha256);
assert.equal(verifiedTarget.receipt.actualServedTargetSha256, request.raymarchTargetSha256);
assert.equal(verifiedTarget.receipt.presentationSourceAuthority, 'verified-fetched-bytes-object-url-v0');
assert.deepEqual(Array.from(verifiedTarget.bytes), [137, 80, 78, 71]);

await assert.rejects(
  cockpit.verifyHeroState120TargetSource(request, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: 'http://127.0.0.1:18831/substituted.png',
      arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
    }),
    digestImpl: async () => new Uint8Array(32),
  }),
  /hero-target-bytes-substitution/,
);

for (const [field, replacement, expected] of [
  ['full_support_persistent_cohort_state', 'coefficient-state-118', /hero-state-substitution/],
  ['full_support_persistent_cohort_manifest_sha256', '0'.repeat(64), /hero-cohort-substitution/],
  ['full_support_hero_target_sha256', '1'.repeat(64), /hero-target-substitution/],
  ['volume_boundary_splat_mode', 'kernel_moment_covariance', /hero-material-substitution/],
  ['volume_boundary_splat_radius', '1', /hero-material-substitution/],
  ['volume_boundary_splat_sharpness', '3.4', /hero-material-substitution/],
  ['volume_optical_unit_mode', 'legacy-global-path-scale-diagnostic-v0', /hero-optical-substitution/],
  ['composition', 'smoke-raymarch-under-splats-v0', /hero-composition-substitution/],
  ['warmup_steps', '96', /hero-live-bootstrap-substitution/],
]) {
  const changed = new URLSearchParams(exactParams);
  changed.set(field, replacement);
  assert.throws(() => cockpit.parseHeroState120Route(changed), expected);
}

const runtimeState = {
  active: true,
  backend: 'WebGPU:apple',
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  simGrid: 160,
  simStepCount: 5,
  frameCount: 8,
  cameraSignature: 'exact-camera',
  boundarySplatMode: 'learned',
  boundarySplatRendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
  boundarySplatAttributeModelIdentity:
    'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472',
  boundarySplatSourceAuthority: 'authenticated-persistent-sparse-cohort-gpu-source-v0',
  boundarySplatFootprintAuthority: 'learned-camera-facing-billboard-v0',
  boundarySplatRadius: 0.98,
  boundarySplatSharpness: 12,
  boundarySplatCandidateCount: 481447,
  boundarySplatFallbackReason: null,
  fullSupportDepositionRequested: 'flow-kernel-moment-gaussian-raster-v0',
  fullSupportDepositionEffective: 'flow-kernel-moment-gaussian-raster-v0',
  fullSupportDepositionFallbackReason: null,
  fullSupportDepositionReceipt: {
    identity: 'full-support-deposition-runtime-receipt-v0',
    requested: 'flow-kernel-moment-gaussian-raster-v0',
    effective: 'flow-kernel-moment-gaussian-raster-v0',
    fallbackReason: null,
    sourceCandidateCount: 481447,
    rasterDepositCount: 481447,
  },
  fullSupportGaussianGeometryIdentity: 'persistent-cohort-historical-round-base-radius-v0',
  fullSupportSourceCandidateCount: null,
  fullSupportRasterDepositCount: null,
  effectiveBoundarySplatOpticalUnitMode: 'projected-native-cell-area-integral-normalized-v0',
  boundarySplatOpticalUnitModeFallbackReason: null,
  boundarySplatPresentationModeEffective: 'matched-optical-recurrence-v0',
  boundarySplatPresentationReceipt: {
    effectiveMode: 'matched-optical-recurrence-v0',
    depthBins: 16,
    accumulationIdentity: 'depth-binned-emission-optical-depth-v0',
    transportIdentity: 'depth-binned-exponential-self-transmittance-v0',
    fallbackReason: null,
  },
  selectiveHeadLiveCompositionEffective: 'splat-only-v0',
  selectiveHeadLivePassReceipt: {
    composition: 'splat-only-v0',
    splatEncoded: true,
    splatApplied: true,
    raymarchApplied: false,
    fallbackReason: null,
  },
  persistentSparseCohortGpuReceipt: {
    status: 'complete',
    stateId: 'coefficient-state-120',
    manifestSha256:
      '4a93aeefe7eebec06f039dd35bd2947e4e76f292eadd7b7719e02235d062ac20',
    fallbackUsed: false,
    rendererApplied: true,
  },
  lookFreeze: 1,
  selectiveHeadLiveCapturePaused: false,
};

const exactReceipt = cockpit.makeHeroState120RuntimeReceipt(request, runtimeState, {
  exactCameraSignature: 'exact-camera',
  targetSourceReceipt: verifiedTarget.receipt,
});
assert.equal(exactReceipt.status, 'exact-fixed-pair');
assert.equal(exactReceipt.sameCamera, true);
assert.equal(exactReceipt.fixedState, true);
assert.equal(exactReceipt.population.rasterDeposits, 481447);
assert.equal(exactReceipt.population.depositsPerCandidate, 1);
assert.equal(exactReceipt.fallbackReason, null);

const orbitReceipt = cockpit.makeHeroState120RuntimeReceipt(
  request,
  { ...runtimeState, cameraSignature: 'operator-orbit-camera' },
  {
    exactCameraSignature: 'exact-camera',
    targetSourceReceipt: verifiedTarget.receipt,
  },
);
assert.equal(orbitReceipt.status, 'fixed-state-camera-exploration');
assert.equal(orbitReceipt.sameCamera, false);
assert.equal(orbitReceipt.fixedState, true);

assert.throws(
  () => cockpit.makeHeroState120RuntimeReceipt(
    request,
    {
      ...runtimeState,
      persistentSparseCohortGpuReceipt: null,
      boundarySplatSourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
    },
    {
      exactCameraSignature: 'exact-camera',
      targetSourceReceipt: verifiedTarget.receipt,
    },
  ),
  /hero-source-substitution/,
);
assert.throws(
  () => cockpit.makeHeroState120RuntimeReceipt(
    request,
    { ...runtimeState, boundarySplatFallbackReason: 'gpu-route-unavailable' },
    {
      exactCameraSignature: 'exact-camera',
      targetSourceReceipt: verifiedTarget.receipt,
    },
  ),
  /hero-renderer-fallback/,
);
assert.throws(
  () => cockpit.makeHeroState120RuntimeReceipt(
    request,
    { ...runtimeState, lookFreeze: 0 },
    {
      exactCameraSignature: 'exact-camera',
      targetSourceReceipt: verifiedTarget.receipt,
    },
  ),
  /hero-fixed-state-not-held/,
);
assert.throws(
  () => cockpit.makeHeroState120RuntimeReceipt(
    request,
    { ...runtimeState, selectiveHeadLiveCapturePaused: true },
    {
      exactCameraSignature: 'exact-camera',
      targetSourceReceipt: verifiedTarget.receipt,
    },
  ),
  /hero-presentation-loop-paused/,
);
assert.throws(
  () => cockpit.makeHeroState120RuntimeReceipt(
    request,
    runtimeState,
    {
      exactCameraSignature: 'exact-camera',
      targetSourceReceipt: {
        ...verifiedTarget.receipt,
        actualServedTargetSha256: '0'.repeat(64),
      },
    },
  ),
  /hero-target-bytes-substitution/,
);

assert.match(outerViewer, /parseHeroState120Route\(params\)/);
assert.match(outerViewer, /__kaminosBootstrapPersistentSparseCohort/);
assert.match(outerViewer, /Fixed authenticated state 120/);
assert.match(outerViewer, /FIXED STATE \/ CAMERA EXPLORATION/);
assert.doesNotMatch(
  outerViewer,
  /body\[data-hero-view="split"\]\s+#basin[^}]*width:\s*50vw/,
  'the comparator must not resize the authenticated renderer viewport',
);
assert.match(
  outerViewer,
  /clip-path:\s*inset\(0 0 0 50%\)/,
  'the comparator must reveal the target by clipping an overlay over the unchanged renderer',
);
assert.match(
  outerViewer,
  /sample\.fullSupportSourceCandidateCount/,
  'the Hero runtime must preserve post-render candidate accounting from the sampled pass',
);
assert.match(witness, /failurePhase/);
assert.match(witness, /Hero cockpit used a fallback backend/);
assert.match(witness, /Hero cockpit fallback looked authoritative/);
assert.match(witness, /Hero comparator screenshot is blank or partial/);
assert.match(
  witness,
  /effectiveRoute:\s*window\.location\.href/,
  'the witness must report the effective page route rather than relabeling the backend',
);
assert.match(
  witness,
  /setHeroView\('splat'\)/,
  'the witness must hide the target before judging the physical splat pixels',
);
assert.match(
  witness,
  /splat-only\.png/,
  'the witness must preserve a splat-only visual artifact',
);
assert.match(
  witness,
  /raymarch-target-only\.png/,
  'the witness must preserve a target-only visual artifact',
);
assert.match(
  witness,
  /physical splat canvas is blank/,
  'the target overlay must not be able to satisfy splat visual admission',
);
assert.match(
  witness,
  /sourceRawPixelSha256/,
  'the witness must preserve the authenticated source decoder pixel identity',
);
assert.match(
  witness,
  /browserPresentedRawPixelSha256/,
  'the witness must distinguish Chrome-presented pixels from authenticated source bytes',
);
assert.match(
  witness,
  /upstreamRenderReportTargetPixelSha256/,
  'the upstream render-buffer pixel identity must remain separate from decoded PNG pixels',
);
assert.match(
  witness,
  /actualServedTargetSha256/,
  'the witness must preserve and check the target bytes actually served',
);
assert.match(
  outerViewer,
  /URL\.createObjectURL\(/,
  'the target panel must present the exact fetched bytes through an object URL',
);
assert.equal(
  verifiedTarget.receipt.presentationSourceAuthority,
  'verified-fetched-bytes-object-url-v0',
  'the target presentation must carry explicit verified-byte authority',
);
assert.match(
  witness,
  /receipt\?\.status !== 'exact-fixed-pair' \|\| visible !== 'visible'/,
  'the witness must not race exact runtime admission ahead of visible presentation',
);
assert.match(
  outerViewer,
  /projectHeroState120HostReceipt/,
  'the exact Hero route must replace stale generic cohort status with its effective receipt',
);
assert.match(witness, /authenticated Hero route is not serving/);
assert.match(witness, /lease', 'release'/);
assert.match(
  session,
  /operatorRoute/,
  'the authenticated session must emit a short restartable operator route',
);

console.log('volume Hero state-120 cockpit contracts passed');
