import assert from 'node:assert/strict';
import * as evidence from '../structural-material-shard-release-evidence.mjs';
assert.equal(typeof evidence.inspectLoadedReleaseSources,'function','A valid URL/API alone must not admit a different loaded implementation');
const expected=[{name:'view.js',url:'http://127.0.0.1/view.js',sha256:'a'.repeat(64)}],good=[{...expected[0],bytes:10,status:200}];
assert.deepEqual(evidence.inspectLoadedReleaseSources(expected,good),[]);
for(const observed of [[],[{...good[0],sha256:'b'.repeat(64)}],[...good,{...good[0],sha256:'b'.repeat(64)}],[{...good[0],bytes:0}],[{...good[0],url:'http://127.0.0.1/other.js'}]])assert.ok(evidence.inspectLoadedReleaseSources(expected,observed).length,'Missing, mismatched, later-overwritten or blank loaded source cannot pass');
assert.ok(evidence.inspectLoadedReleaseSources([],good).length);
console.log('Loaded-byte admission rejects source substitution and absent binding; fixtures test local policy, native mismatch smoke establishes the route contract');
