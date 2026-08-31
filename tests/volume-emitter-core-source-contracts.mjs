import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveVolumeCoreEmitterSource, resolveVolumeEmitterActivity } from '../volume-emitter-runtime.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

const primitiveCluster = resolveVolumeCoreEmitterSource({
  mode: 'cluster',
  controlFlowRate: 1.2,
  primitiveFlowRate: 0.15,
  primitiveId: 'fixture-fire-smoke-sphere',
});
assert.equal(primitiveCluster.effectiveFlowRate, 0.15);
assert.equal(primitiveCluster.effectiveOwner, 'volume-primitive');

const primitiveExternalOnly = resolveVolumeCoreEmitterSource({
  mode: 'external-only',
  controlFlowRate: 1.2,
  primitiveFlowRate: 0.15,
  primitiveId: 'fixture-fire-smoke-sphere',
});
assert.equal(primitiveExternalOnly.requestedPrimitiveFlowRate, 0.15);
assert.equal(primitiveExternalOnly.effectiveFlowRate, 0);
assert.equal(primitiveExternalOnly.effectiveOwner, 'external-emitter');
assert.equal(primitiveExternalOnly.fallbackUsed, false);

assert.match(core, /resolveVolumeCoreEmitterSource/, 'the actual volume core consumes the shared source arbiter');
assert.match(core, /function getPrimitiveSource\([^)]*\)[\s\S]*resolveVolumeCoreEmitterSource/, 'primitive flow resolves through the source arbiter before uniforms or initial fields consume it');
assert.match(core, /setCoreEmitterSourceMode\(mode\)/, 'the public prototype exposes the authoritative source-mode operation');
assert.match(core, /coreEmitterSourceReceipt/, 'debug state exposes the effective source authority receipt');
assert.match(core, /resolveVolumeEmitterActivity/, 'the actual GPU source gates consume the executable exclusive-activity contract');
assert.equal(resolveVolumeEmitterActivity({ mode: 'cluster', coreFlowRate: 1, analyticCount: 1, externalCount: 5 }).externalCount, 0);
assert.equal(resolveVolumeEmitterActivity({ mode: 'external-only', coreFlowRate: 1, analyticCount: 1, externalCount: 5 }).externalCount, 5);
assert.match(
  core,
  /function encodeAnalyticEmitterInjection\(encoder\) \{[\s\S]*resolveVolumeEmitterActivity[\s\S]*activity\.analyticCount === 0/,
  'retained analytic descriptors dispatch only under analytic-only authority',
);

console.log('volume emitter core source contracts passed');
