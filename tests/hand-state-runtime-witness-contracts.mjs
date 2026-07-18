import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const witness = readFileSync(join(root, 'hand-state-runtime-witness.mjs'), 'utf8');

assert.match(witness, /requestedUrl/, 'witness records requested route');
assert.match(witness, /effectiveUrl/, 'witness records effective route');
assert.match(witness, /fixtureMode/, 'witness records fixture authority');
assert.match(witness, /primary_output_written/, 'witness reports output production');
assert.match(witness, /meshVisible/, 'witness requires a visible mesh');
assert.match(witness, /vertexCount/, 'witness records surface vertices');
assert.match(witness, /__kaminosHandStateInitFingerJuice/, 'witness initializes the production finger-fluid backend');
assert.match(witness, /webgpu_compute/, 'witness rejects a substituted finger-fluid solver');
assert.match(witness, /webgpu_direct_render/, 'witness rejects a substituted finger-fluid renderer');
assert.match(witness, /probe\(fixturePacket\(\), 12\)/, 'witness captures the emitted jets before they settle onto the fluid support plane');
assert.match(witness, /emitterCount !== 5/, 'witness rejects partial emitter buffer growth');
assert.match(witness, /inactiveEmitterRespawnReceipt/, 'witness records whether startup-inactive particles respawned after emitters arrived');
assert.match(witness, /particleCount <= 0/, 'witness rejects an emitter route that cannot activate particles');
assert.match(witness, /particlesPerEmitter/, 'witness records real particle allocation across admitted emitters');
assert.match(witness, /emitterBuckets\.length !== 5/, 'witness rejects slot-zero monopoly masquerading as five live jets');
assert.match(witness, /__kaminosHandStateProbeFingerJuice/, 'witness advances and renders the production fluid route before capture');
assert.match(witness, /__kaminosHandStateFixtureEmitterPacket/, 'visual probe sources its emitters from recorded MANO fingertip vertices');
assert.match(witness, /activeEmitterCount !== 5/, 'witness rejects a visual capture without all five probe emitters active');
assert.doesNotMatch(witness, /fixture-zero-emitters/, 'witness does not clear emitters before visual capture');
assert.match(witness, /consoleEvents/, 'witness records browser errors');

console.log('hand-state runtime witness contracts passed');
