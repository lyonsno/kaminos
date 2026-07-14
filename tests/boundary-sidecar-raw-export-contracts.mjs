import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const witnessUrl = new URL('../volume-boundary-sidecar-raw-export.mjs', import.meta.url);
const witness = existsSync(witnessUrl) ? readFileSync(witnessUrl, 'utf8') : '';

assert.match(core, /BOUNDARY_SIDECAR_RAW_EXPORT_IDENTITY\s*=\s*'boundary-sidecar-raw-two-buffer-export-v0'/, 'runtime names the raw two-buffer export contract');
assert.match(core, /async function captureBoundarySidecarRawFrame/, 'runtime exposes a frozen-frame raw sidecar capture');
assert.match(core, /boundarySplatSupervisionCaptureActive\s*=\s*true;\s*let structureReadback\s*=\s*null;\s*let metaReadback\s*=\s*null;\s*try\s*\{[\s\S]*onSubmittedWorkDone/, 'raw capture enters restoration custody before its first fallible queue or allocation operation');
assert.match(core, /encoder\.copyBufferToBuffer\(boundarySidecarBuffer[\s\S]*encoder\.copyBufferToBuffer\(boundarySidecarMetaBuffer/, 'one command buffer copies both same-state sidecar payloads');
assert.match(core, /gridToWorld[\s\S]*frameCount[\s\S]*simStepCount[\s\S]*boundarySidecarIdentity[\s\S]*boundarySidecarAuthority/, 'capture metadata preserves transform, frame/step, identity, and authority');
assert.match(core, /readBoundarySidecarRawCaptureChunk/, 'runtime exposes bounded chunk reads rather than one giant CDP payload');
assert.match(core, /releaseBoundarySidecarRawCapture/, 'runtime explicitly releases captured payload custody');
assert.match(core, /captureBoundarySidecarRawFrame,[\s\S]*readBoundarySidecarRawCaptureChunk,[\s\S]*releaseBoundarySidecarRawCapture/, 'prototype publishes the complete raw-export lifecycle');

assert.match(witness, /boundary-sidecar-raw-export-report-v0/, 'witness writes a durable report schema');
assert.match(witness, /structure\.f32[\s\S]*meta\.f32/, 'witness writes both raw float payloads');
assert.match(witness, /createHash\('sha256'\)/, 'witness hashes payload bytes');
assert.match(witness, /effectiveRoute[\s\S]*backend[\s\S]*fallbackReason[\s\S]*failurePhase/, 'witness fails loud with effective route and failure custody');
assert.match(witness, /readBoundarySidecarRawCaptureChunk/, 'witness drains bounded chunks from the retained browser capture');
assert.match(witness, /releaseBoundarySidecarRawCapture/, 'witness releases retained browser memory after extraction');
assert.doesNotMatch(witness, /canvas|toDataURL|ImageData/, 'raw sidecar export never round-trips through canvas RGB');

console.log('boundary sidecar raw export contracts passed');
