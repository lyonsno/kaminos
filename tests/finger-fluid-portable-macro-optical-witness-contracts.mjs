import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  urlsHaveSameIdentity,
} from '../finger-fluid-portable-macro-optical-witness.mjs';

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
  /finger-fluid-portable-macro-optical-witness\.html\?mode=continuous&time=/,
  'the requested continuous optical route and fixed state are explicit',
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
  'the same-state regular-grid-debug versus continuous-patch delta is measured',
);
assert.match(
  witness,
  /capture-same-state-regular-grid-debug[\s\S]*REGULAR_GRID_DEBUG_TOPOLOGY_ROUTE[\s\S]*capture-same-state-wet-boundary-clipped[\s\S]*WET_BOUNDARY_CLIPPED_TOPOLOGY_ROUTE[\s\S]*continuous reconstruction lacks a material clipped-route delta/,
  'the witness captures grid, clipped, and continuous topology evidence at one simulation state',
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
  /id="mode-controls"[\s\S]*data-mode="continuous"[\s\S]*data-mode="clipped"[\s\S]*data-mode="regular_grid_debug"[\s\S]*data-mode="cyan"/,
  'the operator can visibly select every supported rendering mode',
);
assert.match(
  runtime,
  /KAMINOS_PORTABLE_MACRO_OPTICAL_TOPOLOGY_CONTINUOUS_PATCH_ROUTE[\s\S]*continuous[\s\S]*clipped/,
  'the witness exposes continuous beauty and clipped attribution as distinct exact routes',
);
assert.match(
  witness,
  /capture-frozen-source-camera-base[\s\S]*capture-frozen-source-camera-moved/,
  'the witness separates fixed-camera source motion from frozen-source camera motion',
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
  page,
  /finger-fluid-portable-macro-optical-witness\.js\?runtime=continuous-v1/,
  'the visible control shell binds a versioned runtime instead of a stale cached module',
);
assert.match(
  witness,
  /servedPath:\s*'finger-fluid-portable-macro-optical-witness\.js\?runtime=continuous-v1'/,
  'served source identity binds the exact versioned runtime URL executed by the page',
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
  /function urlsHaveSameIdentity[\s\S]*searchParams[\s\S]*urlsHaveSameIdentity\(finalEffectiveUrl, expectedFinalUrl\)/,
  'effective URL identity ignores harmless query ordering without ignoring parameter values',
);
assert.equal(
  urlsHaveSameIdentity(
    'http://127.0.0.1:48220/witness?mode=continuous&time=2.75&paused=1',
    'http://127.0.0.1:48220/witness?paused=1&mode=continuous&time=2.75',
  ),
  true,
  'query ordering does not change effective URL identity',
);
for (const staleUrl of [
  'http://127.0.0.1:48220/witness?mode=cyan&time=2.75&paused=1',
  'http://127.0.0.1:48220/witness?mode=continuous&time=2.75',
  'http://127.0.0.1:48220/witness?mode=continuous&time=2.75&paused=1&fallback=cyan',
  'http://127.0.0.1:48220/witness?mode=continuous&mode=cyan&time=2.75&paused=1',
]) {
  assert.equal(
    urlsHaveSameIdentity(
      staleUrl,
      'http://127.0.0.1:48220/witness?mode=continuous&time=2.75&paused=1',
    ),
    false,
    `stale effective URL identity fails loud: ${staleUrl}`,
  );
}

const aliasTestDir = mkdtempSync(join(tmpdir(), 'kaminos-witness-alias-'));
const aliasReportPath = join(aliasTestDir, 'report.json');
const canonicalWitnessPath = fileURLToPath(
  new URL('../finger-fluid-portable-macro-optical-witness.mjs', import.meta.url),
);
const aliasWitnessPath = join(aliasTestDir, 'witness-alias.mjs');
symlinkSync(canonicalWitnessPath, aliasWitnessPath);
const aliasInvocation = spawnSync(
  process.execPath,
  [
    aliasWitnessPath,
    '--url',
    'http://127.0.0.1:48220/finger-fluid-portable-macro-optical-witness.html?mode=cyan&time=0.75',
    '--report',
    aliasReportPath,
  ],
  { encoding: 'utf8' },
);
assert.notEqual(
  aliasInvocation.status,
  0,
  'filesystem aliases still execute the witness instead of silently exiting zero',
);
assert.equal(
  existsSync(aliasReportPath),
  true,
  'filesystem-alias pre-output failure still writes a durable report',
);
rmSync(aliasTestDir, { recursive: true, force: true });

assert.match(
  witness,
  /localPath:\s*'finger-fluid-portable-macro-optical-witness\.html'[\s\S]*servedUrl:\s*requestedUrlObject/,
  'served document identity binds the exact query-bearing URL loaded by Chrome',
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
