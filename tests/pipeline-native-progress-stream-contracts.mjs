import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../serve.py', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../pipeline-witness.mjs', import.meta.url), 'utf8');
const uiWitness = readFileSync(new URL('../pipeline-ui-witness.mjs', import.meta.url), 'utf8');
const mockSharp = readFileSync(new URL('./fixtures/mock-sharp-command.mjs', import.meta.url), 'utf8');

assert.match(witness, /kaminos\.pipeline-progress\.v0/, 'pipeline witness must emit schema-stamped progress events');
assert.match(witness, /KAMINOS_PIPELINE_PROGRESS_STREAM/, 'pipeline witness must gate progress event stdout for stream consumers');
assert.match(witness, /function emitPipelineProgress\(/, 'pipeline witness must centralize progress event emission');
assert.match(witness, /spawn\(/, 'live adapter execution must stream child output instead of blocking behind spawnSync');
assert.match(witness, /forwardAdapterProgressLine/, 'pipeline witness must forward adapter progress events from native commands');

assert.match(server, /application\/x-ndjson/, 'dev server must expose an NDJSON pipeline run response for progress streaming');
assert.match(server, /streamProgress/, 'pipeline run API must accept an explicit streamProgress request');
assert.match(server, /subprocess\.Popen/, 'streaming pipeline path must read child output while it is running');
assert.match(server, /kaminos\.pipeline-progress\.v0/, 'server stream must recognize pipeline progress events');
assert.match(server, /pipeline-run-result\.v0/, 'server stream must still end with the ordinary run result payload');

assert.match(index, /function pipelineUpdateGeneratedOutputProgress\(/, 'browser runtime must update pending generated-output records from progress events');
assert.match(index, /function readPipelineRunStream\(/, 'browser runtime must parse streamed pipeline progress events');
assert.match(index, /streamProgress:\s*true/, 'browser runtime must request streamed progress for graph route execution');
assert.match(index, /onProgress/, 'runSelectedPipeline must accept a progress callback');
assert.match(index, /data-pipeline-route-progress/, 'route node DOM must expose live numeric progress when available');
assert.match(index, /route progress/, 'route inspector must show live progress without selecting generated output');

assert.match(uiWitness, /nativeProgressObserved/, 'browser witness must prove a native progress event reached the graph before completion');
assert.match(uiWitness, /data-pipeline-route-progress/, 'browser witness must inspect the route progress DOM attribute');
assert.match(uiWitness, /KAMINOS_MOCK_SHARP_PROGRESS/, 'browser witness smoke must be able to use a fixture-backed slow/progress adapter');

assert.match(mockSharp, /KAMINOS_MOCK_SHARP_PROGRESS/, 'mock SHARP fixture must be able to emit progress events');
assert.match(mockSharp, /kaminos\.pipeline-progress\.v0/, 'mock SHARP progress events must use the shared progress schema');
