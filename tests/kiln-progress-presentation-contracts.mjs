import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  kilnRouteBenchProgressPresentation,
  kilnRouteBenchReceiveProgressEvent,
} from '../lib/kiln-progress-presentation.mjs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.doesNotMatch(
  index,
  /\$\{Math\.round\(routeProgress \* 100\)\}% complete/,
  'a stage-weighted SHARP projection must not be presented as measured completion',
);
assert.match(
  index,
  /const progressEvent\s*=\s*kilnRouteBenchReceiveProgressEvent\(event,\s*performance\.now\(\)\)/,
  'Kaminos must stamp progress arrival on its own monotonic clock',
);
assert.match(
  index,
  /setInterval\(refreshKilnRouteBenchProgressPresentation,\s*1000\)/,
  'event age must keep advancing when scheduler telemetry falls silent',
);

const received = kilnRouteBenchReceiveProgressEvent({
  progress: 0.64,
  progressAuthority: 'stage-weighted-work-projection',
  phase: 'vit-block-microphase',
  workOrdinal: 287,
  receivedAtMs: 1,
}, 10_000);
assert.equal(received.receivedAtMs, 10_000, 'the product receipt clock must override upstream freshness claims');
assert.deepEqual(
  kilnRouteBenchProgressPresentation(received, 14_250),
  {
    fillPercent: 64,
    label: '64% projected | vit block microphase | work 287 | 4s since update',
    percent: 64,
    projected: true,
  },
);

const unknownAuthority = kilnRouteBenchProgressPresentation({
  progress: 0.64,
  progressAuthority: 'unknown',
  receivedAtMs: 2_000,
}, 2_100);
assert.equal(unknownAuthority.label, '64% progress | updated now');
assert.doesNotMatch(unknownAuthority.label, /complete|projected/, 'unknown authority must not impersonate completion or projection');

const missingFreshness = kilnRouteBenchProgressPresentation({ progress: 0.15 }, 5_000);
assert.match(missingFreshness.label, /update age unavailable/, 'missing receipt time must fail visibly instead of looking fresh');
const futureFreshness = kilnRouteBenchProgressPresentation({ progress: 0.15, receivedAtMs: 6_000 }, 5_000);
assert.match(futureFreshness.label, /update age unavailable/, 'a future receipt time must not produce a false live age');

console.log('Kiln progress presentation contracts passed');
