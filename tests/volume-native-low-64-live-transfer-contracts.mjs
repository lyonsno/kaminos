#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const route = readFileSync(resolve(root, 'volume-native-low-selective-live.html'), 'utf8');
const runtime = readFileSync(resolve(root, 'native-low-selective-live-runtime.mjs'), 'utf8');
const core = readFileSync(resolve(root, 'volume-core.js'), 'utf8');
const witness = readFileSync(resolve(root, 'volume-native-low-transfer-long-sequence-witness.mjs'), 'utf8');
const combined = `${route}\n${runtime}\n${core}\n${witness}`;

assert.match(route, /manual_source_grid/, 'manual live assay accepts an explicit source grid');
assert.match(route, /manualSourceGrid[\s\S]*\[64, 96, 128\]/, 'manual live assay admits only the witnessed native source grids');
assert.match(route, /resolution:\s*manualSourceGrid/, 'manual capture steps the requested native source grid');
assert.match(route, /nativeGrid:\s*manualSourceGrid/, 'manual receipt exposes the effective native source grid');
assert.match(route, /nativeControlRoleIdentity[\s\S]*`native\$\{manualSourceGrid\}Control`/, 'control role identity names the effective native grid');
assert.match(route, /untouched-native-\$\{sourceGrid\}-control-sanity-baseline-v0/, 'control authority names the effective native grid');
assert.match(route, /native-\$\{manualSourceGrid\}-shared-source/, 'same-state identity names the genuine native source grid');
assert.match(route, /singleNativeSourceStepAdvanced:\s*true[\s\S]*secondPackageAdvanceSourceStep:\s*false/, 'both packages encode one exact shared native source step');
assert.match(route, /runtimeTruthAvailable[\s\S]*false[\s\S]*syntheticDownsampleApplied[\s\S]*false/, 'live native64 evidence forbids runtime truth and synthetic source downsampling');

assert.match(runtime, /\[64, 96, 128\]\.includes\(lowGrid\)/, 'shared-device runtime admits native64 shader specialization');
assert.match(core, /\[64, 96, 128\]\.includes\(sourceGrid\)/, 'renderer-owned shared-device capture admits native64 source buffers');
assert.match(combined, /native-64-native-96-or-native-128-runtime-selected-v0/, 'route receipts describe all admitted effective source grids');

assert.match(witness, /--expected-grid/, 'long witness requires an explicit expected-grid override for native64');
assert.match(witness, /\[64, 96, 128\]\.includes\(expectedGrid\)/, 'long witness can produce the matched native128 control without a second evidence route');
assert.match(witness, /native\$\{expectedGrid\}Control/, 'long witness derives the control role from the effective grid');
assert.match(witness, /frame-locked-consecutive-native-\$\{expectedGrid\}-simulation-steps-v0/, 'sequence authority names the effective native grid');
assert.match(witness, /assert\.equal\(state\?\.nativeGrid, expectedGrid/, 'witness rejects the wrong effective native grid');
assert.match(witness, /runtimeTruthAvailable[\s\S]*false[\s\S]*syntheticDownsampleApplied[\s\S]*false/, 'witness rejects truth peeking and synthetic source downsampling');
assert.match(witness, /sameNativeStateIdentity[\s\S]*sourceStepIdentity/, 'witness binds every pane to the same changing native state');
assert.match(witness, /candidateCount[\s\S]*instanceCount[\s\S]*overflowCount/, 'witness rejects hidden candidate truncation and overflow');
assert.match(witness, /fallbackReason[\s\S]*staleFrameReason/, 'witness rejects fallback and stale frames');
assert.match(witness, /dc1886384f87c4e51015f6ffd5ac8c0a48ac6f32b6f02a238ac5e3c3bd883dc9/, 'witness binds the 128-trained package checksum');
assert.match(witness, /baa54236f04c28eab278cf60e4a60745cd3c0160a985a9adbb1e06db7958f6e8/, 'witness binds the 96-trained package checksum');
assert.match(witness, /stageTiming:\s*value\.stageTiming\s*\|\|\s*null[\s\S]*modelSpecificTiming:\s*value\.modelSpecificTiming\s*\|\|\s*null/, 'witness preserves per-package runtime timing on native64 instead of making performance invisible');
assert.match(witness, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'witness preserves durable failure phase and last trustworthy evidence');

console.log('native-low 64 live transfer contracts passed');
