import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const scriptUrl = new URL('../scripts/capture-smoke-oracle-teacher-sequence.mjs', import.meta.url);
const source = await readFile(scriptUrl, 'utf8');

assert.match(
  source,
  /--reuse-browser/,
  'teacher capture CLI must be able to attach to an already-proven headful CDP browser',
);

assert.match(
  source,
  /cdpStartupTimeoutMs/,
  'teacher capture CLI must bound CDP startup separately from long GPU readback calls',
);

assert.match(
  source,
  /recordFailureReport/,
  'teacher capture CLI must write a durable failure report from every pre-frame failure path',
);

assert.match(
  source,
  /SIGINT/,
  'teacher capture CLI must mark interrupted reports failed instead of leaving status=running',
);

assert.match(
  source,
  /controlledStepFrame/,
  'teacher capture CLI must use frame-locked controlledStepFrame sampling before dense export',
);

assert.match(
  source,
  /frame-locked-render-scale-set-v0/,
  'teacher capture CLI must validate controlled-step sample-set authority before accepting a teacher frame',
);

assert.match(
  source,
  /cdp-chunked-full-grid-readback-no-total-cap-v1/,
  'teacher capture CLI must record chunking as an uncapped transport policy, not a hidden dense-field cap',
);

assert.match(
  source,
  /uncapped-contiguous-chunks-until-runtime-complete/,
  'teacher capture CLI must keep exporting chunks until the runtime reports complete coverage',
);

assert.doesNotMatch(
  source,
  /for \(let attempt = 0; attempt < 120; attempt \+= 1\)[^]*cdpFetch\(port, '\/json\/version'\)/,
  'CDP startup polling must not multiply the long GPU readback timeout into a hidden multi-hour startup wait',
);

console.log('smoke oracle teacher capture CLI contracts passed');
