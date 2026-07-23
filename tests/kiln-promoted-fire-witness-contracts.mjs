import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validatePromotedFireWitnessState } from '../kiln-promoted-fire-witness.mjs';

const expected = {
  status: 'recording',
  engineIdentity: {
    sourceCommit: 'a556596a6ea1102bcd5bc287bf4c6645ce8e39f3',
    effectiveSha256: '1c934fc7cc2b1aea2c3b4410e97e97f701045b188a2ef19236a1345c49cba63d',
  },
  loaded: {
    mount: {
      mountId: 'firemount-50c6c9e5977fd4c1a8bc133bda0bdf30af5ac8ee91f63805abb182ab17cd72b7',
      policy: { policyId: 'firepolicy-0d0e2ed351051a48ab0b9eaaacbe38c482305f2bd21dc78297be1de50f318d17' },
      basin: { revision: 'basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95' },
    },
  },
  inferenceRan: false,
  routeRef: null,
  engineState: {
    active: true,
    frameCount: 8,
    simStepCount: 8,
    boundarySplatMode: 'kernel_moment_covariance',
    boundarySplatFallbackReason: null,
    raymarchSmokePresentationModeEffective: 'on',
    error: null,
  },
  pixelWitness: { width: 960, height: 640, changedPixels: 20000, litPixels: 12000 },
};

assert.doesNotThrow(() => validatePromotedFireWitnessState(expected));
for (const [name, mutate, pattern] of [
  ['wrong mount', value => { value.loaded.mount.mountId = 'firemount-' + '0'.repeat(64); }, /mount identity/],
  ['fallback', value => { value.engineState.boundarySplatFallbackReason = 'ordinary-fallback'; }, /fallback/],
  ['inference', value => { value.inferenceRan = true; }, /inference/],
  ['route', value => { value.routeRef = 'sharp:\/\/route\/forged'; }, /route/],
  ['no frames', value => { value.engineState.frameCount = 0; }, /frame/],
  ['blank canvas', value => { value.pixelWitness.changedPixels = 0; value.pixelWitness.litPixels = 0; }, /blank/],
]) {
  const candidate = structuredClone(expected);
  mutate(candidate);
  assert.throws(() => validatePromotedFireWitnessState(candidate), pattern, name);
}

const source = readFileSync(resolve(import.meta.dirname, '..', 'kiln-promoted-fire-witness.mjs'), 'utf8');
assert.match(source, /finally\s*\{[\s\S]*writeReport/, 'witness must preserve a report after early failure');
assert.match(source, /Page\.captureScreenshot/, 'witness must capture the live composed viewport');
assert.match(source, /endPromotedKilnFirePreview/, 'witness must close the exact preview episode');
assert.match(
  source,
  /screenshotPath:\s*primaryOutputWritten\s*\?\s*requestedOutputPath\s*:\s*null/,
  'durable witness reports preserve the caller-addressed screenshot locator instead of a worktree absolute path',
);

console.log('Kiln promoted fire visual witness contracts verified');
