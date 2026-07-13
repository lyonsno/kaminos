import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.match(
  core,
  /from '\.\/smoke-splat-slot-cache\.mjs'/,
  'volume runtime imports the reusable smoke slot cache contract',
);
assert.match(
  core,
  /const smokeSplatSlotCache = createSmokeSplatSlotCache\(/,
  'each volume prototype owns an isolated smoke decode cache',
);
assert.match(
  core,
  /function resolveSmokeSplatPhaseSlots\(options = \{\}\)/,
  'volume runtime exposes one named phase-slot resolution boundary',
);
assert.match(
  core,
  /function resolveSmokeSplatPhaseSlots\(options = \{\}\) \{\s*try \{[\s\S]*makeSmokeSplatPhaseInstances/,
  'epoch-binding failures are captured by the same durable runtime report path as decoder failures',
);
assert.match(
  core,
  /modelIdentity: options\.modelIdentity/,
  'smoke model identity is invocation-owned and cannot silently inherit flame model identity',
);
assert.match(
  core,
  /simulatorGeneration: state\.fluidStateResetCount/,
  'cache invalidation follows the live simulator generation',
);
assert.match(
  core,
  /historyWriteTick: state\.boundarySplatHistoryWriteTick/,
  'phase descriptors bind against the effective live ring write tick',
);
assert.match(
  core,
  /state\.smokeSplatSlotResolveReport = report/,
  'effective smoke slot resolution remains visible in runtime debug state',
);
assert.match(
  core,
  /resolveSmokeSplatPhaseSlots,/,
  'the live prototype public API exposes the phase-matched smoke resolver',
);
assert.match(
  core,
  /smokeSplatProducerAuthority: SMOKE_SPLAT_PRODUCER_AUTHORITY/,
  'debug state names the deterministic reference producer authority explicitly',
);

console.log('smoke splat volume integration contracts passed');
