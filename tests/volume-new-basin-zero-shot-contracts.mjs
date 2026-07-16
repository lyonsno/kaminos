import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const routePath = join(root, 'volume-native-low-selective-live.html');
const corePath = join(root, 'volume-core.js');
const runtimePath = join(root, 'native-low-selective-live-runtime.mjs');
const witnessPath = join(root, 'volume-new-basin-zero-shot-witness.mjs');
const sharedWitnessPath = join(root, 'volume-native-low-transfer-long-sequence-witness.mjs');

assert.ok(existsSync(routePath), 'native-low live route exists');
assert.ok(existsSync(corePath), 'volume renderer core exists');
assert.ok(existsSync(runtimePath), 'native-low inference runtime exists');
assert.ok(existsSync(witnessPath), 'new-basin zero-shot witness exists');
assert.ok(existsSync(sharedWitnessPath), 'continuous shared witness exists');

const route = readFileSync(routePath, 'utf8');
const core = readFileSync(corePath, 'utf8');
const runtime = readFileSync(runtimePath, 'utf8');
const witness = readFileSync(witnessPath, 'utf8');
const sharedWitness = readFileSync(sharedWitnessPath, 'utf8');
const witnessContract = `${witness}\n${sharedWitness}`;
const combined = `${route}\n${core}\n${witnessContract}`;

assert.match(route, /new_basin_zero_shot/, 'route exposes an explicit new-basin assay mode');
assert.match(route, /vsp-48617494d68e4f24bba358676733f2aaa5f03622b1747c45056de56884fe78d8/, 'assay binds the immutable operator preset');
assert.match(route, /LATEST_HAPPY_BOWL_PRESET_URL[\s\S]*presetFileSha256[\s\S]*sourceCommit/, 'assay consumes the exact preset JSON and preserves source custody');
assert.match(route, /exactPresetRouteApplied[\s\S]*controlOverrides/, 'assay distinguishes exact preset application from an explicit source-grid-only override');
assert.match(route, /requestedDomControlCount[\s\S]*requestedRouteControlCount/, 'assay does not conflate DOM controls with executable route parameters');
assert.match(route, /raymarch-only-v0/, 'assay requests renderer-matched raymarch-only composition');
assert.match(route, /native\$\{manualSourceGrid\}Control[\s\S]*deterministicUpscale[\s\S]*baseline128Trained[\s\S]*candidate96Trained/, 'assay presents control, deterministic upscale, and both frozen packages');
assert.match(route, /runtimeTruthAvailable:\s*false/, 'runtime truth remains unavailable');
assert.match(route, /syntheticDownsampleApplied:\s*false/, 'assay does not manufacture a low source from high truth');
assert.match(route, /sameNativeStateIdentity/, 'all roles bind to one native source state');
assert.match(route, /body\.new-basin-zero-shot #runner-wrap[\s\S]*900px[\s\S]*900px/, 'new-basin renderer uses a square source viewport');
assert.match(route, /body\.new-basin-zero-shot \.pane img[\s\S]*object-fit:\s*contain/, 'operator panes preserve the complete rendered frame');

assert.match(core, /captureDeterministicUpscale/, 'shared-device capture can request a deterministic field-upsample control');
assert.match(core, /nativeUpsampleFluid[\s\S]*nativeUpsampleFront/, 'deterministic control materializes the runtime native-upsample buffers');
assert.match(core, /\['splat-only-v0', 'raymarch-only-v0'\]/, 'shared-device capture admits only the named evidence compositions');
assert.match(core, /deterministicUpscaleVisualUrl/, 'shared-device capture returns the deterministic-upscale image');
assert.match(runtime, /nativeUpsampleFluid/, 'runtime preserves the deterministic fluid upsample before learned residual mutation');
assert.match(runtime, /native-low-deterministic-upsample-control-v0/, 'runtime build identity changes with the new preserved buffer contract');
assert.match(runtime, /\[48, 64, 96, 128\]\.includes\(lowGrid\)/, 'runtime admits every source grid advertised by the new-basin witness');

assert.match(witness, /--new-basin-zero-shot/, 'named witness cannot silently run the legacy three-role mode');
assert.match(witnessContract, /new-basin-zero-shot-raymarch-witness-v0/, 'witness names its evidence identity');
assert.match(witnessContract, /deterministicUpscale[\s\S]*baseline128Trained[\s\S]*candidate96Trained/, 'witness requires all four visual roles');
assert.match(witnessContract, /requestedBasinIdentity[\s\S]*effectiveBasinIdentity/, 'witness rejects silent basin substitution');
assert.match(witnessContract, /exactPresetRouteApplied[\s\S]*sourceGridOverrideApplied[\s\S]*controlOverrides/, 'witness proves exact preset custody or records the grid override explicitly');
assert.match(witnessContract, /latest_happy_bowl preset \+ explicit source-grid override/, 'operator page does not call an overridden route the exact preset');
assert.match(witnessContract, /requestedComposition[\s\S]*effectiveComposition/, 'witness rejects silent renderer substitution');
assert.match(witnessContract, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'witness writes phase-bearing failure reports');
assert.match(witnessContract, /lastObservedRouteState/, 'route-settle failures preserve the browser state that explains the failure');
assert.match(witnessContract, /runtimeTruthAvailable[\s\S]*syntheticDownsampleApplied/, 'witness records runtime authority boundaries');
assert.match(witnessContract, /modelSha256/, 'witness records frozen model checksums');
assert.match(witnessContract, /captureViewport[\s\S]*1200[\s\S]*1200/, 'new-basin witness captures four legible square panes');

console.log('new-basin zero-shot contracts passed');
