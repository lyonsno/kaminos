import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../scene-gi-witness.mjs',import.meta.url),'utf8');
const start=source.indexOf('  report.runtimeAfter=');
const end=source.indexOf('\n} catch(e)',start);
assert.ok(start>=0&&end>start);
const body=source.slice(start,end);
for(const problem of [{errors:['late GPU validation error'],httpErrors:[]},{errors:[],httpErrors:[{url:'required-module',status:404}]}]) {
  const report={...problem,status:'running',phase:'linear-composition',runtime:{source:{commit:'same'}}};
  await assert.rejects(vm.runInNewContext(`(async()=>{${body}})()`,{
    report,url:'http://local/',URL,assert,fetch:async()=>({json:async()=>({source:{commit:'same'}})}),
  }),'late errors must fail before terminal success');
  assert.equal(report.status,'running','failure must preserve the last trustworthy phase');
}
console.log('late render and HTTP errors cannot publish successful GI evidence');
