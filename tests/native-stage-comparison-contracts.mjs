import assert from 'node:assert/strict';
const core=await import('../tools/anytop-stage-comparison.mjs').catch(()=>({}));
assert.equal(typeof core.validateStageBinary,'function','stage comparison must reject missing, partial or relabelled numeric evidence');
const info={shape:[2,3,3],binary_sha256:'fixture'};
assert.throws(()=>core.validateStageBinary(Buffer.alloc(17*4),info,'fixture'),/element count/);
assert.throws(()=>core.validateStageBinary(Buffer.alloc(18*4),info,'wrong-hash'),/hash/);
assert.equal(core.validateStageBinary(Buffer.alloc(18*4),info,'fixture').length,18);
console.log('Native stage comparison contracts passed');
