import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  page,
  /import \{\s*createSharpSameDeviceKilnOpportunityHook,?\s*\} from '\.\/lib\/sharp-same-device-kiln-interlock\.mjs'/,
  'Crucible must own the actual same-device kiln opportunity hook',
);
assert.match(
  page,
  /const SHARP_INLINE_ELEMENT_PREFIX = 'kaminos-sharp-inline-'[\s\S]{0,5000}__kaminosSharpElementPrefix = SHARP_INLINE_ELEMENT_PREFIX[\s\S]{0,1000}__kaminosSharpElementRoot = host/,
  'the inline SHARP module must mount against an isolated caller-owned DOM host before import',
);
for (const id of [
  'drop-zone', 'file-input', 'status', 'error', 'output', 'results', 'input-canvas',
  'depth-canvas', 'download-ply', 'use-spn', 'r-model', 'r-weights', 'r-patch',
  'r-title', 'r-time-label', 'r-grid', 'r-features', 'r-time', 'r-valid',
]) {
  assert.match(page, new RegExp(`SHARP_INLINE_ELEMENT_PREFIX\\}\\$\\{id\\}`), `inline host must create #${id}`);
}
assert.match(
  page,
  /runtimeConfig\.sharpInline[\s\S]{0,1000}registered[\s\S]{0,1000}moduleExists[\s\S]{0,1000}weightsExists/,
  'the product route must fail loud unless the reviewed SHARP module and weights are mounted',
);
assert.match(
  page,
  /const gpuContext = volumePrototype\.foregroundGpuContext\(\)[\s\S]{0,5000}inline\.run\(sourceBlob, \{[\s\S]{0,500}gpuContext,[\s\S]{0,500}weightsUrl:[\s\S]{0,500}scheduler,/,
  'the inline route must inject the product volume device, queue, weights URL, and requested scheduler',
);
assert.match(
  page,
  /createSharpSameDeviceKilnOpportunityHook\([\s\S]{0,1500}__kaminosSharpForegroundOpportunity = opportunityHook[\s\S]{0,1800}beforeInference: async[\s\S]{0,500}await volumePrototype\.setForegroundOpportunityMode\(true\)/,
  'the friendly route must keep ordinary kiln RAF alive through setup and enter lease mode at SHARP inference',
);
assert.match(
  page,
  /let foregroundModeActivated = false[\s\S]{0,5000}finally \{[\s\S]{0,1200}delete globalThis\.__kaminosSharpForegroundOpportunity[\s\S]{0,1200}if \(foregroundModeActivated\) await volumePrototype\.setForegroundOpportunityMode\(false\)/,
  'the foreground lease mode and hook must always be released after inline inference',
);
assert.match(
  page,
  /schema: 'sharp-webgpu\.background-heartbeat\.v0'[\s\S]{0,3000}sampleRetention: 'uncapped'/,
  'the inline evidence bridge must preserve same-clock uncapped SHARP duty evidence',
);
assert.match(
  page,
  /const overlapCandidates = \[\.\.\.events, \.\.\.intervals\][\s\S]{0,1500}candidate\.endMs > gapStartMs && candidate\.startMs < gapEndMs/,
  'foreground gap attribution must include reconstructed queue intervals that span an entire gap',
);
assert.match(
  page,
  /breathingRoom: \{[\s\S]{0,1000}requestedScheduler: backgroundHeartbeat\.requestedScheduler[\s\S]{0,500}effectiveScheduler: backgroundHeartbeat\.effectiveScheduler[\s\S]{0,500}telemetry: sharpResult\.runDebug\?\.schedulerTelemetry/,
  'the durable adapter must project canonical scheduler telemetry through the established witness surface',
);
assert.match(
  page,
  /requestedPipelineId: 'sharp-image-to-splat-live-v0'[\s\S]{0,1000}effectiveRouteConfig:[\s\S]{0,500}routeId: 'sharp-image-to-splat-live-v0'[\s\S]{0,1500}artifacts: \{ splat: artifact \}/,
  'the durable report must preserve the existing pipeline route and artifact projection contract',
);
assert.match(
  page,
  /fetch\('\/api\/ingest-splat'[\s\S]{0,1500}body: sharpResult\.plyBlob/,
  'the real PLY blob must be persisted through the product-owned ingest route',
);
assert.match(
  page,
  /sha256: entry\.sha256[\s\S]{0,300}status: entry\.status[\s\S]{0,300}bytes: entry\.bytes/,
  'the durable artifact must use the server receipt for its real hash, status, and byte count',
);
assert.match(
  page,
  /fetch\('\/api\/sharp-inline-run-report'[\s\S]{0,1800}document[\s\S]{0,1800}reportReceipt\.path[\s\S]{0,800}reportReceipt\.outputRoot/,
  'the complete inline run envelope must be durably written and rebound to its effective pipeline-runs identity',
);
assert.match(
  page,
  /artifact\?\.source \|\| pipelineRunReadUrlForPath/,
  'the cast loader must consume the persisted inline artifact source instead of projecting a pipeline-run path',
);
assert.match(
  page,
  /pipelineId === 'sharp-image-to-splat-live-v0'[\s\S]{0,1200}runSharpInlineProductRoute/,
  'the Crucible SHARP action must select the inline product-realm route rather than the separate backend process',
);

console.log('SHARP inline product integration contracts passed');
