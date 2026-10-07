import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../tools/pressure-vessels-witness.mjs',import.meta.url),'utf8');
const a=source.indexOf('   const raw='),b=source.indexOf('   await evaluate(',a),segment=source.slice(a,b);
const run=new Function('evaluateJsonTransfer','client','assert','Buffer','join','out','mode','target','writeFileSync','readFileSync','sha','row','report','save','state','check','return (async()=>{'+segment+'})()');
for(const raw of [{count:1,stepCount:30,buffers:{source:Buffer.alloc(64).toString('base64')}},{count:36864,stepCount:29,buffers:{source:Buffer.alloc(64).toString('base64')}},{count:36864,stepCount:30,buffers:{source:Buffer.alloc(64).toString('base64')}}]){
 const files=new Map(),row={frames:[]},report={};
 await assert.rejects(run(async()=>raw,{},assert,Buffer,(...p)=>p.join('/'),'owned','off',30,(p,s)=>files.set(p,s),p=>Buffer.from(files.get(p)),()=> 'sha',row,report,()=>{},()=>{},()=>{}));
 assert.equal(files.size,1,'rejected native readback must remain available');assert.deepEqual(JSON.parse([...files.values()][0]),raw);assert.equal(row.frames[0].validation,'rejected');
}
console.log('Actual pressure capture path retains wrong-count, wrong-step and partial-byte readbacks while rejecting them');
