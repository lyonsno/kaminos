import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const core = readFileSync(new URL('volume-core.js', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');

assert.match(
  core,
  /onKilnFixedCameraCompositionReceipt/,
  'renderer exposes exact kiln receipt transitions to the cockpit instead of retaining private effective state',
);
assert.match(
  index,
  /onKilnFixedCameraCompositionReceipt:\s*receipt\s*=>/,
  'cockpit consumes renderer-owned effective and failed kiln receipts',
);
assert.match(
  core,
  /kiln-composition-initialization-failed/,
  'asset or GPU initialization failure publishes a durable failed receipt phase',
);
for (const failurePhase of ['asset-fetch', 'asset-sha256', 'asset-decode', 'asset-dimensions']) {
  assert.match(
    core,
    new RegExp(`kilnFailurePhase = '${failurePhase}'`),
    `asset initialization preserves a distinct ${failurePhase} failure phase`,
  );
}
assert.match(
  core,
  /kiln-composition-activation-failed/,
  'failure after verified assets but before the first frame replaces the public effective receipt',
);
assert.match(
  core,
  /kiln-composition-render-failed/,
  'failure after asset initialization cannot leave the public receipt effective',
);
assert.doesNotMatch(
  core,
  /return vec4<f32>\(displayRadiance \* alpha, alpha\)/,
  'already accumulated front-to-back radiance is not multiplied by alpha a second time',
);
assert.match(
  core,
  /return vec4<f32>\(displayRadiance, alpha\)/,
  'kiln source matches the established premultiplied caller-product contract',
);

console.log('kiln fixed-camera renderer contracts passed');
