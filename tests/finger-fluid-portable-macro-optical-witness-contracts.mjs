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
  /candidate\.requestedTopologyRoute !== expectedTopologyRoute[\s\S]*candidate\.effectiveTopologyRoute !== expectedTopologyRoute/,
  'requested and effective optical topology identity are checked independently',
);
assert.match(
  witness,
  /candidate\.topologyFallback !== null/,
  'fallback topology evidence cannot close the witness',
);
assert.match(
  witness,
  /candidate\.rendererEvidence\?\.requestedTopologyRoute !== expectedTopologyRoute[\s\S]*candidate\.rendererEvidence\?\.effectiveTopologyRoute !== expectedTopologyRoute/,
  'the primary renderer receipt must independently prove the exact topology route',
);
assert.match(
  witness,
  /candidate\.rendererEvidence\?\.topologyFallback !== null/,
  'renderer-level topology fallback evidence cannot close the witness',
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
  'the same-state regular-grid-debug versus clipped-shoreline delta is measured',
);
assert.match(
  witness,
  /capture-same-state-regular-grid-debug[\s\S]*REGULAR_GRID_DEBUG_TOPOLOGY_ROUTE[\s\S]*capture-same-state-wet-boundary-clipped[\s\S]*WET_BOUNDARY_CLIPPED_TOPOLOGY_ROUTE/,
  'the witness captures both exact topology routes at one simulation state',
);
assert.match(
  witness,
  /boundaryId[\s\S]*resetId[\s\S]*shorelineCrossingCount[\s\S]*clippedCellCount/,
  'the witness retains source boundary lineage and clipped topology evidence',
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
