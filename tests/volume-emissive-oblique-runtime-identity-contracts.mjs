import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../volume-physical-color-witness.mjs', import.meta.url), 'utf8');

assert.match(core, /EMISSIVE_LIGHT_TRANSPORT_MODEL/);
assert.match(core, /model:\s*EMISSIVE_LIGHT_TRANSPORT_MODEL/);
assert.match(core, /directions:\s*EMISSIVE_LIGHT_DIRECTION_COUNT/);
assert.match(core, /traversal:\s*'direct-lattice-rays'/);
assert.doesNotMatch(core, /model:\s*'six-direction-single-scattering-v1'/);
assert.match(
  witness,
  /result\.state\.physicalColor\.incidentLight\?\.model,\s*'fourteen-direction-cubic-lattice-ordinates-v1'/,
  'native evidence must reject a stale or fallback transport identity',
);
assert.match(witness, /result\.state\.physicalColor\.incidentLight\?\.directions,\s*14/);
assert.match(witness, /result\.state\.physicalColor\.incidentLight\?\.traversal,\s*'direct-lattice-rays'/);

console.log('emissive oblique runtime identity: cockpit and native witness require the effective transport route');
