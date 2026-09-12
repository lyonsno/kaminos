import assert from 'node:assert/strict';
import { assertArmEquivalent } from '../volume-physical-color-witness-contract.mjs';
const earlier = new Map([['bright',Buffer.from([3,5,8,255])]]);
assertArmEquivalent({id:'isolation',equalTo:'bright'},Buffer.from([3,5,8,255]),earlier);
assert.throws(()=>assertArmEquivalent({id:'isolation',equalTo:'bright'},Buffer.from([3,5,9,255]),earlier),/raw RGBA differs/);
assert.throws(()=>assertArmEquivalent({id:'isolation',equalTo:'missing'},Buffer.from([3,5,8,255]),earlier),/prior arm missing/);
assert.throws(()=>assertArmEquivalent({id:'isolation',equalTo:'bright'},Buffer.from([3,5,8]),earlier),/raw RGBA differs/);
assertArmEquivalent({id:'normal'},Buffer.from([1,2,3,255]),earlier);
console.log('named same-state raw-RGBA arm equivalence passes; altered/partial/missing-reference fail');
