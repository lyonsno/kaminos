import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const retiredHarnessUrl = new URL('../volume-dynamic-texture-proof.mjs', import.meta.url);
const broadContracts = readFileSync(new URL('./volume-contracts.mjs', import.meta.url), 'utf8');

assert.equal(
  existsSync(retiredHarnessUrl),
  false,
  'the sine-painted dynamic-texture proof harness must remain retired instead of impersonating live simulator evidence',
);
assert.doesNotMatch(
  broadContracts,
  /volume-dynamic-texture-proof|kaminos\.volume\.dynamic-texture-proof|pyro-cellular-detail-memory-deterministic-ca-v0/,
  'broad contracts must not require or advertise the retired synthetic proof identity',
);

console.log('volume dynamic texture proof retirement contracts passed');
