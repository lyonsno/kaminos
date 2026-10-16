// kaminos-test: node
import assert from 'node:assert/strict';
import * as sampling from '../fire-shadow-sampling.mjs';
assert.equal(sampling.validateShadowComparison({grain:'screen-animated'}).grain,'screen-animated');
let temporalChanges=0;
for(let x=0;x<256;x++) {
 const a=sampling.shadowGrainPhase([x,12,0],17),b=sampling.shadowGrainPhase([x,12,0],18);
 assert.deepEqual(a,sampling.shadowGrainPhase([x,12,0],17));
 if(a.x!==b.x||a.y!==b.y||a.pair!==b.pair)temporalChanges++;
 assert.deepEqual(sampling.shadowGrainPhase([x,12,0]),sampling.shadowGrainPhase([x,12,0],0),'stable grain keeps its historical seed');
}
assert(temporalChanges>220,'animated grain must change phase without moving the screen coordinate');
assert.equal(typeof sampling.shadowGrainPhase,'function','scrambled grain needs a deterministic coordinate-to-phase contract');
const phases=new Set(),pairs=[0,0];let repeated=0;
for(let y=-32;y<32;y++)for(let x=-32;x<32;x++){
 const a=sampling.shadowGrainPhase([x,y,0]),b=sampling.shadowGrainPhase([x+4,y,0]);
 assert.deepEqual(a,sampling.shadowGrainPhase([x,y,0]));
 assert(a.x>=0&&a.x<4&&a.y>=0&&a.y<4&&[0,1].includes(a.pair));
 phases.add(a.y*4+a.x);pairs[a.pair]++;
 if(a.x===b.x&&a.y===b.y)repeated++;
}
assert.equal(phases.size,16);assert(pairs.every(n=>n>1800&&n<2300));
assert(repeated<400,'grain must not repeat the old four-pixel screen tile');
assert.deepEqual(sampling.validateShadowComparison({grain:'world',worldCellSize:.02}),{implementation:'shared',grain:'world',worldCellSize:.02});
for(const value of [{grain:'blue-noise'},{worldCellSize:0},{worldCellSize:NaN},{implementation:'cache'}])assert.throws(()=>sampling.validateShadowComparison(value));
console.log('PASS deterministic non-tiled phase selection and explicit comparison contract');
