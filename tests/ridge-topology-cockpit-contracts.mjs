#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildRidgeTopologyCockpitRoute,
  validateRidgeTopologyCockpitAdmission,
  validateRidgeTopologyCockpitControls,
} from '../ridge-topology-cockpit-contract.mjs';

const coreSource = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const wrapperSource = await readFile(new URL('../volume-selective-head-live.html', import.meta.url), 'utf8');
const cockpitSource = await readFile(new URL('../ridge-topology-cockpit.html', import.meta.url), 'utf8');
const witnessSource = await readFile(new URL('../ridge-topology-cockpit-witness.mjs', import.meta.url), 'utf8');

assert.match(
  coreSource,
  /function normalizeBoundarySplatRadianceGain\(value\)/,
  'the cockpit requires a normalized splat radiance gain instead of a post-capture exposure trick',
);
assert.match(
  coreSource,
  /function normalizeBoundarySplatOpacityGain\(value\)/,
  'the cockpit requires opacity to remain independently controllable from emitted radiance',
);
assert.match(
  coreSource,
  /appearance:\s*vec4<f32>/,
  'the boundary splat uniform must carry explicit appearance calibration controls',
);
assert.match(
  coreSource,
  /in\.colorOpacity\.rgb\s*\*\s*boundarySplatCamera\.appearance\.x/,
  'radiance calibration must apply to pre-blend splat RGB',
);
assert.match(
  coreSource,
  /in\.colorOpacity\.a\s*\*\s*boundarySplatCamera\.appearance\.y\s*\*\s*gaussian/,
  'opacity calibration must apply independently to splat alpha',
);
assert.match(coreSource, /size:\s*128/, 'the expanded eight-vec4 uniform must allocate 128 bytes');
assert.match(coreSource, /new Float32Array\(32\)/, 'the CPU upload must populate all 32 uniform floats');
assert.match(coreSource, /boundarySplatRadianceGain:\s*state\.boundarySplatRadianceGain/, 'capture receipts must record effective radiance gain');
assert.match(coreSource, /boundarySplatOpacityGain:\s*state\.boundarySplatOpacityGain/, 'capture receipts must record effective opacity gain');

assert.match(wrapperSource, /function setControls\(next\)/, 'the wrapper must expose a same-origin runtime control forwarder');
assert.match(wrapperSource, /setControls,\s*captureFrame/, 'the operator API must publish the runtime control forwarder');
assert.match(cockpitSource, /fetch\(REPORT_URL,\s*\{\s*cache:\s*'no-store'\s*\}\)/, 'the cockpit must not admit a cached r10 report');
assert.match(cockpitSource, /sha256Json\(initial\.rendererState\.controls\)/, 'the cockpit must bind the initial effective controls hash');
assert.match(cockpitSource, /outputStats\(targetFrame\.rgba\)/, 'the cockpit must reject a blank or static initial target');
assert.match(cockpitSource, /advanceSim:\s*false/, 'interactive repaint must keep the frozen simulator fixed');
assert.match(cockpitSource, /__kaminosRidgeTopologyCockpit/, 'the cockpit must expose a witnessable runtime API');
assert.match(cockpitSource, /function installBasinCockpitStyles\(\)/, 'the cockpit must own a stage-only presentation layer');
assert.match(cockpitSource, /#sidebar\s*\{\s*display:\s*none/, 'the embedded workbench sidebar must not consume the visual stage');
assert.match(cockpitSource, /#viewport\s*\{\s*position:\s*absolute;\s*inset:\s*0/, 'the native WebGPU viewport must fill the visual stage');
assert.match(cockpitSource, /async function whenRenderIdle\(\)/, 'the cockpit must expose a settled-presentation barrier');
assert.match(cockpitSource, /async function captureStageEvidence\(\)/, 'the cockpit must expose stage-only readback evidence for the active mode');
assert.match(cockpitSource, /rgbaSha256/, 'stage evidence must hash renderer RGBA rather than page UI pixels');
assert.match(cockpitSource, /stageBounds/, 'stage evidence must preserve the operator-visible assay bounds');
assert.match(witnessSource, /await cockpit\.whenRenderIdle\(\)/, 'the visual witness must not screenshot queued presentation work');
assert.match(witnessSource, /await cockpit\.captureStageEvidence\(\)/, 'every witness capture must collect stage-only renderer evidence');
assert.match(witnessSource, /stageEvidence\.nonBlankPixelCount/, 'the witness must reject a blank stage independently from page chrome');
assert.match(witnessSource, /stageEvidence\.distinctColorCountLowerBound/, 'the witness must reject a flat stage independently from page chrome');
assert.match(witnessSource, /row\.stageEvidence\.rgbaSha256/, 'cached/static comparisons must use stage-only RGBA hashes');
assert.match(witnessSource, /failurePhase/, 'the witness must preserve its failure phase before primary output');
assert.match(witnessSource, /Page\.captureScreenshot/, 'the witness must capture the operator-visible cockpit');
assert.match(witnessSource, /target\.png/, 'the witness must preserve the exact raymarch target view');
assert.match(witnessSource, /splats-baseline\.png/, 'the witness must preserve baseline world-covariance splats');
assert.match(witnessSource, /splats-cooled\.png/, 'the witness must preserve a lower-radiance artist calibration');
assert.match(witnessSource, /mobile-cooled\.png/, 'the witness must verify the compact viewport layout');
assert.match(witnessSource, /admissionReceipt/, 'the witness must reject a screenshot without checksum admission authority');
assert.match(witnessSource, /WebGPU/, 'the witness must record and enforce the effective GPU backend');

const report = JSON.parse(await readFile(new URL(
  '../artifacts/pyro-gaussian-footprint-kneecapper-0716/ridge-cross-extinction-anchor96-grid160-frozen-r10/report.json',
  import.meta.url,
), 'utf8'));
const route = buildRidgeTopologyCockpitRoute(
  report,
  'http://127.0.0.1:18223/',
  'http://127.0.0.1:18537',
);
assert.equal(route.pathname, '/volume-selective-head-live.html');
assert.equal(route.origin, 'http://127.0.0.1:18223');
assert.equal(route.searchParams.get('anchor_base'), 'http://127.0.0.1:18537');
assert.equal(route.searchParams.get('freeze_after_warmup'), '1');
assert.equal(route.searchParams.get('volume_reaction_boundary_topology'), '0.96');
assert.equal(route.searchParams.get('volume_reaction_live_view'), 'boundary_fire');

const wrapper = {
  routeIdentity: 'exact-basin-selective-head-live-v0',
  status: 'running',
  requestedRole: 'truthHigh',
  effectiveRole: 'truthHigh',
  requestedComposition: 'raymarch-only-v0',
  effectiveComposition: 'raymarch-only-v0',
  warmupAuthority: 'checksum-bound-exact-basin-step96-field-anchor-v0',
  warmupTarget: 96,
  warmupComplete: true,
  warmupReceipt: {
    ok: true,
    authority: 'checksum-bound-exact-basin-step96-field-anchor-v0',
    completedSteps: 96,
    fluidSha256: 'd58df9b715f0e7cd21b2e97811e5f19b2ecf2e7494a7e2bbc3866f61fcb94ac1',
    frontSha256: '1fd70b831b7f377d2923288715ca6ccbe26939790fd51b8f759ffb7c00ff29e8',
  },
  freezeAfterWarmupRequested: true,
  postWarmupFreezeReceipt: { paused: true, frameCount: 96, simStepCount: 96 },
  backend: 'WebGPU: Apple M3 Max',
  simGrid: 160,
  frameCount: 97,
  simStepCount: 96,
  fallbackReason: null,
  boundarySplatFallbackReason: null,
};
const renderer = {
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  boundarySplatCandidateCount: 93189,
  boundarySplatInstanceCount: 93189,
  boundarySplatOverflowCount: 0,
  boundarySplatFallbackReason: null,
  controls: {
    reactionBoundaryTopology: 0.96,
    reactionLiveView: 'boundary_fire',
    fireRenderMode: 'inspect',
    shellInspectMode: 'boundary_fire',
  },
};
const admissionRequest = {
  controlsHash: 'dd8b25a6fad4775355e539d58d107fc7a26588ac23e7ec123a5d0eb999bb406f',
  output: { nonBlankPixelCount: 8120, distinctColorCountLowerBound: 2 },
};
const admission = validateRidgeTopologyCockpitAdmission({ report, wrapper, renderer, ...admissionRequest });
assert.equal(admission.ok, true);

assert.throws(
  () => validateRidgeTopologyCockpitAdmission({ report, wrapper: { ...wrapper, routeIdentity: 'fallback-wrapper' }, renderer, ...admissionRequest }),
  /wrapper route/i,
);
assert.throws(
  () => validateRidgeTopologyCockpitAdmission({ report, wrapper, renderer, ...admissionRequest, controlsHash: '0'.repeat(64) }),
  /controls hash/i,
);
assert.throws(
  () => validateRidgeTopologyCockpitAdmission({ report, wrapper, renderer: { ...renderer, boundarySplatCandidateCount: 0 }, ...admissionRequest }),
  /candidate/i,
);
assert.throws(
  () => validateRidgeTopologyCockpitAdmission({ report, wrapper, renderer, ...admissionRequest, output: { nonBlankPixelCount: 0, distinctColorCountLowerBound: 1 } }),
  /blank/i,
);
assert.throws(
  () => validateRidgeTopologyCockpitAdmission({ report, wrapper: { ...wrapper, fallbackReason: 'default-route' }, renderer, ...admissionRequest }),
  /fallback/i,
);
assert.throws(
  () => validateRidgeTopologyCockpitAdmission({
    report,
    wrapper: { ...wrapper, warmupReceipt: { ...wrapper.warmupReceipt, frontSha256: null } },
    renderer,
    ...admissionRequest,
  }),
  /anchor/i,
);

const requestedControls = {
  boundarySplatMode: 'world_covariance',
  boundarySplatRadius: 0.98,
  boundarySplatSharpness: 12,
  boundarySplatRadianceGain: 0.62,
  boundarySplatOpacityGain: 0.74,
  reactionBoundaryTopology: 0.96,
};
const effectiveControls = {
  ...requestedControls,
  boundarySplatCandidateCount: 93189,
  boundarySplatInstanceCount: 93189,
  boundarySplatOverflowCount: 0,
  fallbackReason: null,
};
assert.equal(validateRidgeTopologyCockpitControls(requestedControls, effectiveControls).ok, true);
assert.throws(
  () => validateRidgeTopologyCockpitControls(requestedControls, { ...effectiveControls, reactionBoundaryTopology: 0.4 }),
  /topology/i,
);
assert.throws(
  () => validateRidgeTopologyCockpitControls(requestedControls, { ...effectiveControls, boundarySplatRadianceGain: 1 }),
  /radiance/i,
);

console.log('ridge topology cockpit control contracts passed');
