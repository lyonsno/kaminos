#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const corePath = join(root, 'volume-core.js');
const exporterPath = join(root, 'volume-full-grid-field-export.mjs');

assert.ok(existsSync(exporterPath), 'full-grid field export harness exists on the learned-splat integration branch');

const core = readFileSync(corePath, 'utf8');
const exporter = readFileSync(exporterPath, 'utf8');

assert.match(core, /beginDebugFullFieldExport/, 'volume prototype exposes full-field export begin custody');
assert.match(core, /readDebugFullFieldExportChunk/, 'volume prototype exposes uncapped chunked full-field export reads');
assert.match(core, /releaseDebugFullFieldExport/, 'volume prototype exposes explicit full-field export release custody');
assert.match(core, /boundaryDescriptor/, 'full-field export includes the live boundary sidecar');
assert.match(core, /materializeFullFieldDerivedBuffersForDebugExport/, 'full-field export rebuilds derived sidecar and splat buffers from the frozen field');
assert.match(core, /boundarySplatDescriptor/, 'full-field export includes the effective compact learned-splat output');
assert.match(
  core,
  /deterministicReplay:\s*replaySample\s*\?\s*\{[\s\S]*identity:\s*replaySample\.identity[\s\S]*completedSteps:\s*replaySample\.completedSteps/,
  'full-field export records the effective top-level deterministic replay receipt rather than a nonexistent nested field',
);

assert.match(exporter, /--source-capture/, 'exporter accepts an operator exact-tab source capture');
assert.match(exporter, /--target-origin/, 'exporter can rebind the captured route to a caller-owned server origin');
assert.match(exporter, /--render-composition/, 'exporter accepts an invocation-scoped frozen render composition');
assert.match(exporter, /--render-control-overrides-json/, 'exporter accepts structured invocation-scoped render controls');
assert.match(exporter, /--export-scope/, 'exporter accepts an explicit output scope');
assert.match(exporter, /--viewport-size/, 'exporter accepts an explicit per-target viewport size');
assert.match(exporter, /Emulation\.setDeviceMetricsOverride/, 'exporter enforces viewport metrics through CDP instead of trusting a mutable browser window');
assert.match(exporter, /viewportContract/, 'export manifest records requested and effective viewport custody');
assert.match(exporter, /--render-canvas-size/, 'exporter accepts an explicit renderer canvas CSS size instead of trusting pre-render intrinsic dimensions');
assert.match(exporter, /renderCanvasContract/, 'export manifest records requested and effective renderer canvas geometry');
assert.match(exporter, /remount-imported-render-canvas/, 'exporter reacquires and restyles a renderer canvas replaced during warmup initialization');
assert.match(exporter, /post-render-canvas-geometry-drift/, 'exporter rejects a final render that replaced or resized the fixed witness canvas');
assert.match(exporter, /rect\.x \+ rect\.width > viewportContract\.effective\.width/, 'primary post-render clip must remain fully inside the effective viewport');
assert.match(exporter, /secondaryRect\.x \+ secondaryRect\.width > viewportContract\.effective\.width/, 'secondary post-render clip must remain fully inside the effective viewport');
assert.match(exporter, /fluid-front-only-v0/, 'exporter names the narrow fluid/front-only scope used by model pair production');
assert.match(
  exporter,
  /exportScope\s*===\s*'full-field-with-boundary-v0'[\s\S]*drain-boundary-sidecar/,
  'boundary sidecars are drained only by the default full-field scope',
);
assert.match(exporter, /exportScope,[\s\S]*derivedBoundaryCoverage:/, 'manifest records effective scope and honest derived-boundary coverage');
assert.match(exporter, /JSON\.parse\(String\(args\.get\('--render-control-overrides-json'\)/, 'render control overrides use structured JSON parsing instead of ad hoc text splitting');
assert.match(exporter, /sourceCapture/, 'export manifest records source-capture custody');
assert.match(exporter, /payloadSha256/, 'exporter validates and records the exact capture payload hash');
assert.match(exporter, /deterministicReplay/, 'exporter preserves deterministic replay identity');
assert.match(exporter, /boundarySidecar/, 'exporter drains the active boundary-sidecar field authority');
assert.match(exporter, /boundary-splats\.f32/, 'exporter drains the effective compact learned-splat output');
assert.match(exporter, /failurePhase/, 'exporter writes a durable failure phase');
assert.match(exporter, /onClose[\s\S]*rejectRequest[\s\S]*addEventListener\('close'/, 'CDP requests reject when a renderer target closes instead of hanging forever');
assert.match(exporter, /keepBrowserOpen[\s\S]*process\.unref\(\)/, 'an explicitly retained shared Chrome child is unreferenced so a completed exporter can exit');
assert.match(exporter, /boundarySplatComposition:\s*renderComposition/, 'imported render invocation passes the requested composition to the frozen renderer');
assert.match(exporter, /\['splat-only-v0',\s*'raymarch-only-v0',\s*'raymarch-under-splats-v0'\]\.includes\(renderComposition\)/, 'held-field export admits the renderer native raymarch-only composition without laundering it through a hybrid alias');
assert.match(exporter, /controlOverrides:\s*renderControlOverrides/, 'imported render invocation passes structured control overrides to the frozen renderer');
assert.match(exporter, /renderCompositionExplicit[\s\S]*boundarySplatCompositionEffective\s*!==\s*renderComposition/, 'an explicitly requested hybrid composition fails loud when the renderer reports another effective composition');

const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-exact-basin-export-contract-'));
const capturePath = join(fixtureRoot, 'corrupt-capture.json');
const outDir = join(fixtureRoot, 'out');
writeFileSync(capturePath, `${JSON.stringify({
  schema: 'kaminos.operator-exact-live-splat-basin-capture.v1',
  identity: 'corrupt-capture-fixture',
  replayRoute: 'http://127.0.0.1:9/?kaminos_volume_smoke=1',
  controls: {},
  payloadSha256: '0'.repeat(64),
  hashAuthority: 'fixture-intentionally-corrupt',
}, null, 2)}\n`);

assert.throws(() => execFileSync(process.execPath, [
  exporterPath,
  '--source-capture', capturePath,
  '--target-origin', 'http://127.0.0.1:9',
  '--out-dir', outDir,
], { stdio: 'pipe' }), /Command failed/, 'exporter refuses a corrupt exact-tab source capture before browser launch');

const failed = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
assert.equal(failed.status, 'failed', 'corrupt source capture writes a failed manifest');
assert.equal(failed.failurePhase, 'source-capture-validation', 'corrupt source capture fails during source-capture validation');
assert.match(failed.error, /payload SHA-256 mismatch/, 'failure report names the source payload hash mismatch');

const narrowOutDir = join(fixtureRoot, 'narrow-failure-out');
assert.throws(() => execFileSync(process.execPath, [
  exporterPath,
  '--source-capture', capturePath,
  '--target-origin', 'http://127.0.0.1:9',
  '--export-scope', 'fluid-front-only-v0',
  '--out-dir', narrowOutDir,
], { stdio: 'pipe' }), /Command failed/, 'narrow export also refuses a corrupt capture before browser launch');
const narrowFailed = JSON.parse(readFileSync(join(narrowOutDir, 'manifest.json'), 'utf8'));
assert.equal(narrowFailed.identity, 'full-grid-fluid-front-only-v0', 'narrow failure manifest keeps the requested scope identity');
assert.equal(narrowFailed.exportScope, 'fluid-front-only-v0', 'narrow failure manifest records the requested scope');
assert.equal(narrowFailed.failurePhase, 'source-capture-validation');

console.log('exact-basin full-grid export contracts passed');
