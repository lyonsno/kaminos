import assert from 'node:assert/strict';

import {
  receiptAfterCleanupFailure,
  validateCP0SmokePixels,
  validateCP0SmokeState,
} from '../analytical-elbow-positive-volume-c-p0-live-smoke.mjs';

const sourceArtifactSha256 =
  '4facc5ba2d018fce24d749966f46c4041ee95279cd5d31e642024a0ad90f4005';
const state = {
  status:'complete',
  paused:true,
  animationActive:false,
  requestedRoute:'analytical-elbow-positive-volume-c-p0-witness',
  effectiveRoute:'analytical-elbow-positive-volume-c-p0-witness',
  fallbackUsed:false,
  sourceArtifactSha256,
  cameraPreset:'profile',
  overlays:{ regions:true, wireframe:false, rest:false },
  panels:[
    { id:'scalar-control-35-collar-0.72', vertexCount:986, triangleCount:1968, drawCount:2 },
    { id:'c-p0-w-derived-35', vertexCount:986, triangleCount:1968, drawCount:2 },
  ],
};
const pixels = [
  { width:640, height:360, sampledPixels:230400, coloredPixels:18000 },
  { width:640, height:360, sampledPixels:230400, coloredPixels:19000 },
];

assert.doesNotThrow(() => validateCP0SmokeState(state, {
  expectedCamera:'profile',
  expectedOverlays:state.overlays,
  expectedSourceSha256:sourceArtifactSha256,
}));
assert.doesNotThrow(() => validateCP0SmokePixels(pixels));

assert.throws(
  () => validateCP0SmokeState({ ...state, fallbackUsed:true }, {
    expectedCamera:'profile', expectedOverlays:state.overlays,
    expectedSourceSha256:sourceArtifactSha256,
  }),
  /fallback/,
);
assert.throws(
  () => validateCP0SmokeState({ ...state, sourceArtifactSha256:'stale' }, {
    expectedCamera:'profile', expectedOverlays:state.overlays,
    expectedSourceSha256:sourceArtifactSha256,
  }),
  /source artifact/,
);
assert.throws(
  () => validateCP0SmokeState({ ...state, panels:[state.panels[0]] }, {
    expectedCamera:'profile', expectedOverlays:state.overlays,
    expectedSourceSha256:sourceArtifactSha256,
  }),
  /two rendered panels/,
);
assert.throws(
  () => validateCP0SmokeState({ ...state, overlays:{ ...state.overlays, rest:true } }, {
    expectedCamera:'profile', expectedOverlays:state.overlays,
    expectedSourceSha256:sourceArtifactSha256,
  }),
  /overlays/,
);
assert.throws(
  () => validateCP0SmokePixels(pixels.map(entry => ({ ...entry, coloredPixels:0 }))),
  /blank/,
);

const cleanupFailure = receiptAfterCleanupFailure(
  { status:'captured', failurePhase:null, primaryOutput:'/tmp/witness.png' },
  new Error('profile directory remained busy'),
);
assert.equal(cleanupFailure.status, 'captured_with_cleanup_failure');
assert.equal(cleanupFailure.failurePhase, 'browser-cleanup');
assert.match(cleanupFailure.cleanupError, /profile directory remained busy/);
assert.equal(cleanupFailure.primaryOutput, '/tmp/witness.png');

console.log('analytical elbow C(P0) live smoke contracts passed');
