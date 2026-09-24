import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pressureTierDispatchEvidence } from '../volume-pressure-tier-witness-contract.mjs';

const dimensions = [64, 128, 64];
const dispatch = (tier, workgroupsY, pressureBuffer) => ({
  tier, workgroupsX: 16, workgroupsY, workgroupsZ: 16, pressureBuffer,
});
const ledger = (lowerY, heroY, reported) => ({
  pressureJacobiFullGridEquivalentPasses: reported,
  pressureTierDispatches: [dispatch(1, 32, 'B'), dispatch(2, lowerY, 'A'), dispatch(3, heroY, 'B')],
});

assert.equal(pressureTierDispatchEvidence(ledger(32, 32, 3), dimensions).bounded, true,
  'a deliberately broad saved pressure-tier preset may cost exactly three full passes');
assert.equal(pressureTierDispatchEvidence(ledger(24, 8, 2), dimensions).bounded, true,
  'partial dispatches preserve an exact equivalent-work receipt');
for (const [name, candidate] of [
  ['incorrect equivalent work', ledger(32, 32, 2.5)],
  ['overstated dispatch coverage', ledger(33, 32, 3)],
  ['missing dispatch', { ...ledger(32, 32, 3), pressureTierDispatches: [dispatch(1, 32, 'B')] }],
]) {
  assert.equal(pressureTierDispatchEvidence(candidate, dimensions).bounded, false, name);
}

const witness = readFileSync(new URL('../volume-witness.mjs', import.meta.url), 'utf8');
assert.match(witness, /pressureTierDispatchEvidence\(stateLedger, expectedGridDimensions\)/);
assert.doesNotMatch(witness, /pressureJacobiFullGridEquivalentPasses\) < 3/);
console.log('volume pressure-tier witness contracts passed');
