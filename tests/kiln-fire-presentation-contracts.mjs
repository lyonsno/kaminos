import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUrl = new URL('../kiln-fire-presentation.mjs', import.meta.url);
const source = await readFile(moduleUrl, 'utf8').catch(() => '');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  source,
  /export function createKilnFirePresentation/,
  'the renderer must expose one reusable fire-presentation contract',
);
assert.match(
  source,
  /export async function waitForHybridKilnFirePresentation/,
  'hybrid startup must have an explicit asynchronous evidence barrier',
);

const {
  createExpectedHybridKilnFirePresentation,
  createKilnFirePresentation,
  waitForHybridKilnFirePresentation,
} = await import(moduleUrl);

const firingId = 'firing-hybrid-0713';
const recordingHooks = {
  identity: 'foreground-kiln-fire-episode-hooks-v0',
  firingId,
  generation: 3,
  phase: 'recording',
  status: 'recording',
  evidenceSource: 'foreground-volume-render-loop-raf-sim-step-and-queue-proxy-v0',
  authority: 'renderer-simulator-hooks-for-wake-foreground-heartbeat',
  sampleCount: 4,
  frameAdvanceCount: 3,
  simStepAdvanceCount: 3,
  startedAtMs: 100,
};

const hybridState = {
  effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
  boundarySplatMode: 'learned',
  boundarySplatCompositionRequested: 'hybrid-smoke',
  boundarySplatCompositionEffective: 'hybrid-smoke',
  boundarySplatCompositionFallbackReason: null,
  boundarySplatRendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
  boundarySplatAttributeModelIdentity: 'sha256:model-0713',
  boundarySidecarIdentity: 'baked-boundary-sidecar-v0',
  boundarySplatSourceAuthority: 'live-baked-sidecar-plus-fluid-material-v0',
  boundarySplatCandidateCount: 1200,
  boundarySplatCapacity: 2048,
  boundarySplatOverflowCount: 0,
  boundarySplatCopyBytesThisFrame: 0,
  boundarySplatRadius: 0.8,
  boundarySplatSharpness: 6.5,
  boundarySplatGpuProfile: {
    identity: 'boundary-splat-stage-gpu-timestamp-profile-v0',
    timestampStatus: 'available',
    compactionMs: 2.4,
    learnedDecodeMs: 0,
  },
  fireEpisodeHooks: recordingHooks,
};

const presentation = createKilnFirePresentation({ firingId, state: hybridState });
assert.equal(presentation.schema, 'kaminos.kiln-fire-presentation.v0');
assert.equal(presentation.firingId, firingId);
assert.equal(presentation.requestedMode, 'learned-splat-flame-raymarched-smoke');
assert.equal(presentation.effectiveMode, 'learned-splat-flame-raymarched-smoke');
assert.equal(presentation.flameRendererIdentity, hybridState.boundarySplatRendererIdentity);
assert.equal(presentation.smokeRendererIdentity, hybridState.effectiveRoute);
assert.equal(presentation.learnedModelIdentity, hybridState.boundarySplatAttributeModelIdentity);
assert.equal(presentation.candidateCount, 1200);
assert.equal(presentation.candidateCapacity, 2048);
assert.equal(presentation.candidateOverflow, 0);
assert.equal(presentation.candidateCopyBytes, 0);
assert.equal(presentation.fallbackReason, null);
assert.equal(presentation.raster.radius, 0.8);
assert.equal(presentation.raster.sharpness, 6.5);
assert.equal(presentation.timing.authority, 'boundary-splat-stage-gpu-timestamp-profile-v0');
assert.deepEqual(presentation.fireEpisodeHooks, recordingHooks);

const fallback = createKilnFirePresentation({
  firingId,
  state: {
    ...hybridState,
    boundarySplatCompositionEffective: 'raymarch-fallback',
    boundarySplatCompositionFallbackReason: 'hybrid-attachments-unavailable',
    boundarySplatRendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
  },
});
assert.equal(fallback.requestedMode, 'learned-splat-flame-raymarched-smoke');
assert.equal(fallback.effectiveMode, 'raymarched-fire-smoke');
assert.equal(fallback.fallbackReason, 'hybrid-attachments-unavailable');

const expected = createExpectedHybridKilnFirePresentation({
  firingId,
  learnedModelIdentity: hybridState.boundarySplatAttributeModelIdentity,
});
assert.equal(expected.firingId, firingId);
assert.equal(expected.effectiveMode, 'learned-splat-flame-raymarched-smoke');
assert.equal(expected.requireNoFallback, true);
assert.equal(expected.requireZeroOverflow, true);
assert.equal(expected.requireCandidateEvidence, true);
assert.equal(expected.requireFireEpisodeHooks, true);

assert.throws(
  () => createKilnFirePresentation({ firingId: '', state: hybridState }),
  /firingId/,
  'presentation evidence cannot exist without exact firing identity',
);

let readinessNow = 0;
let readinessFrame = 0;
const readinessStates = [
  { ...hybridState, boundarySplatCandidateCount: null, boundarySplatOverflowCount: null },
  hybridState,
];
const readyPresentation = await waitForHybridKilnFirePresentation({
  firingId,
  readState: () => readinessStates[Math.min(readinessFrame, readinessStates.length - 1)],
  requestFrame: callback => {
    readinessFrame += 1;
    readinessNow += 16;
    callback(readinessNow);
  },
  now: () => readinessNow,
  timeoutMs: 100,
});
assert.equal(readyPresentation.candidateCount, 1200);
assert.equal(readinessFrame, 1, 'readiness waits only until effective candidate evidence exists');

await assert.rejects(
  () => waitForHybridKilnFirePresentation({
    firingId,
    readState: () => ({
      ...hybridState,
      boundarySplatCompositionEffective: 'raymarch-fallback',
      boundarySplatCompositionFallbackReason: 'hybrid-attachments-unavailable',
    }),
    requestFrame: callback => callback(0),
    now: () => 0,
    timeoutMs: 100,
  }),
  /hybrid-attachments-unavailable/,
  'an effective fallback fails before SHARP starts',
);

let timeoutNow = 0;
await assert.rejects(
  () => waitForHybridKilnFirePresentation({
    firingId,
    readState: () => ({ ...hybridState, boundarySplatCandidateCount: null }),
    requestFrame: callback => {
      timeoutNow += 25;
      callback(timeoutNow);
    },
    now: () => timeoutNow,
    timeoutMs: 50,
  }),
  /timed out.*candidate evidence/i,
  'missing candidate evidence cannot hang or masquerade as a usable hybrid route',
);

assert.match(core, /firePresentation:/, 'volume debug state must expose the effective presentation beside exact hooks');
assert.match(ui, /id="crucible-viewport-presentation-select"/, 'the central Crucible must expose the presentation choice');
assert.match(ui, />Show the flame as\s*<select/, 'the presentation control must use human-facing copy');
assert.match(ui, />Full volume</, 'the default presentation must remain full volume');
assert.match(ui, />Live splats with smoke \(preview\)</, 'the opt-in hybrid must be honestly labeled as a preview');
assert.match(
  ui,
  /createForegroundKilnHeartbeatEpisode\(\{[\s\S]*expectedFirePresentation,/,
  'the central heartbeat must receive the same-firing presentation expectation',
);
assert.match(
  ui,
  /volumePrototype\.beginFireEpisode\(\{\s*firingId\s*\}\)[\s\S]*await waitForHybridKilnFirePresentation\([\s\S]*createForegroundKilnHeartbeatEpisode\(/,
  'hybrid readiness must be proven inside the exact firing before foreground verification starts',
);

console.log('kiln fire presentation contracts passed');
