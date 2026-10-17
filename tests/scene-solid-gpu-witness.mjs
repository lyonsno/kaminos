// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../tools/scene-solid-gpu-witness.mjs',import.meta.url),'utf8');
const block=source.slice(source.indexOf(" assert.equal(report.effective.backend"),source.indexOf("report.status='passed'"));
const good=()=>({errors:[],effective:{backend:'WebGPU',results:[16,32].flatMap(height=>['rotated-solid','open-plane','independent-union','removal','domain-transform'].map(name=>{
 const expected=Array(16*height*16).fill(0);expected[31]=1;return {name,height,expected,actual:[...expected],different:[],receipt:{backend:'gpu'}};
}))}});
const crossRealmAssert={...assert,deepEqual:(a,b,message)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),message)};
const check=report=>vm.runInNewContext(block,{report,assert:crossRealmAssert});
check(good());
for(const [name,change] of [
 ['wrong backend',r=>{r.effective.backend='CPU';}],
 ['partial',r=>r.effective.results.pop()],
 ['blank',r=>r.effective.results[0].actual.fill(0)],
 ['wrong raw signal with dishonest diff list',r=>{r.effective.results[0].actual[32]=1;}],
 ['duplicate rows',r=>{r.effective.results[1]=r.effective.results[0];}],
 ['runtime errors',r=>r.errors.push('validation failed')]
]){const r=good();change(r);assert.throws(()=>check(r),undefined,name+' must fail');}
