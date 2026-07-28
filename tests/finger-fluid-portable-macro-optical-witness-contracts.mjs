import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const witness = readFileSync(
  new URL('../finger-fluid-portable-macro-optical-witness.mjs', import.meta.url),
  'utf8',
);
const page = readFileSync(
  new URL('../finger-fluid-portable-macro-optical-witness.html', import.meta.url),
  'utf8',
);
const runtime = readFileSync(
  new URL('../finger-fluid-portable-macro-optical-witness.js', import.meta.url),
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
  /initialEffectiveUrl !== requestedUrl/,
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
assert.match(
  witness,
  /exerciseOperatorControls[\s\S]*#playback-toggle[\s\S]*#time-control[\s\S]*#mode-controls/,
  'the browser witness exercises the visible operator controls',
);
assert.match(
  witness,
  /controls are hidden or partial[\s\S]*animation did not advance[\s\S]*pause control did not freeze/,
  'hidden, nonfunctional play, and nonfunctional pause controls fail loud',
);
assert.match(
  page,
  /id="mode-controls"[\s\S]*data-mode="optical"[\s\S]*data-mode="regular_grid_debug"[\s\S]*data-mode="cyan"/,
  'the operator can visibly select every supported rendering mode',
);
assert.match(
  page,
  /id="playback-toggle"[\s\S]*aria-label="Play animation"/,
  'the operator has an explicit animation control',
);
assert.match(
  page,
  /id="time-control"[\s\S]*type="range"[\s\S]*id="time-value"/,
  'the operator can scrub and inspect the exact witness time',
);
assert.match(
  runtime,
  /let requestedMode = query\.get\('mode'\)[\s\S]*let paused =/,
  'operator changes can update requested mode and playback state honestly',
);
assert.match(
  runtime,
  /function updateShareableUrl[\s\S]*history\.replaceState/,
  'operator state changes update the shareable URL',
);
assert.match(
  runtime,
  /function setMode[\s\S]*requestedMode = mode[\s\S]*updateShareableUrl/,
  'visible mode changes update requested identity and the shareable URL',
);
assert.match(
  runtime,
  /function setPaused[\s\S]*requestAnimationFrame\(renderFrame\)/,
  'play resumes actual frame scheduling instead of changing only a label',
);
assert.match(
  runtime,
  /timeControl\.addEventListener\('input'[\s\S]*setTime/,
  'the visible time scrubber drives the same exact-time route as automation',
);
assert.match(
  runtime,
  /function requireOperatorControls[\s\S]*operator controls are missing/,
  'missing visible controls publish a precise failure instead of null-dereferencing',
);
assert.match(
  runtime,
  /playbackToggle\?\.[\s\S]*timeControl\?\.[\s\S]*timeValue\?\./,
  'failure-state publication remains safe when a visible control is absent',
);
assert.match(
  witness,
  /initialEffectiveUrl[\s\S]*final effective URL is stale[\s\S]*effectiveUrl = finalEffectiveUrl/,
  'the report distinguishes the requested navigation URL from the final shareable URL',
);
assert.match(
  witness,
  /cyanControl\.click\(\)[\s\S]*cyan visible control route mismatch/,
  'the browser witness functionally exercises the visible Cyan route',
);
assert.match(
  witness,
  /requestedTime > Number\(timeControl\.max\)[\s\S]*timeControl\.max =/,
  'automation expands the visible scrubber range before setting an uncapped caller time',
);
assert.match(
  witness,
  /capture-same-state-cyan-debug[\s\S]*captures\.cyanDebug[\s\S]*captureCanvas/,
  'the browser witness captures and rejects blank or partial Cyan output',
);

console.log('finger fluid portable macro optical witness contracts passed');
