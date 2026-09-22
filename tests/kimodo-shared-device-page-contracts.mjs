import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../kimodo-shared-device-inject.mjs', import.meta.url), 'utf8');

assert.match(source, /export\s*\{\s*sharedGpuDeviceRequirements\s*\}/, 'composition exports declarative requirements before mount');
assert.doesNotMatch(source, /initGPU|requestAdapter|navigator\.gpu/, 'composition has no producer-owned device fallback');
assert.match(source, /createKimodoProducer\(\{[\s\S]*device:\s*sharedGpu\.device[\s\S]*backendIdentity:\s*sharedGpu\.backendIdentity/, 'producer receives the exact host device and effective backend identity');
assert.match(source, /connectKimodoSharedDeviceForeground/, 'composition uses the public-kit persistent foreground adapter');
assert.match(source, /await\s+foreground\.beginRun\(runId\)[\s\S]*producer\.generate\([\s\S]*foregroundOpportunity:\s*boundary\s*=>\s*\{[\s\S]*telemetry\.foreground\(boundary\)[\s\S]*run\.foregroundOpportunity\(boundary\)[\s\S]*finally\s*\{[\s\S]*await\s+run\.finish\(\)/, 'every generation reserves, observes, services, and drains one persistent foreground run');
assert.match(source, /deviceTopology:\s*'same-device'/, 'human-visible evidence names exact shared topology');
assert.match(source, /foregroundReceipts/, 'composition retains actual foreground service receipts');
assert.doesNotMatch(source, /frameIntervals\.length\s*>|samples\.length\s*>|\.splice\(|\.shift\(\)/, 'diagnostic history remains uncapped so a long run cannot erase its own contention evidence');
assert.doesNotMatch(source, /layerChunk|chunkSize|four-layer/i, 'the shared-device assay preserves the full-pass Kimodo comparison class');

console.log('Kimodo shared-device page contracts passed');
