import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const witnessPath = join(root, 'volume-raymarch-specialization-witness.mjs');

assert.doesNotMatch(core, /selective-head-live-lean-frame-readback-v0/, 'generic frame capture must not claim lean specialization before receipt validation');
assert.match(core, /selective-head-live-raymarch-specialization-frame-readback-v0/, 'offscreen capture has specialization-neutral image authority');
assert.match(
  core,
  /captureSelectiveHeadLiveFrame[\s\S]*raymarchShaderSpecialization:\s*state\.raymarchShaderSpecialization\s*\?\s*\{\s*\.\.\.state\.raymarchShaderSpecialization\s*\}/,
  'captured pixels disclose the effective raymarch shader specialization',
);
assert.match(core, /captureSelectiveHeadLiveFrame[\s\S]*renderPhaseTimeMs:\s*state\.renderPhaseTimeMs[\s\S]*renderPhaseFrame:\s*state\.renderPhaseFrame/, 'frozen captures disclose their shader time and frame identity');
assert.match(
  core,
  /captureSelectiveHeadLiveFrame[\s\S]*routeIdentity:\s*SELECTIVE_HEAD_LIVE_ROUTE,[\s\S]*effectiveRoute:\s*state\.effectiveRoute,/,
  'frozen captures distinguish the selective-head wrapper route from the effective renderer route',
);

assert.ok(existsSync(witnessPath), 'dedicated full-versus-lean raymarch witness exists');
const witness = readFileSync(witnessPath, 'utf8');
assert.match(witness, /kaminos\.volume\.raymarch-specialization-witness\.v0/, 'report has a stable schema identity');
assert.match(witness, /mkdtempSync\([\s\S]*kaminos-raymarch-specialization-profile-/, 'witness uses an isolated Chrome profile');
assert.match(witness, /setSelectiveHeadLiveCapturePaused\(true\)/, 'witness freezes the live simulation before comparison');
assert.match(witness, /document\.querySelector\('#basin'\)\?\.contentWindow[\s\S]*__kaminosSelectiveHeadLive\?\.debugState/, 'witness exercises the real nested selective-head loader and consumer contract');
assert.match(witness, /lookFreeze:\s*1/, 'witness freezes shader time and frame animation as well as simulation state');
assert.match(witness, /untimedFreezeWarmup[\s\S]*collectGpuTiming:\s*false[\s\S]*const before = prototype\.debugState\(\)/, 'witness initializes frozen render identity before sealing the comparison state');
assert.match(witness, /setDebugRaymarchShaderSpecialization\(arm === 'full' \? 'force-full' : 'auto'\)/, 'witness captures full and admitted lean specializations from one runtime');
assert.doesNotMatch(witness, /force-lean/, 'witness cannot bypass semantic lean admission');
assert.match(witness, /advanceSim:\s*false[\s\S]*collectGpuTiming:\s*true/, 'both arms use frozen-state GPU timestamp captures');
assert.match(witness, /matchedRaymarchRaster/, 'report retains the disjoint raymarch raster timestamp');
assert.match(witness, /totalGpuMs[\s\S]*stages\.total/, 'net comparison includes support production from sidecar start through raymarch completion');
assert.match(witness, /sameStateIdentity[\s\S]*simStepCount[\s\S]*controlsHash[\s\S]*cameraHash[\s\S]*renderPhaseTimeMs[\s\S]*renderPhaseFrame/, 'comparison binds simulation, controls, camera, and render phase');
assert.match(witness, /effectiveUrl[\s\S]*effectiveRoute[\s\S]*backend[\s\S]*sourceCommit/, 'report binds effective runtime and source identity');
assert.match(witness, /effectiveRoute:\s*capture\.effectiveRoute/, 'sample evidence projects the capture renderer route rather than relabeling the wrapper route');
assert.match(witness, /expectedRuntime:[\s\S]*wrapperRoute:[\s\S]*rendererRoute:[\s\S]*composition:[\s\S]*backendClass:[\s\S]*fallbackReason:/, 'report separates expected route contract from observed runtime identity');
assert.match(witness, /expectedRole = new URL\(requestedUrl\)\.searchParams\.get\('role'\)/, 'caller role query is part of the admission contract');
assert.match(witness, /sampleRuntimeIdentities:[\s\S]*effectiveRole:[\s\S]*roleAuthority:[\s\S]*fallbackReason:[\s\S]*wrapperRoute:[\s\S]*wrapperFallbackReason:/, 'report preserves per-sample role, fallback, and live wrapper identity');
assert.match(witness, /sourceManifest[\s\S]*excludedPaths:\s*\[outDir, reportPath\]/, 'report binds a complete source manifest with explicit generated-output exclusions');
assert.match(witness, /raymarch-only-v0[\s\S]*raymarchApplied[\s\S]*splatApplied/, 'witness rejects pixels from the wrong composition');
assert.match(witness, /eligible[\s\S]*refusalReasons[\s\S]*effective/, 'lean arm must carry successful semantic admission and effective specialization');
assert.match(witness, /pixelDelta[\s\S]*maxChannelDelta[\s\S]*meanAbsChannelDelta[\s\S]*changedPixelRatio/, 'witness measures visual parity rather than assuming specialization DCE preserves pixels');
assert.match(witness, /pixelContract[\s\S]*exact-parity[\s\S]*ridge-refinement/, 'caller selects an explicit exact-parity or intended-ridge-change visual contract');
assert.match(witness, /assertPixelContract/, 'pixel acceptance is centralized and cannot silently inherit the wrong comparator semantics');
assert.match(witness, /raymarchSupportHierarchy/, 'lean samples bind the effective support hierarchy identity and producer');
assert.match(witness, /nonblank[\s\S]*pixelHash/, 'blank or missing output cannot become acceptance evidence');
assert.match(witness, /Runtime\.exceptionThrown[\s\S]*Runtime\.consoleAPICalled/, 'browser exceptions and console errors fail loud');
assert.match(witness, /failurePhase[\s\S]*lastTrustworthyEvidence[\s\S]*writeReport/, 'failure before images still writes the last trustworthy state');
assert.match(
  witness,
  /lastTrustworthyEvidence = \{ phase: failurePhase, admitted, evidence: stripPngData\(evidence\) \}/,
  'capture evidence retains the admitted runtime identity used to bind every full and lean sample',
);
assert.match(witness, /rmSync\(userDataDir,[\s\S]*maxRetries[\s\S]*retryDelay/, 'isolated browser profile cleanup tolerates Chrome exit races');
assert.match(witness, /--timeout-ms/, 'the caller owns the witness deadline');
assert.doesNotMatch(witness, /Math\.min\([^\n]*timeout|20000|20_000/, 'witness does not shadow the caller deadline with a hidden cap');

console.log('volume raymarch specialization witness contracts passed');
