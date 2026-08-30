import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveVolumeCoreEmitterSource } from '../volume-emitter-runtime.mjs';

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

console.log('volume emitter core source contracts passed');
