import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as witnessContracts from '../volume-physical-color-witness-contract.mjs';
const { assertArmControlsEffective, assertArmEquivalent } = witnessContracts;
const witness = readFileSync(new URL('../volume-physical-color-witness.mjs', import.meta.url), 'utf8');
const earlier = new Map([['bright',Buffer.from([3,5,8,255])]]);
assertArmEquivalent({id:'isolation',equalTo:'bright'},Buffer.from([3,5,8,255]),earlier);
assert.throws(()=>assertArmEquivalent({id:'isolation',equalTo:'bright'},Buffer.from([3,5,9,255]),earlier),/raw RGBA differs/);
assert.throws(()=>assertArmEquivalent({id:'isolation',equalTo:'missing'},Buffer.from([3,5,8,255]),earlier),/prior arm missing/);
assert.throws(()=>assertArmEquivalent({id:'isolation',equalTo:'bright'},Buffer.from([3,5,8]),earlier),/raw RGBA differs/);
assertArmEquivalent({id:'normal'},Buffer.from([1,2,3,255]),earlier);
assert.equal(typeof assertArmControlsEffective, 'function', 'effective per-arm control contract missing');
assert.throws(
  () => assertArmControlsEffective({ id: 'beauty', controls: { 'volume-fire-render-mode': 'stock' } }, { fireRenderMode: 'inspect' }),
  /effective control mismatch: volume-fire-render-mode/,
);
assert.doesNotThrow(() => assertArmControlsEffective({ id: 'beauty', controls: { 'volume-fire-render-mode': 'stock' } }, { fireRenderMode: 'stock' }));
assert.match(witness, /physicalColor\.temperature, Math\.fround\(arm\.temperature\)/);
assert.match(witness, /async function evaluateSmall\(expression\)/, 'small startup state must not cross page contexts in chunked transfer');
assert.match(witness, /state = await evaluateSmall\('window\.__kaminosVolumePrototype\?\.debugState/);
assert.match(witness, /input instanceof HTMLSelectElement/, 'select overrides must dispatch change');
assert.match(witness, /assertArmControlsEffective\(arm, result\.state\)/, 'effective arm state must be validated');
console.log('same-state RGBA and effective-control contracts pass; altered/partial/missing-reference fail');
