import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(
  new URL('../finger-fluid-portable-macro-optical-witness.mjs', import.meta.url),
  'utf8',
);

assert.match(
  witness,
  /finger-fluid-portable-macro-optical-witness\.html\?mode=optical&time=/,
  'the requested optical route and fixed state are explicit',
);
assert.match(
  witness,
  /finger-fluid-portable-macro-optical-renderer\.js[\s\S]*servedSha256[\s\S]*exactLocalMatch/,
  'served renderer source is bound to the local checkout',
);
assert.match(
  witness,
  /effectiveUrl !== requestedUrl/,
  'a redirected or defaulted browser URL fails loud',
);
assert.match(
  witness,
  /candidate\.backend !== 'webgpu'/,
  'fallback rendering backends fail loud',
);
assert.match(
  witness,
  /candidate\.requestedRoute !== OPTICAL_ROUTE[\s\S]*candidate\.effectiveRoute !== OPTICAL_ROUTE/,
  'requested and effective optical route identity are checked independently',
);
assert.match(
  witness,
  /candidate\.fallback !== null/,
  'fallback route evidence cannot close the witness',
);
assert.match(
  witness,
  /candidate\.blank[\s\S]*candidate\.partial[\s\S]*!candidate\.primaryOutputWritten/,
  'blank, partial, and missing primary output all fail loud',
);
assert.match(
  witness,
  /dynamicDelta[\s\S]*changedRatio/,
  'the witness requires a non-stale dynamic frame delta',
);
assert.match(
  witness,
  /sameStateDelta[\s\S]*changedRatio/,
  'the same-state cyan versus optical delta is measured',
);
assert.match(
  witness,
  /failure_phase[\s\S]*lastTrustworthyEvidence[\s\S]*writeFileSync\(reportPath/,
  'pre-output failure still writes a durable phase report',
);
assert.match(
  witness,
  /Page\.captureScreenshot/,
  'the effective browser canvas is captured',
);

console.log('finger fluid portable macro optical witness contracts passed');
