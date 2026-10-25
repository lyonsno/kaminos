// kaminos-test: node
import assert from'node:assert/strict';
import{installTextRopeCompatibility}from'../models/bfl-pup/text-rope-compat.mjs';
// Recorded actual JS4.2 three-token browser result is delta6/next9;
// canonical Transformers5.20.2 gives delta0/next3. This fixture constrains
// the adapter arithmetic; the actual library replay is retained separately.
const model={_get_text_only_rope_index(input){const length=BigInt(input.dims[1]);return[{positions:[0n,1n,2n]},{data:BigInt64Array.of(length+length)}];}};
installTextRopeCompatibility(model);
const [positions,delta]=model._get_text_only_rope_index({dims:[1,3]},{});
assert.deepEqual([...delta.data],[0n]);assert.equal(3n+delta.data[0],3n);
assert.deepEqual(positions.positions,[0n,1n,2n]);
assert.equal(model._get_text_only_rope_index({dims:[1,732]},{} )[1].data[0],0n);
console.log('Pinned text-only RoPE continuation delta passes');
