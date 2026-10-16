// kaminos-test: node
import assert from 'node:assert/strict';
import {checkFuseMaterialEvidence} from '../tools/fuse-witness-contracts.mjs';
import {coldFuse,stepFuse} from '../fuse-core.mjs';
const rows=[];for(const heated of [false,true]){
  let cells=coldFuse();const input=new Float32Array(96);if(heated)input.fill(4,0,3);
  for(let j=0;j<1800;j++){if(j===90)input.fill(0);cells=stepFuse(cells,input,1/60,.01);}
  rows.push({name:heated?'finite-end-heat':'unlit-control',steps:1800,dt:1/60,spacing:.01,expected:Array.from(cells),actual:Array.from(cells)});
}
const good=()=>structuredClone({backend:'WebGPU',samples:96,rows,errors:[]});assert.equal(checkFuseMaterialEvidence(good()),true);
for(const edit of [r=>r.backend='CPU',r=>r.rows.pop(),r=>r.rows[1].actual.fill(0),r=>r.rows[1].actual[0]+=1,r=>r.errors.push('device lost'),r=>r.rows[1]=r.rows[0],r=>r.rows[1].actual[0]=NaN]){
 const row=good();edit(row);assert.throws(()=>checkFuseMaterialEvidence(row));
}
